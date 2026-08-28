-- ───────────────────────────────────────────────────────
-- 2026_user_limits.sql
--
-- Topes operativos diarios y mensuales por usuario, con defaults
-- globales editables desde el admin.
--
-- Resolución del tope efectivo (front + backend):
--   1) Si users.custom_daily_limit / custom_monthly_limit NO son NULL
--      → ese valor es el tope del user (sobreescribe el global).
--   2) Si son NULL → se usa el default global de
--      app_settings.value WHERE key='operational_limits'
--      con shape { daily: number, monthly: number, currency: text }
--
-- El consumo (used) se calcula de transactions del último periodo
-- (rolling 24h y rolling 30d) sumando los montos de kind in
-- ('send','load','convert') con status in ('completed','approved','sent').
-- ───────────────────────────────────────────────────────

-- 1) Columnas custom en users
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS custom_daily_limit   numeric,
    ADD COLUMN IF NOT EXISTS custom_monthly_limit numeric,
    ADD COLUMN IF NOT EXISTS limits_currency      text;

COMMENT ON COLUMN public.users.custom_daily_limit IS
    'Override del tope diario. NULL = aplica el default global.';
COMMENT ON COLUMN public.users.custom_monthly_limit IS
    'Override del tope mensual. NULL = aplica el default global.';
COMMENT ON COLUMN public.users.limits_currency IS
    'Moneda en la que se interpretan los topes. NULL = la global.';

-- 2) Default global (idempotente — si ya existe la fila no rompe)
INSERT INTO public.app_settings (key, value)
VALUES (
    'operational_limits',
    jsonb_build_object('daily', 800, 'monthly', 3000, 'currency', 'USD')
)
ON CONFLICT (key) DO NOTHING;

-- 3) RPC summary: para un usuario dado, devuelve el tope efectivo,
--    el consumo rolling 24h / 30d, y los % de uso.
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
    -- Permisos: el propio user puede consultarse a sí mismo,
    -- los admins de compliance/treasury/super_admin pueden ver a cualquiera.
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

    -- 2) consumo rolling: sumamos send + load + convert completadas/aprobadas
    --    Tomamos amount como proxy en moneda original (no convertimos a USD
    --    acá; el admin que cambie el currency se hace cargo de coherencia).
    SELECT COALESCE(SUM(COALESCE(amount, from_amount, 0)), 0)
    INTO v_used_d
    FROM public.transactions
    WHERE (owner_user_id = p_user_id OR user_id = p_user_id)
      AND created_at >= now() - interval '24 hours'
      AND COALESCE(kind, type) IN ('send', 'load', 'convert', 'envio', 'carga')
      AND COALESCE(status, '') IN ('completed', 'approved', 'sent', 'success');

    SELECT COALESCE(SUM(COALESCE(amount, from_amount, 0)), 0)
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

GRANT EXECUTE ON FUNCTION public.get_user_limits_summary(uuid) TO authenticated;

-- 4) RPC para que un admin actualice los custom limits de un user
CREATE OR REPLACE FUNCTION public.admin_set_user_limits(
    p_user_id        uuid,
    p_daily_limit    numeric DEFAULT NULL,
    p_monthly_limit  numeric DEFAULT NULL,
    p_currency       text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role text;
BEGIN
    SELECT admin_role INTO v_role FROM public.users WHERE id = auth.uid();
    IF COALESCE(v_role, '') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error', 'forbidden');
    END IF;

    UPDATE public.users
    SET
        custom_daily_limit   = p_daily_limit,
        custom_monthly_limit = p_monthly_limit,
        limits_currency      = p_currency
    WHERE id = p_user_id;

    -- Audit log
    INSERT INTO public.admin_actions (admin_id, admin_email, admin_role, action, target_type, target_id, metadata)
    SELECT
        u.id, u.email, u.admin_role,
        'user_limits.update', 'user', p_user_id::text,
        jsonb_build_object(
            'daily_limit',   p_daily_limit,
            'monthly_limit', p_monthly_limit,
            'currency',      p_currency
        )
    FROM public.users u WHERE u.id = auth.uid();

    RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_user_limits(uuid, numeric, numeric, text) TO authenticated;
