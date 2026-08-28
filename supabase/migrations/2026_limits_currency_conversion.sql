-- ───────────────────────────────────────────────────────
-- 2026_limits_currency_conversion.sql
--
-- Fix: el sumatorio de uso en get_user_limits_summary y
-- get_beneficiary_limits_summary sumaba `amount` directo desde
-- transactions sin convertir a la moneda del tope. Resultado:
-- una TX de 200.000 COP se comparaba contra un tope de 5.000 USD =
-- 4000% usado.
--
-- Cambios:
--   1) Helper SQL public.to_currency(amount, from_curr, to_curr) que
--      convierte usando public.fx_rates si existe el par, o cae a
--      constantes TRM hardcodeadas (junio 2026) si la tabla no tiene
--      la tasa.
--   2) Re-crea get_user_limits_summary y get_beneficiary_limits_summary
--      sumando SUM(to_currency(amount, currency, eff_currency)).
--
-- Para correr en SQL Editor de Supabase Personas.
-- ───────────────────────────────────────────────────────

-- 1) Helper de conversión.
--    Estrategia:
--      a) Si from = to → devuelve amount.
--      b) Si hay par directo activo en fx_rates → usa esa rate.
--      c) Si hay par inverso → usa 1/rate.
--      d) Si no, baja todo a USD usando constantes hardcodeadas y de
--         ahí sube a to_currency con constantes hardcodeadas.
--      e) Si la moneda es desconocida → devuelve amount (fallback safe).
CREATE OR REPLACE FUNCTION public.to_currency(
    p_amount     numeric,
    p_from       text,
    p_to         text
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_rate    numeric;
    v_inv     numeric;
    v_amt_usd numeric;
BEGIN
    IF p_amount IS NULL OR p_amount = 0 THEN RETURN 0; END IF;
    IF p_from IS NULL OR p_to IS NULL THEN RETURN p_amount; END IF;
    IF UPPER(p_from) = UPPER(p_to) THEN RETURN p_amount; END IF;

    -- a) par directo en fx_rates
    BEGIN
        SELECT rate INTO v_rate
        FROM public.fx_rates
        WHERE UPPER(from_currency) = UPPER(p_from)
          AND UPPER(to_currency)   = UPPER(p_to)
          AND is_active = true
        ORDER BY effective_from DESC NULLS LAST
        LIMIT 1;
        IF v_rate IS NOT NULL AND v_rate > 0 THEN
            RETURN p_amount * v_rate;
        END IF;

        -- b) par inverso
        SELECT rate INTO v_inv
        FROM public.fx_rates
        WHERE UPPER(from_currency) = UPPER(p_to)
          AND UPPER(to_currency)   = UPPER(p_from)
          AND is_active = true
        ORDER BY effective_from DESC NULLS LAST
        LIMIT 1;
        IF v_inv IS NOT NULL AND v_inv > 0 THEN
            RETURN p_amount / v_inv;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        -- fx_rates puede no existir; seguimos con fallback hardcoded.
        NULL;
    END;

    -- c+d) bajar a USD usando constantes hardcoded (TRM jun-2026
    --      aproximadas). Si la moneda no está en la tabla, asumimos
    --      que ya es USD para no romper el cálculo.
    v_amt_usd := p_amount * CASE UPPER(p_from)
        WHEN 'USD' THEN 1.0
        WHEN 'COP' THEN 1.0 / 4000.0
        WHEN 'CLP' THEN 1.0 / 950.0
        WHEN 'PEN' THEN 1.0 / 3.7
        WHEN 'MXN' THEN 1.0 / 17.0
        WHEN 'BRL' THEN 1.0 / 5.5
        WHEN 'VES' THEN 1.0 / 36.0
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
        WHEN 'EUR' THEN 1.0 / 1.08
        ELSE 1.0
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.to_currency(numeric, text, text) TO anon, authenticated;

-- 2) RE-CREAR get_user_limits_summary con conversión por TX.
CREATE OR REPLACE FUNCTION public.get_user_limits_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_custom_d      numeric;
    v_custom_m      numeric;
    v_user_curr     text;
    v_global        jsonb;
    v_eff_daily     numeric;
    v_eff_monthly   numeric;
    v_eff_currency  text;
    v_used_d        numeric;
    v_used_m        numeric;
    v_caller_role   text;
