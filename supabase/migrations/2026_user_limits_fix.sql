-- ───────────────────────────────────────────────────────
-- 2026_user_limits_fix.sql
--
-- Fix del RPC get_user_limits_summary: en la migración original puse
-- COALESCE(amount, from_amount, 0) pero `from_amount` no es columna
-- real de transactions — es solo un alias PostgREST que usa el front
-- para mapear `currency`. En el RPC tenemos que usar las columnas
-- reales: amount.
--
-- Error reportado:
--   column "from_amount" does not exist
-- ───────────────────────────────────────────────────────

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
    -- Permisos: el propio user puede consultarse; admins compliance/treasury/super_admin a cualquiera
    SELECT admin_role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;
    IF auth.uid() <> p_user_id
       AND COALESCE(v_caller_role, '') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error', 'forbidden');
    END IF;

    -- 1) traer custom + global
    SELECT custom_daily_limit, custom_monthly_limit, limits_currency
    INTO v_custom_d, v_custom_m, v_user_curr
    FROM public.users WHERE id = p_user_id;

    SELECT value INTO v_global
    FROM public.app_settings WHERE key = 'operational_limits';

    v_eff_daily    := COALESCE(v_custom_d, (v_global->>'daily')::numeric, 800);
    v_eff_monthly  := COALESCE(v_custom_m, (v_global->>'monthly')::numeric, 3000);
    v_eff_currency := COALESCE(v_user_curr, v_global->>'currency', 'USD');

    -- 2) consumo rolling — usamos SOLO `amount` (única columna real).
    --    owner_user_id vs user_id porque CuyPayANDROID usa la primera y
    --    legacy la segunda.
    SELECT COALESCE(SUM(COALESCE(amount, 0)), 0)
    INTO v_used_d
    FROM public.transactions
    WHERE (owner_user_id = p_user_id OR user_id = p_user_id)
      AND created_at >= now() - interval '24 hours'
      AND COALESCE(kind, type) IN ('send', 'load', 'convert', 'envio', 'carga')
      AND COALESCE(status, '') IN ('completed', 'approved', 'sent', 'success');

    SELECT COALESCE(SUM(COALESCE(amount, 0)), 0)
    INTO v_used_m
    FROM public.transactions
    WHERE (owner_user_id = p_user_id OR user_id = p_user_id)
      AND created_at >= now() - interval '30 days'
      AND COALESCE(kind, type) IN ('send', 'load', 'convert', 'envio', 'carga')
      AND COALESCE(status, '') IN ('completed', 'approved', 'sent', 'success');

    RETURN jsonb_build_object(
        'currency',           v_eff_currency,
        'daily_max',          v_eff_daily,
        'monthly_max',        v_eff_monthly,
        'daily_used',         v_used_d,
        'monthly_used',       v_used_m,
        'daily_pct',          CASE WHEN v_eff_daily > 0   THEN ROUND((v_used_d / v_eff_daily   * 100)::numeric, 2) ELSE 0 END,
        'monthly_pct',        CASE WHEN v_eff_monthly > 0 THEN ROUND((v_used_m / v_eff_monthly * 100)::numeric, 2) ELSE 0 END,
        'is_custom_daily',    v_custom_d IS NOT NULL,
        'is_custom_monthly',  v_custom_m IS NOT NULL
    );
END;
$$;
