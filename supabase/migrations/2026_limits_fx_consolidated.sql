-- ───────────────────────────────────────────────────────
-- 2026_limits_fx_consolidated.sql
--
-- CONSOLIDADO idempotente del sistema de topes con conversión FX.
-- Correr este archivo completo deja el cálculo correcto sin importar
-- qué versión previa de los RPCs esté deployada.
--
-- Reglas de negocio:
--   • Solo transacciones kind='load' (cargas) consumen tope.
--   • Cada TX se convierte de su currency a la moneda del tope
--     (default USD) ANTES de sumar. 200.000 COP ≈ 50 USD, no 200.000.
--   • Tope efectivo: custom del user/beneficiary → app_settings
--     ('operational_limits') → default hardcoded.
--
-- Fuentes de tasa FX (en orden):
--   1. public.fx_rate_snapshots  (TRM real del día — edge fx-snapshot)
--   2. public.fx_rates           (seed/tesorería)
--   3. public.exchange_rates     (tabla de Antigravity, si existe)
--   4. Constantes hardcoded vía pivote USD (último recurso)
-- ───────────────────────────────────────────────────────

-- ═══ 1. Helper de conversión ═══
CREATE OR REPLACE FUNCTION public.to_currency(
    p_amount numeric,
    p_from   text,
    p_to     text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_rate    numeric;
    v_inv     numeric;
    v_amt_usd numeric;
BEGIN
    IF p_amount IS NULL OR p_amount = 0 THEN RETURN 0; END IF;
    IF p_from IS NULL OR p_to IS NULL THEN RETURN p_amount; END IF;
    IF UPPER(p_from) = UPPER(p_to) THEN RETURN p_amount; END IF;

    -- 1) snapshot más reciente (TRM real)
    BEGIN
        SELECT rate INTO v_rate FROM public.fx_rate_snapshots
            WHERE UPPER(from_currency)=UPPER(p_from) AND UPPER(to_currency)=UPPER(p_to)
            ORDER BY captured_at DESC LIMIT 1;
        IF v_rate IS NOT NULL AND v_rate > 0 THEN RETURN p_amount * v_rate; END IF;
        SELECT rate INTO v_inv FROM public.fx_rate_snapshots
            WHERE UPPER(from_currency)=UPPER(p_to) AND UPPER(to_currency)=UPPER(p_from)
            ORDER BY captured_at DESC LIMIT 1;
        IF v_inv IS NOT NULL AND v_inv > 0 THEN RETURN p_amount / v_inv; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- 2) fx_rates (tesorería/seed)
    BEGIN
        SELECT rate INTO v_rate FROM public.fx_rates
            WHERE UPPER(from_currency)=UPPER(p_from) AND UPPER(to_currency)=UPPER(p_to) AND is_active = true
            ORDER BY effective_from DESC NULLS LAST LIMIT 1;
        IF v_rate IS NOT NULL AND v_rate > 0 THEN RETURN p_amount * v_rate; END IF;
        SELECT rate INTO v_inv FROM public.fx_rates
            WHERE UPPER(from_currency)=UPPER(p_to) AND UPPER(to_currency)=UPPER(p_from) AND is_active = true
            ORDER BY effective_from DESC NULLS LAST LIMIT 1;
        IF v_inv IS NOT NULL AND v_inv > 0 THEN RETURN p_amount / v_inv; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- 3) exchange_rates (schema par from/to; si la tabla usa otras columnas
    --    este bloque simplemente cae al fallback sin romper)
    BEGIN
        SELECT rate INTO v_rate FROM public.exchange_rates
            WHERE UPPER(from_currency)=UPPER(p_from) AND UPPER(to_currency)=UPPER(p_to)
            ORDER BY created_at DESC LIMIT 1;
        IF v_rate IS NOT NULL AND v_rate > 0 THEN RETURN p_amount * v_rate; END IF;
        SELECT rate INTO v_inv FROM public.exchange_rates
            WHERE UPPER(from_currency)=UPPER(p_to) AND UPPER(to_currency)=UPPER(p_from)
            ORDER BY created_at DESC LIMIT 1;
        IF v_inv IS NOT NULL AND v_inv > 0 THEN RETURN p_amount / v_inv; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- 4) Último recurso: constantes aproximadas vía pivote USD
    v_amt_usd := p_amount * CASE UPPER(p_from)
        WHEN 'USD' THEN 1.0
        WHEN 'COP' THEN 1.0/4000.0
        WHEN 'CLP' THEN 1.0/950.0
        WHEN 'PEN' THEN 1.0/3.7
        WHEN 'MXN' THEN 1.0/17.0
        WHEN 'BRL' THEN 1.0/5.5
        WHEN 'VES' THEN 1.0/36.0
        WHEN 'EUR' THEN 1.08
        ELSE 1.0
    END;
    RETURN v_amt_usd * CASE UPPER(p_to)
        WHEN 'USD' THEN 1.0
        WHEN 'COP' THEN 4000.0
        WHEN 'CLP' THEN 950.0
        WHEN 'PEN' THEN 3.7
        WHEN 'MXN' THEN 17.0
        WHEN 'BRL' THEN 5.5
        WHEN 'VES' THEN 36.0
        WHEN 'EUR' THEN 1.0/1.08
        ELSE 1.0
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.to_currency(numeric, text, text) TO anon, authenticated;

