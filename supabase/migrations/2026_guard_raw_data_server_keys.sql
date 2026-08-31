-- ════════════════════════════════════════════════════════════════════
-- 2026_guard_raw_data_server_keys.sql
--
-- BLINDAJE A NIVEL DE BASE de los campos de raw_data que administra SOLO el
-- servidor. Cierra DOS agujeros de una vez:
--
--  1) MINTEO DE DINERO (crítico): raw_data se sacó de la guarda de columnas
--     sensibles y la RLS deja al usuario actualizar SU propia fila. Así, desde
--     el navegador, un cliente podía escribir raw_data.gasfreeCredited = -1e9;
--     luego my_verify_deposit calculaba diff = onchain - credited ≈ 1e9 y le
--     acreditaba ~mil millones de USD (y de ahí a COP y retiro). CERO capital.
--
--  2) 2FA/WALLET que "se apagaban/movían solos": el mismo update directo de
--     raw_data (o un merge parcial tras un timeout) borraba mfaEnabled/
--     totpSecret o cambiaba gasfreeIndex.
--
-- Solución: un trigger BEFORE UPDATE que, para escrituras NO privilegiadas
-- (cualquiera que no sea el service_role de las edge functions ni un admin),
-- REVIERTE esas claves protegidas a su valor anterior. El cliente puede seguir
-- guardando SUS cosas (notificaciones, contactos, preferencias) — pero jamás
-- toca los campos del servidor. Las edge functions (service_role) y los admins
-- sí pueden cambiarlos (mfa_set, mfa_disable, gasfree, etc.).
--
-- Pegar en el SQL Editor del proyecto correspondiente. Idempotente.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.guard_raw_data_server_keys()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_privileged boolean;
  k text;
  -- Claves de raw_data que SOLO el servidor puede cambiar.
  protected text[] := ARRAY[
    'gasfreeCredited', 'gasfreeIndex', 'gasfreeHdIndex', 'gasfreeAddress',
    'gasfreeEoa', 'gasfreeAddresses', 'subWallets',
    'mfaEnabled', 'mfaFactorId', 'totpSecret', 'totpSecretEnc', 'otp'
  ];
  oldraw jsonb := COALESCE(OLD.raw_data, '{}'::jsonb);
  newraw jsonb := COALESCE(NEW.raw_data, '{}'::jsonb);
BEGIN
  -- El service_role (edge functions) y los admins tienen vía libre.
  is_privileged := FALSE;
  BEGIN
    IF auth.role() = 'service_role' THEN is_privileged := TRUE; END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Si auth.role() no existe en este proyecto, caemos a is_any_admin abajo.
    NULL;
  END;
  IF NOT is_privileged THEN
    BEGIN
      IF public.is_any_admin() THEN is_privileged := TRUE; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  IF is_privileged THEN
    RETURN NEW;
  END IF;

  -- Escritura NO privilegiada: para cada clave protegida, se conserva el valor
  -- ANTERIOR (si existía) o se elimina (si no existía) — el cliente NO la mueve.
  IF newraw IS DISTINCT FROM oldraw THEN
    FOREACH k IN ARRAY protected LOOP
      IF oldraw ? k THEN
        newraw := jsonb_set(newraw, ARRAY[k], oldraw -> k, true);
      ELSE
        newraw := newraw - k;
      END IF;
    END LOOP;
    NEW.raw_data := newraw;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_raw_data_server_keys ON public.users;
CREATE TRIGGER trg_guard_raw_data_server_keys
  BEFORE UPDATE OF raw_data ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_raw_data_server_keys();

NOTIFY pgrst, 'reload schema';
