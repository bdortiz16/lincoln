-- ════════════════════════════════════════════════════════════════════
-- 2026_kumplo_protected_key.sql
--
-- Agrega 'kumplo' a las claves de raw_data que SOLO el servidor escribe.
--
-- Ahí vive el veredicto AML (riesgo bajo/medio/alto) y el id de la persona en
-- Kumplo. Si un cliente pudiera escribirlo por PATCH directo a su propio
-- raw_data, se pondría "riesgo bajo" a sí mismo y el control de lavado de
-- activos dejaría de existir — sería una casilla de preferencias, no un
-- veredicto de cumplimiento.
--
-- ESTE ARCHIVO REDEFINE LA FUNCIÓN COMPLETA, a propósito.
-- La primera versión intentaba parchear el cuerpo de la función con un
-- replace() sobre el texto que devuelve pg_get_functiondef. No coincidió —el
-- formato guardado no es idéntico al del archivo— y, peor, NO FALLÓ: volvía a
-- crear la función igual que estaba y dejaba creer que la clave había quedado
-- protegida. Una protección que se cree puesta y no lo está es peor que no
-- tenerla. Acá se escribe la lista entera, a la vista.
--
-- Es la MISMA definición de 2026_guard_raw_data_server_keys.sql con una clave
-- más. Si aquella cambia, hay que reflejarlo aquí.
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
  is_privileged boolean;
  k text;
  -- Claves de raw_data que SOLO el servidor puede cambiar.
  -- OJO: 'gasfreeCreditedTxs' y 'gasfreeCreditedCount' son el ledger de
  -- deduplicación de depósitos USDT del esquema NUEVO (por-TxID). Sin
  -- protegerlos, un cliente podía resetearlos por PATCH directo a su propio
  -- raw_data y re-acreditar depósitos ya acreditados (minteo repetible) —
  -- el mismo agujero que 'gasfreeCredited' cerró para el esquema viejo.
  protected text[] := ARRAY[
    'gasfreeCredited', 'gasfreeCreditedTxs', 'gasfreeCreditedCount',
    'gasfreeIndex', 'gasfreeHdIndex', 'gasfreeAddress',
    'gasfreeEoa', 'gasfreeAddresses', 'subWallets',
    'mfaEnabled', 'mfaFactorId', 'totpSecret', 'totpSecretEnc', 'otp',
    -- 'mfaBackupHashes' son los códigos de respaldo del 2FA (hasheados). Si el
    -- cliente pudiera escribirlos, plantaría sus propios códigos y entraría a
    -- cualquier cuenta sin el TOTP: es una credencial, no una preferencia.
    'mfaBackupHashes',
    -- 'mfaSessions' marca QUE sesion supero el 2FA. Si el cliente pudiera
    -- escribirla, se anotaria a si mismo como verificado y el segundo factor
    -- del servidor dejaria de valer.
    'mfaSessions',
    -- 'kumplo' guarda el veredicto AML y el id de la persona en Kumplo.
    -- Escribirlo desde el cliente seria ponerse "riesgo bajo" uno mismo.
    'kumplo'
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

-- Comprobación: las dos columnas deben decir true.
SELECT
  position('''kumplo''' in pg_get_functiondef(p.oid)) > 0 AS kumplo_protegido,
  EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgname = 'trg_guard_raw_data_server_keys' AND NOT t.tgisinternal
  ) AS trigger_puesto
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'guard_raw_data_server_keys' AND n.nspname = 'public';
