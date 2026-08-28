-- ───────────────────────────────────────────────────────
-- 2026_2fa_and_recovery.sql
--
-- Dos problemas que este script resuelve:
--
-- 1) 2FA desde la app (iOS/Android): el .update() directo a
--    users.two_factor_secret / is_2fa_enabled fallaba en silencio por RLS.
--    En vez de abrir una policy de UPDATE sobre la fila (RLS es por FILA,
--    no por columna — permitiría al usuario tocarse kyc_status, topes, etc.)
--    exponemos un RPC SECURITY DEFINER que SOLO toca esas dos columnas y
--    SOLO sobre la propia cuenta (p_uid debe ser auth.uid()).
--
-- 2) Recuperación de acceso desde Admin Personas: si el usuario perdió el
--    acceso a su correo (y sin correo no puede resetear clave ni 2FA), el
--    admin puede: cambiar el correo de login, asignar una contraseña
--    temporal, apagar el 2FA, resetear el PIN y cerrar las sesiones
--    activas. Todo vía RPC admin_recover_user_access, restringido a
--    super_admin / support / compliance.
--
-- Pegar completo en el SQL Editor del proyecto Personas.
-- ───────────────────────────────────────────────────────

-- Columnas de 2FA (por si aún no existen en este entorno)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS two_factor_secret text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_2fa_enabled boolean DEFAULT false;

-- ───────────────────────────────────────────────────────
-- (1) RPC para la app: el usuario configura/borra SU PROPIO 2FA.
--     p_secret NULL o vacío ⇒ desactiva el 2FA.
--     Firma exacta pedida por Antigravity: set_2fa_secret_by_id(p_secret, p_uid)
-- ───────────────────────────────────────────────────────
-- Si ya existía una versión previa con otro tipo de retorno (42P13:
-- "cannot change return type"), hay que soltarla antes de recrearla.
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

-- ───────────────────────────────────────────────────────
-- Helper: ¿el que llama es un admin con derechos de recuperación?
-- Tolera que exista admin_role, role, o ambas (varía entre entornos).
-- ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_has_recovery_rights()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ok boolean := false;
BEGIN
    IF auth.uid() IS NULL THEN RETURN false; END IF;

    BEGIN
        SELECT (admin_role IN ('super_admin','support','compliance')) INTO v_ok
        FROM public.users WHERE id = auth.uid();
    EXCEPTION WHEN undefined_column THEN v_ok := false;
    END;

    IF NOT COALESCE(v_ok, false) THEN
        BEGIN
            SELECT (role IN ('super_admin','support','compliance')) INTO v_ok
            FROM public.users WHERE id = auth.uid();
        EXCEPTION WHEN undefined_column THEN v_ok := false;
        END;
    END IF;

    RETURN COALESCE(v_ok, false);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_has_recovery_rights() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_has_recovery_rights() TO authenticated;

-- ───────────────────────────────────────────────────────
-- (2) RPC de recuperación de acceso (solo admins).
--     Todo es opcional: solo se aplica lo que venga con valor.
--       p_new_email      → cambia el correo de login (auth.users + public.users)
--                          y lo deja confirmado para que pueda entrar ya.
--       p_temp_password  → asigna una contraseña temporal (bcrypt, igual que GoTrue).
--       p_reset_2fa      → borra two_factor_secret + is_2fa_enabled=false
--                          (y factores MFA nativos si existieran).
--       p_reset_pin      → pin_hash = NULL (la app pide crear uno nuevo).
--       p_close_sessions → mata sesiones y refresh tokens activos (default true),
--                          por si la cuenta estaba comprometida.
-- ───────────────────────────────────────────────────────
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

    -- Cambio de correo de login
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

    -- Contraseña temporal (mismo bcrypt que usa GoTrue)
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

    -- Apagar 2FA
    IF p_reset_2fa THEN
        UPDATE public.users
        SET two_factor_secret = NULL,
            is_2fa_enabled    = false
        WHERE id = p_user_id;
        BEGIN
            DELETE FROM auth.mfa_factors WHERE user_id = p_user_id;
        EXCEPTION WHEN OTHERS THEN NULL; -- tabla puede no existir / sin permisos: no es crítico
        END;
        v_applied := v_applied || '2fa';
    END IF;

    -- Resetear PIN
    IF p_reset_pin THEN
        UPDATE public.users SET pin_hash = NULL WHERE id = p_user_id;
        v_applied := v_applied || 'pin';
    END IF;

    -- Cerrar sesiones activas
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