-- ═══ 2. Summary de topes por USUARIO ═══
CREATE OR REPLACE FUNCTION public.get_user_limits_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_custom_d numeric; v_custom_m numeric; v_user_curr text; v_global jsonb;
    v_eff_daily numeric; v_eff_monthly numeric; v_eff_currency text;
    v_used_d numeric; v_used_m numeric; v_caller_role text;
BEGIN
    SELECT admin_role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error','not_authenticated'); END IF;
    IF auth.uid() <> p_user_id
       AND COALESCE(v_caller_role,'') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error','forbidden');
    END IF;

    SELECT custom_daily_limit, custom_monthly_limit, limits_currency
    INTO v_custom_d, v_custom_m, v_user_curr FROM public.users WHERE id = p_user_id;

    SELECT value INTO v_global FROM public.app_settings WHERE key = 'operational_limits';

    v_eff_daily    := COALESCE(v_custom_d, (v_global->>'daily')::numeric,   800);
    v_eff_monthly  := COALESCE(v_custom_m, (v_global->>'monthly')::numeric, 6000);
    v_eff_currency := COALESCE(v_user_curr, v_global->>'currency', 'USD');

    -- Solo cargas (kind='load'); cada monto convertido a la moneda del
    -- tope ANTES de sumar.
    SELECT COALESCE(SUM(public.to_currency(COALESCE(amount,0), COALESCE(currency, v_eff_currency), v_eff_currency)),0)
    INTO v_used_d FROM public.transactions
    WHERE user_id = p_user_id
      AND created_at >= now() - interval '24 hours'
      AND kind = 'load'
      AND status IN ('completed','approved','sent','success');

    SELECT COALESCE(SUM(public.to_currency(COALESCE(amount,0), COALESCE(currency, v_eff_currency), v_eff_currency)),0)
    INTO v_used_m FROM public.transactions
    WHERE user_id = p_user_id
      AND created_at >= now() - interval '30 days'
      AND kind = 'load'
      AND status IN ('completed','approved','sent','success');

    RETURN jsonb_build_object(
        'currency',          v_eff_currency,
        'daily_max',         v_eff_daily,
        'monthly_max',       v_eff_monthly,
        'daily_used',        ROUND(v_used_d::numeric, 2),
        'monthly_used',      ROUND(v_used_m::numeric, 2),
        'daily_pct',         CASE WHEN v_eff_daily   > 0 THEN ROUND((v_used_d / v_eff_daily   * 100)::numeric, 2) ELSE 0 END,
        'monthly_pct',       CASE WHEN v_eff_monthly > 0 THEN ROUND((v_used_m / v_eff_monthly * 100)::numeric, 2) ELSE 0 END,
        'is_custom_daily',   v_custom_d IS NOT NULL,
        'is_custom_monthly', v_custom_m IS NOT NULL
    );
