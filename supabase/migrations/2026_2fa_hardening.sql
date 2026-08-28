-- ───────────────────────────────────────────────────────
-- 2026_2fa_hardening.sql  (v3 — reemplaza y refuerza el 2FA completo)
--
-- Síntoma reportado: el 2FA "se desactiva solo", no persiste y no
-- aparece al entrar desde otro dispositivo. Causa típica: el secreto
-- solo se guardó LOCAL en el teléfono (el .update() directo lo bloquea
-- RLS en silencio) o algún flujo lo pisa al hacer upsert del perfil.
--
-- Este script deja el 2FA blindado:
--   1. set_2fa_secret_by_id(p_secret, p_uid)  → ÚNICA vía para escribir
--      el 2FA propio (activa/desactiva).
--   2. get_my_2fa()                           → lectura garantizada del
--      estado + secreto del PROPIO usuario (inmune a policies de SELECT
--      restrictivas). Para verificar TOTP en un dispositivo nuevo.
--   3. Trigger guardián: cualquier UPDATE que intente tocar
--      two_factor_secret / is_2fa_enabled SIN pasar por los RPCs
--      autorizados se IGNORA (se conservan los valores previos). Así
--      ningún upsert de perfil ni sync del app puede resetear el 2FA.
--   4. admin_recover_user_access actualizado para seguir pudiendo
--      apagar 2FA desde el panel (marca la misma llave del guardián).
--
-- Idempotente: correr completo las veces que haga falta.
-- ───────────────────────────────────────────────────────

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS two_factor_secret text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_2fa_enabled boolean DEFAULT false;

-- ═══ 1. Escritura: set_2fa_secret_by_id ═══
DROP FUNCTION IF EXISTS public.set_2fa_secret_by_id(text, uuid);

CREATE FUNCTION public.set_2fa_secret_by_id(p_secret text, p_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_enabled boolean := (p_secret IS NOT NULL AND length(trim(p_secret)) > 0);
BEGIN
    IF auth.uid() IS NULL OR p_uid IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Solo puedes modificar el 2FA de tu propia cuenta';
    END IF;

    -- Autorizar el cambio ante el trigger guardián (transaction-local)
    PERFORM set_config('cuypay.allow_2fa_change', '1', true);

    UPDATE public.users
    SET two_factor_secret = NULLIF(trim(coalesce(p_secret, '')), ''),
        is_2fa_enabled    = v_enabled
    WHERE id = p_uid;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usuario no encontrado';
    END IF;

    RETURN jsonb_build_object('ok', true, 'enabled', v_enabled);
END;
$$;

REVOKE ALL ON FUNCTION public.set_2fa_secret_by_id(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_2fa_secret_by_id(text, uuid) TO authenticated;

-- ═══ 2. Lectura: get_my_2fa ═══
DROP FUNCTION IF EXISTS public.get_my_2fa();

CREATE FUNCTION public.get_my_2fa()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_secret text; v_enabled boolean;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;

    SELECT two_factor_secret, COALESCE(is_2fa_enabled, false)
    INTO v_secret, v_enabled
    FROM public.users WHERE id = auth.uid();

    RETURN jsonb_build_object(
        'ok',      true,
        'enabled', COALESCE(v_enabled, false) AND v_secret IS NOT NULL,
        'secret',  v_secret
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_2fa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_2fa() TO authenticated;

-- ═══ 3. Trigger guardián: nadie pisa el 2FA por fuera de los RPCs ═══
CREATE OR REPLACE FUNCTION public.guard_2fa_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF (NEW.two_factor_secret IS DISTINCT FROM OLD.two_factor_secret
        OR NEW.is_2fa_enabled IS DISTINCT FROM OLD.is_2fa_enabled)
       AND COALESCE(current_setting('cuypay.allow_2fa_change', true), '') <> '1' THEN
        -- Cambio NO autorizado (update directo, upsert de perfil, sync):
        -- se conservan los valores previos sin romper el resto del UPDATE.
        NEW.two_factor_secret := OLD.two_factor_secret;
        NEW.is_2fa_enabled    := OLD.is_2fa_enabled;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_2fa ON public.users;
CREATE TRIGGER trg_guard_2fa
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_2fa_columns();

-- ═══ 4. admin_recover_user_access: autorizar su reset de 2FA ═══
DROP FUNCTION IF EXISTS public.admin_recover_user_access(uuid, text, text, boolean, boolean, boolean);

CREATE FUNCTION public.admin_recover_user_access(
    p_user_id        uuid,
    p_new_email      text    DEFAULT NULL,
    p_temp_password  text    DEFAULT NULL,
    p_reset_2fa      boolean DEFAULT false,
    p_reset_pin      boolean DEFAULT false,
    p_close_sessions boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_applied text[] := '{}';
    v_email   text   := NULLIF(lower(trim(coalesce(p_new_email, ''))), '');
BEGIN
    IF NOT public.admin_has_recovery_rights() THEN
        RAISE EXCEPTION 'No autorizado: se requiere rol super_admin, support o compliance';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'Usuario no encontrado en auth.users';
    END IF;

    IF v_email IS NOT NULL THEN
        IF v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
            RAISE EXCEPTION 'Correo inválido: %', v_email;
        END IF;
        IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email AND id <> p_user_id) THEN
            RAISE EXCEPTION 'Ese correo ya está en uso por otra cuenta';
        END IF;

        UPDATE auth.users
        SET email                      = v_email,
            email_confirmed_at         = COALESCE(email_confirmed_at, now()),
            email_change               = '',
            email_change_token_new     = '',
            email_change_token_current = '',
            updated_at                 = now()
        WHERE id = p_user_id;

        UPDATE public.users SET email = v_email WHERE id = p_user_id;
        v_applied := v_applied || 'email';
    END IF;

    IF p_temp_password IS NOT NULL AND length(p_temp_password) > 0 THEN
        IF length(p_temp_password) < 8 THEN
            RAISE EXCEPTION 'La contraseña temporal debe tener al menos 8 caracteres';
        END IF;
        UPDATE auth.users
        SET encrypted_password = extensions.crypt(p_temp_password, extensions.gen_salt('bf')),
            recovery_token     = '',
            updated_at         = now()
        WHERE id = p_user_id;
        v_applied := v_applied || 'password';
    END IF;

    IF p_reset_2fa THEN
        PERFORM set_config('cuypay.allow_2fa_change', '1', true);
        UPDATE public.users
        SET two_factor_secret = NULL,
            is_2fa_enabled    = false
        WHERE id = p_user_id;
        BEGIN
            DELETE FROM auth.mfa_factors WHERE user_id = p_user_id;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        v_applied := v_applied || '2fa';
    END IF;

    IF p_reset_pin THEN
        UPDATE public.users SET pin_hash = NULL WHERE id = p_user_id;
        v_applied := v_applied || 'pin';
    END IF;

    IF p_close_sessions THEN
        BEGIN
            DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        BEGIN
            DELETE FROM auth.sessions WHERE user_id = p_user_id;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        v_applied := v_applied || 'sessions';
    END IF;

    RETURN jsonb_build_object('ok', true, 'applied', to_jsonb(v_applied));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_recover_user_access(uuid, text, text, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_recover_user_access(uuid, text, text, boolean, boolean, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ═══ Verificación (correr aparte después de aplicar) ═══
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname='public'
--   AND p.proname IN ('set_2fa_secret_by_id','get_my_2fa','admin_recover_user_access');
