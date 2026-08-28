-- ───────────────────────────────────────────────────────
-- 2026_beneficiary_limits.sql
--
-- Topes por TERCERO/BENEFICIARIO. Mirror exacto del sistema de topes
-- de usuarios (2026_user_limits.sql + 2026_user_limits_fix.sql) pero
-- aplicado a public.beneficiaries.
--
-- Casos de uso:
--   • Admin abre KYC Terceros → fila → "Topes" → edita los topes
--     que aplican cuando alguien envía a ESE beneficiario.
--   • Admin abre el drawer de un usuario → tab "Topes" → lista
--     todos los beneficiarios del user con sus consumos individuales.
--
-- Resolución del tope efectivo (igual que users):
--   custom_* del beneficiary → app_settings('operational_limits') → defaults hardcoded
-- ───────────────────────────────────────────────────────

-- 1) Columnas en beneficiaries
ALTER TABLE public.beneficiaries
    ADD COLUMN IF NOT EXISTS custom_daily_limit   numeric,
    ADD COLUMN IF NOT EXISTS custom_monthly_limit numeric,
    ADD COLUMN IF NOT EXISTS limits_currency      text;

-- 2) RPC: resumen del consumo + tope efectivo de un beneficiario.
--    Suma TXs donde el beneficiario fue el destinatario (beneficiary_id
--    es la columna que apunta a beneficiaries.id desde transactions).
--    Si tu schema usa otro nombre, ajustá el WHERE.
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

    -- Permisos: el dueño del beneficiario puede consultar el suyo;
    -- super_admin/compliance/treasury pueden consultar cualquiera.
    SELECT admin_role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    SELECT owner_user_id INTO v_owner_id FROM public.beneficiaries WHERE id = p_beneficiary_id;

    IF v_owner_id IS NULL THEN
        RETURN jsonb_build_object('error', 'beneficiary_not_found');
    END IF;

    IF auth.uid() <> v_owner_id
       AND COALESCE(v_caller_role, '') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error', 'forbidden');
    END IF;

    -- 1) traer custom + global default
    SELECT custom_daily_limit, custom_monthly_limit, limits_currency
    INTO v_custom_d, v_custom_m, v_ben_curr
    FROM public.beneficiaries WHERE id = p_beneficiary_id;

    SELECT value INTO v_global
    FROM public.app_settings WHERE key = 'operational_limits';

    v_eff_daily    := COALESCE(v_custom_d, (v_global->>'daily')::numeric, 800);
    v_eff_monthly  := COALESCE(v_custom_m, (v_global->>'monthly')::numeric, 3000);
    v_eff_currency := COALESCE(v_ben_curr, v_global->>'currency', 'USD');

    -- 2) consumo rolling — TXs donde el beneficiario fue el destinatario.
    --    Probamos beneficiary_id (spec ideal) y caemos a recipient_id /
    --    destination_id si tu schema usa otro nombre. Si ninguna existe,
    --    el query devuelve 0 y queda como "sin uso" (no rompe).
    BEGIN
        SELECT COALESCE(SUM(COALESCE(amount, 0)), 0)
        INTO v_used_d
        FROM public.transactions
        WHERE beneficiary_id = p_beneficiary_id
          AND created_at >= now() - interval '24 hours'
          AND kind IN ('send', 'load', 'convert', 'envio', 'carga')
          AND status IN ('completed', 'approved', 'sent', 'success');

        SELECT COALESCE(SUM(COALESCE(amount, 0)), 0)
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
        'daily_used',         v_used_d,
        'monthly_used',       v_used_m,
        'daily_pct',          CASE WHEN v_eff_daily > 0   THEN ROUND((v_used_d / v_eff_daily   * 100)::numeric, 2) ELSE 0 END,
        'monthly_pct',        CASE WHEN v_eff_monthly > 0 THEN ROUND((v_used_m / v_eff_monthly * 100)::numeric, 2) ELSE 0 END,
        'is_custom_daily',    v_custom_d IS NOT NULL,
        'is_custom_monthly',  v_custom_m IS NOT NULL,
        'owner_user_id',      v_owner_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_beneficiary_limits_summary(uuid) TO anon, authenticated;

-- 3) RPC: setear topes custom de un beneficiario.
--    Pasar NULL en p_daily_limit / p_monthly_limit / p_currency = volver
--    al default global. Solo admins con rol super_admin / compliance / treasury.
CREATE OR REPLACE FUNCTION public.admin_set_beneficiary_limits(
    p_beneficiary_id uuid,
    p_daily_limit    numeric,
    p_monthly_limit  numeric,
    p_currency       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_role text;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;

    SELECT admin_role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    IF COALESCE(v_caller_role, '') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error', 'forbidden');
    END IF;

    UPDATE public.beneficiaries
       SET custom_daily_limit   = p_daily_limit,
           custom_monthly_limit = p_monthly_limit,
           limits_currency      = p_currency
     WHERE id = p_beneficiary_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'beneficiary_not_found');
    END IF;

    RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_beneficiary_limits(uuid, numeric, numeric, text) TO authenticated;
