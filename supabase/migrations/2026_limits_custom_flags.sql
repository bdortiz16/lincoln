-- ───────────────────────────────────────────────────────
-- 2026_limits_custom_flags.sql  (CONSOLIDADO — un solo paste)
--
-- Cierra el circuito de topes personalizados con la app iOS:
--
--   1. Flags users.is_custom_daily / is_custom_monthly (los lee la app).
--   2. Trigger apply_limit_increase v3: requested_amount es TEXT en
--      limit_increase_requests → cast explícito a numeric (arregla
--      "operator does not exist: text > integer" al Aprobar).
--   3. get_user_limits_summary v2: daily_max/monthly_max devuelven el
--      tope custom cuando existe, e incluye is_custom_daily /
--      is_custom_monthly leídos de la tabla users.
--   4. admin_set_user_limits mantiene los flags sincronizados cuando el
--      admin edita topes a mano desde el panel.
--
-- Idempotente: se puede correr las veces que haga falta.
-- ───────────────────────────────────────────────────────

-- ═══ 1. Flags ═══
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_custom_daily   boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_custom_monthly boolean DEFAULT false;

-- Backfill: quien ya tiene tope custom aplicado, queda marcado
UPDATE public.users SET is_custom_daily = true
WHERE custom_daily_limit IS NOT NULL AND COALESCE(is_custom_daily, false) = false;
UPDATE public.users SET is_custom_monthly = true
WHERE custom_monthly_limit IS NOT NULL AND COALESCE(is_custom_monthly, false) = false;

-- ═══ 2. Trigger de aprobación (v3: casts sobre columnas text) ═══
CREATE OR REPLACE FUNCTION public.apply_limit_increase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_amount numeric;
BEGIN
    IF NEW.status = 'approved'
       AND COALESCE(OLD.status, '') IS DISTINCT FROM 'approved' THEN

        BEGIN
            v_amount := NULLIF(trim(NEW.requested_amount::text), '')::numeric;
        EXCEPTION WHEN OTHERS THEN
            v_amount := NULL; -- monto ilegible: no aplicar nada, pero no romper el Aprobar
        END;

        IF v_amount IS NOT NULL AND v_amount > 0 THEN
            UPDATE public.users
            SET custom_monthly_limit = v_amount,
                custom_daily_limit   = GREATEST(
                    COALESCE(custom_daily_limit, 0)::numeric,
                    ROUND(v_amount * 0.2)
                ),
                limits_currency   = COALESCE(limits_currency, 'USD'),
                is_custom_monthly = true,
                is_custom_daily   = true
            WHERE id = (NEW.user_id::text)::uuid;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_limit_increase ON public.limit_increase_requests;
CREATE TRIGGER trg_apply_limit_increase
    AFTER UPDATE OF status ON public.limit_increase_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.apply_limit_increase();

-- ═══ 3. get_user_limits_summary v2 ═══
-- DROP previo por si la versión deployada tiene otro tipo de retorno (42P13).
DROP FUNCTION IF EXISTS public.get_user_limits_summary(uuid);

CREATE FUNCTION public.get_user_limits_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_custom_d numeric; v_custom_m numeric; v_user_curr text; v_global jsonb;
    v_flag_d boolean; v_flag_m boolean;
    v_eff_daily numeric; v_eff_monthly numeric; v_eff_currency text;
    v_used_d numeric := 0; v_used_m numeric := 0; v_caller_role text;
    v_owner_col text;