END;
$$;

-- ═══ 3. Summary de topes por BENEFICIARIO ═══
CREATE OR REPLACE FUNCTION public.get_beneficiary_limits_summary(p_beneficiary_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_custom_d numeric; v_custom_m numeric; v_ben_curr text; v_global jsonb;
    v_eff_daily numeric; v_eff_monthly numeric; v_eff_currency text;
    v_used_d numeric; v_used_m numeric; v_caller_role text; v_owner_id uuid;
BEGIN
    IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error','not_authenticated'); END IF;
    SELECT admin_role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    SELECT owner_user_id INTO v_owner_id FROM public.beneficiaries WHERE id = p_beneficiary_id;
    IF v_owner_id IS NULL THEN RETURN jsonb_build_object('error','beneficiary_not_found'); END IF;
    IF auth.uid() <> v_owner_id
       AND COALESCE(v_caller_role,'') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error','forbidden');
    END IF;

    SELECT custom_daily_limit, custom_monthly_limit, limits_currency
    INTO v_custom_d, v_custom_m, v_ben_curr FROM public.beneficiaries WHERE id = p_beneficiary_id;

    SELECT value INTO v_global FROM public.app_settings WHERE key = 'operational_limits';

    v_eff_daily    := COALESCE(v_custom_d, (v_global->>'daily')::numeric,   800);
    v_eff_monthly  := COALESCE(v_custom_m, (v_global->>'monthly')::numeric, 6000);
    v_eff_currency := COALESCE(v_ben_curr, v_global->>'currency', 'USD');

    BEGIN
        SELECT COALESCE(SUM(public.to_currency(COALESCE(amount,0), COALESCE(currency, v_eff_currency), v_eff_currency)),0)
        INTO v_used_d FROM public.transactions
        WHERE beneficiary_id = p_beneficiary_id
          AND created_at >= now() - interval '24 hours'
          AND kind = 'load'
          AND status IN ('completed','approved','sent','success');

        SELECT COALESCE(SUM(public.to_currency(COALESCE(amount,0), COALESCE(currency, v_eff_currency), v_eff_currency)),0)
        INTO v_used_m FROM public.transactions
        WHERE beneficiary_id = p_beneficiary_id
          AND created_at >= now() - interval '30 days'
          AND kind = 'load'
          AND status IN ('completed','approved','sent','success');
    EXCEPTION WHEN undefined_column THEN
        v_used_d := 0; v_used_m := 0;
    END;

    RETURN jsonb_build_object(
        'currency',          v_eff_currency,
        'daily_max',         v_eff_daily,
        'monthly_max',       v_eff_monthly,
        'daily_used',        ROUND(v_used_d::numeric, 2),
        'monthly_used',      ROUND(v_used_m::numeric, 2),
        'daily_pct',         CASE WHEN v_eff_daily   > 0 THEN ROUND((v_used_d / v_eff_daily   * 100)::numeric, 2) ELSE 0 END,
        'monthly_pct',       CASE WHEN v_eff_monthly > 0 THEN ROUND((v_used_m / v_eff_monthly * 100)::numeric, 2) ELSE 0 END,
        'is_custom_daily',   v_custom_d IS NOT NULL,
        'is_custom_monthly', v_custom_m IS NOT NULL,
        'owner_user_id',     v_owner_id
    );
END;
$$;

-- ═══ 4. Verificación (correr después para confirmar) ═══
-- SELECT public.to_currency(200000, 'COP', 'USD');   -- esperado ≈ 50
-- SELECT public.get_user_limits_summary(id)
--   FROM public.users WHERE email = 'bryandavidortiz51@gmail.com';