BEGIN
    SELECT admin_role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;
    IF auth.uid() <> p_user_id
       AND COALESCE(v_caller_role, '') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error', 'forbidden');
    END IF;

    SELECT custom_daily_limit, custom_monthly_limit, limits_currency
    INTO v_custom_d, v_custom_m, v_user_curr
    FROM public.users WHERE id = p_user_id;

    SELECT value INTO v_global
    FROM public.app_settings WHERE key = 'operational_limits';

    v_eff_daily    := COALESCE(v_custom_d, (v_global->>'daily')::numeric, 800);
    v_eff_monthly  := COALESCE(v_custom_m, (v_global->>'monthly')::numeric, 3000);
    v_eff_currency := COALESCE(v_user_curr, v_global->>'currency', 'USD');

    -- Sumas convertidas a v_eff_currency. Cada TX se convierte desde su
    -- moneda origen (transactions.currency) al currency del tope.
    SELECT COALESCE(SUM(public.to_currency(COALESCE(amount, 0), COALESCE(currency, v_eff_currency), v_eff_currency)), 0)
    INTO v_used_d
    FROM public.transactions
    WHERE owner_user_id = p_user_id
      AND created_at >= now() - interval '24 hours'
      AND kind IN ('send', 'load', 'convert', 'envio', 'carga')
      AND status IN ('completed', 'approved', 'sent', 'success');

    SELECT COALESCE(SUM(public.to_currency(COALESCE(amount, 0), COALESCE(currency, v_eff_currency), v_eff_currency)), 0)
    INTO v_used_m
    FROM public.transactions
    WHERE owner_user_id = p_user_id
      AND created_at >= now() - interval '30 days'
      AND kind IN ('send', 'load', 'convert', 'envio', 'carga')
      AND status IN ('completed', 'approved', 'sent', 'success');

    RETURN jsonb_build_object(
        'currency',           v_eff_currency,
        'daily_max',          v_eff_daily,
        'monthly_max',        v_eff_monthly,
        'daily_used',         ROUND(v_used_d::numeric, 2),
        'monthly_used',       ROUND(v_used_m::numeric, 2),
        'daily_pct',          CASE WHEN v_eff_daily > 0   THEN ROUND((v_used_d / v_eff_daily   * 100)::numeric, 2) ELSE 0 END,
        'monthly_pct',        CASE WHEN v_eff_monthly > 0 THEN ROUND((v_used_m / v_eff_monthly * 100)::numeric, 2) ELSE 0 END,
        'is_custom_daily',    v_custom_d IS NOT NULL,
        'is_custom_monthly',  v_custom_m IS NOT NULL
    );
END;
$$;

-- 3) RE-CREAR get_beneficiary_limits_summary con la misma conversión.
CREATE OR REPLACE FUNCTION public.get_beneficiary_limits_summary(p_beneficiary_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_custom_d      numeric;
    v_custom_m      numeric;
    v_ben_curr      text;
    v_global        jsonb;
    v_eff_daily     numeric;
    v_eff_monthly   numeric;
    v_eff_currency  text;
    v_used_d        numeric;
    v_used_m        numeric;
    v_caller_role   text;
    v_owner_id      uuid;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;

    SELECT admin_role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    SELECT owner_user_id INTO v_owner_id FROM public.beneficiaries WHERE id = p_beneficiary_id;

    IF v_owner_id IS NULL THEN
        RETURN jsonb_build_object('error', 'beneficiary_not_found');
    END IF;

    IF auth.uid() <> v_owner_id
       AND COALESCE(v_caller_role, '') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error', 'forbidden');
    END IF;

    SELECT custom_daily_limit, custom_monthly_limit, limits_currency
    INTO v_custom_d, v_custom_m, v_ben_curr
    FROM public.beneficiaries WHERE id = p_beneficiary_id;

    SELECT value INTO v_global
    FROM public.app_settings WHERE key = 'operational_limits';

    v_eff_daily    := COALESCE(v_custom_d, (v_global->>'daily')::numeric, 800);
    v_eff_monthly  := COALESCE(v_custom_m, (v_global->>'monthly')::numeric, 3000);
    v_eff_currency := COALESCE(v_ben_curr, v_global->>'currency', 'USD');

    BEGIN
        SELECT COALESCE(SUM(public.to_currency(COALESCE(amount, 0), COALESCE(currency, v_eff_currency), v_eff_currency)), 0)
        INTO v_used_d
        FROM public.transactions
        WHERE beneficiary_id = p_beneficiary_id
          AND created_at >= now() - interval '24 hours'
          AND kind IN ('send', 'load', 'convert', 'envio', 'carga')
          AND status IN ('completed', 'approved', 'sent', 'success');

        SELECT COALESCE(SUM(public.to_currency(COALESCE(amount, 0), COALESCE(currency, v_eff_currency), v_eff_currency)), 0)
        INTO v_used_m
        FROM public.transactions
        WHERE beneficiary_id = p_beneficiary_id
          AND created_at >= now() - interval '30 days'
          AND kind IN ('send', 'load', 'convert', 'envio', 'carga')
          AND status IN ('completed', 'approved', 'sent', 'success');
    EXCEPTION WHEN undefined_column THEN
        v_used_d := 0;
        v_used_m := 0;
    END;

    RETURN jsonb_build_object(
        'currency',           v_eff_currency,
        'daily_max',          v_eff_daily,
        'monthly_max',        v_eff_monthly,
        'daily_used',         ROUND(v_used_d::numeric, 2),
        'monthly_used',       ROUND(v_used_m::numeric, 2),
        'daily_pct',          CASE WHEN v_eff_daily > 0   THEN ROUND((v_used_d / v_eff_daily   * 100)::numeric, 2) ELSE 0 END,
        'monthly_pct',        CASE WHEN v_eff_monthly > 0 THEN ROUND((v_used_m / v_eff_monthly * 100)::numeric, 2) ELSE 0 END,
        'is_custom_daily',    v_custom_d IS NOT NULL,
        'is_custom_monthly',  v_custom_m IS NOT NULL,
        'owner_user_id',      v_owner_id
    );
END;
$$;