BEGIN
    IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error','not_authenticated'); END IF;
    SELECT admin_role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    IF auth.uid() <> p_user_id
       AND COALESCE(v_caller_role,'') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error','forbidden');
    END IF;

    SELECT custom_daily_limit, custom_monthly_limit, limits_currency,
           COALESCE(is_custom_daily, false), COALESCE(is_custom_monthly, false)
    INTO v_custom_d, v_custom_m, v_user_curr, v_flag_d, v_flag_m
    FROM public.users WHERE id = p_user_id;

    -- Un tope custom guardado cuenta como custom aunque el flag viejo esté en false
    v_flag_d := v_flag_d OR (v_custom_d IS NOT NULL);
    v_flag_m := v_flag_m OR (v_custom_m IS NOT NULL);

    SELECT value INTO v_global FROM public.app_settings WHERE key = 'operational_limits';

    -- El custom SIEMPRE gana sobre el global cuando existe
    v_eff_daily    := CASE WHEN v_flag_d AND v_custom_d IS NOT NULL THEN v_custom_d
                           ELSE COALESCE((v_global->>'daily')::numeric,   800) END;
    v_eff_monthly  := CASE WHEN v_flag_m AND v_custom_m IS NOT NULL THEN v_custom_m
                           ELSE COALESCE((v_global->>'monthly')::numeric, 6000) END;
    v_eff_currency := COALESCE(v_user_curr, v_global->>'currency', 'USD');

    -- La columna del dueño en transactions varía por entorno
    -- (user_id / owner_user_id / sender_id / from_user_id): detectarla
    -- en vez de asumir 'user_id' (error en iOS: column "user_id" does not exist).
    SELECT column_name INTO v_owner_col
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions'
      AND column_name IN ('user_id','owner_user_id','sender_id','from_user_id')
    ORDER BY array_position(ARRAY['user_id','owner_user_id','sender_id','from_user_id'], column_name)
    LIMIT 1;

    -- Solo cargas (kind='load'); cada monto convertido a la moneda del
    -- tope ANTES de sumar. Si algo falla (columna/tabla distinta), el
    -- consumo queda en 0 pero los topes sí se devuelven.
    IF v_owner_col IS NOT NULL THEN
        BEGIN
            EXECUTE format(
                'SELECT
                    COALESCE(SUM(CASE WHEN created_at >= now() - interval ''24 hours''
                        THEN public.to_currency(COALESCE(amount,0), COALESCE(currency, $2), $2) ELSE 0 END), 0),
                    COALESCE(SUM(public.to_currency(COALESCE(amount,0), COALESCE(currency, $2), $2)), 0)
                 FROM public.transactions
                 WHERE %I = $1
                   AND created_at >= now() - interval ''30 days''
                   AND kind = ''load''
                   AND status IN (''completed'',''approved'',''sent'',''success'')',
                v_owner_col)
            INTO v_used_d, v_used_m
            USING p_user_id, v_eff_currency;
        EXCEPTION WHEN OTHERS THEN
            v_used_d := 0; v_used_m := 0;
        END;
    END IF;

    RETURN jsonb_build_object(
        'currency',          v_eff_currency,
        'daily_max',         v_eff_daily,
        'monthly_max',       v_eff_monthly,
        'daily_used',        ROUND(v_used_d::numeric, 2),
        'monthly_used',      ROUND(v_used_m::numeric, 2),
        'daily_pct',         CASE WHEN v_eff_daily   > 0 THEN ROUND((v_used_d / v_eff_daily   * 100)::numeric, 2) ELSE 0 END,
        'monthly_pct',       CASE WHEN v_eff_monthly > 0 THEN ROUND((v_used_m / v_eff_monthly * 100)::numeric, 2) ELSE 0 END,
        'is_custom_daily',   v_flag_d,
        'is_custom_monthly', v_flag_m
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_limits_summary(uuid) TO authenticated;

-- ═══ 4. admin_set_user_limits mantiene los flags ═══
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
        limits_currency      = p_currency,
        is_custom_daily      = (p_daily_limit   IS NOT NULL),
        is_custom_monthly    = (p_monthly_limit IS NOT NULL)
    WHERE id = p_user_id;

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

NOTIFY pgrst, 'reload schema';

-- ═══ Verificación (opcional, correr aparte) ═══
-- SELECT public.get_user_limits_summary(id) FROM public.users
--   WHERE email = 'bryandavidortiz51@gmail.com';
