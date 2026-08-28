-- ───────────────────────────────────────────────────────
-- 2026_limits_only_loads.sql
--
-- Cambio de regla de negocio: el tope diario/mensual aplica SOLO
-- a transacciones de "cargar dinero" (depósitos). Envíos y
-- conversiones no descuentan del límite ni aparecen en la barra
-- de progreso.
--
-- Antes el WHERE incluía:
--   kind IN ('send', 'load', 'convert', 'envio', 'carga')
-- Ahora estricto:
--   kind = 'load'
--
-- Si el backend mete cargas con label 'carga' en español, agregar
-- esos rows a 'load' o cambiar el filtro a IN ('load','carga').
--
-- Re-crea los dos RPCs de summary; el resto (conversión TRM,
-- permisos, fallback de columnas) se mantiene idéntico.
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

    -- Regla nueva: SOLO depósitos (kind in 'load','carga') cuentan.
    -- Envíos y conversiones quedan fuera del límite.
    SELECT COALESCE(SUM(public.to_currency(COALESCE(amount, 0), COALESCE(currency, v_eff_currency), v_eff_currency)), 0)
    INTO v_used_d
    FROM public.transactions
    WHERE owner_user_id = p_user_id
      AND created_at >= now() - interval '24 hours'
      AND kind = 'load'
      AND status IN ('completed', 'approved', 'sent', 'success');

    SELECT COALESCE(SUM(public.to_currency(COALESCE(amount, 0), COALESCE(currency, v_eff_currency), v_eff_currency)), 0)
    INTO v_used_m
    FROM public.transactions
    WHERE owner_user_id = p_user_id
      AND created_at >= now() - interval '30 days'
      AND kind = 'load'
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
          AND kind = 'load'
          AND status IN ('completed', 'approved', 'sent', 'success');

        SELECT COALESCE(SUM(public.to_currency(COALESCE(amount, 0), COALESCE(currency, v_eff_currency), v_eff_currency)), 0)
        INTO v_used_m
        FROM public.transactions
        WHERE beneficiary_id = p_beneficiary_id
          AND created_at >= now() - interval '30 days'
          AND kind = 'load'
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
