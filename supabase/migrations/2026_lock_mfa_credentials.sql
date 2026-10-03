-- ════════════════════════════════════════════════════════════════════
-- 2026_lock_mfa_credentials.sql
--
-- POR QUÉ: el 2FA del admin se apaga solo, una y otra vez, y SOLO el del
-- admin. La razón es que el blindaje de raw_data
-- (guard_raw_data_server_keys) considera privilegiado a CUALQUIER admin:
--
--     IF public.is_any_admin() THEN is_privileged := TRUE; END IF;
--     IF is_privileged THEN RETURN NEW;  -- pasa sin tocar nada
--
-- Es decir: para un cliente normal las claves del 2FA están blindadas,
-- pero para el admin NO hay red debajo. Cualquier escritura de raw_data
-- desde su navegador que llegue con una copia vieja —un guardado de
-- perfil, un merge que perdió una carrera, un flujo que aún no conocemos—
-- le borra el 2FA. Al cliente no le pasa porque el trigger se lo repone.
--
-- QUÉ HACE ESTE ARCHIVO:
--
--  1) Separa las CREDENCIALES del resto. Las claves del segundo factor
--     solo las puede cambiar el service_role (las edge functions:
--     mfa_set, mfa_disable, mfa_verify). Ni el admin desde el navegador.
--     No es una restricción molesta: no existe ningún camino legítimo en
--     el que el navegador del admin deba escribir su propio 2FA.
--
--  2) Deja RASTRO. Cada vez que mfaEnabled cambie de valor se escribe una
--     fila en audit_log con quién y con qué rol lo hizo. Si vuelve a
--     apagarse, deja de ser un misterio: se consulta y se ve.
--
-- Pegar en el SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.guard_raw_data_server_keys()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_service boolean := FALSE;
  is_admin   boolean := FALSE;
  k text;
  -- Claves del servidor que un ADMIN sí puede tocar (operación normal).
  protected text[] := ARRAY[
    'gasfreeCredited', 'gasfreeCreditedTxs', 'gasfreeCreditedCount',
    'gasfreeIndex', 'gasfreeHdIndex', 'gasfreeAddress',
    'gasfreeEoa', 'gasfreeAddresses', 'subWallets'
  ];
  -- CREDENCIALES: solo el service_role. Son la llave de entrada a la
  -- cuenta; nadie las escribe desde un navegador, admin incluido.
  credentials text[] := ARRAY[
    'mfaEnabled', 'mfaFactorId', 'totpSecret', 'totpSecretEnc',
    'mfaBackupHashes', 'mfaSessions', 'mfaLastCounter', 'otp'
  ];
  oldraw jsonb := COALESCE(OLD.raw_data, '{}'::jsonb);
  newraw jsonb := COALESCE(NEW.raw_data, '{}'::jsonb);
BEGIN
  BEGIN
    IF auth.role() = 'service_role' THEN is_service := TRUE; END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF is_service THEN
    RETURN NEW;   -- las edge functions son la vía legítima
  END IF;

  BEGIN
    IF public.is_any_admin() THEN is_admin := TRUE; END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF newraw IS DISTINCT FROM oldraw THEN
    -- Las credenciales se reponen SIEMPRE (también para el admin).
    FOREACH k IN ARRAY credentials LOOP
      IF oldraw ? k THEN
        newraw := jsonb_set(newraw, ARRAY[k], oldraw -> k, true);
      ELSE
        newraw := newraw - k;
      END IF;
    END LOOP;

    -- El resto de claves del servidor: el admin sí puede cambiarlas.
    IF NOT is_admin THEN
      FOREACH k IN ARRAY protected LOOP
        IF oldraw ? k THEN
          newraw := jsonb_set(newraw, ARRAY[k], oldraw -> k, true);
        ELSE
          newraw := newraw - k;
        END IF;
      END LOOP;
    END IF;

    NEW.raw_data := newraw;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_raw_data_server_keys ON public.users;
CREATE TRIGGER trg_guard_raw_data_server_keys
  BEFORE UPDATE OF raw_data ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_raw_data_server_keys();

-- ── Rastro de cada cambio del 2FA ───────────────────────────────────
-- AFTER UPDATE: se dispara con el valor YA aplicado, así que registra lo
-- que de verdad quedó guardado (no lo que se intentó).
CREATE OR REPLACE FUNCTION public.audit_mfa_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  before_val text := COALESCE(OLD.raw_data ->> 'mfaEnabled', 'ausente');
  after_val  text := COALESCE(NEW.raw_data ->> 'mfaEnabled', 'ausente');
  who        text;
  who_role   text;
BEGIN
  IF before_val IS NOT DISTINCT FROM after_val THEN
    RETURN NEW;
  END IF;
  BEGIN who := COALESCE(auth.uid()::text, 'sin sesión'); EXCEPTION WHEN OTHERS THEN who := 'desconocido'; END;
  BEGIN who_role := COALESCE(auth.role(), 'desconocido'); EXCEPTION WHEN OTHERS THEN who_role := 'desconocido'; END;

  BEGIN
    INSERT INTO public.audit_log (user_id, action, metadata)
    VALUES (NEW.id, 'security.mfa_changed', jsonb_build_object(
      'antes', before_val,
      'despues', after_val,
      'cuenta', NEW.email,
      'cambiadoPor', who,
      'rolDeLaSesion', who_role,
      'at', now()
    ));
  EXCEPTION WHEN OTHERS THEN
    NULL;   -- si audit_log no existe o falla, jamás romper el update
  END;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_mfa_change ON public.users;
CREATE TRIGGER trg_audit_mfa_change
  AFTER UPDATE OF raw_data ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_mfa_change();

NOTIFY pgrst, 'reload schema';
