-- ============================================================================
-- EL ROL DE ADMIN SOLO LO DA EL SERVIDOR (O UN ADMIN EN LA BASE). NUNCA UN
-- CLIENTE, NI AL REGISTRARSE, NI ACTUALIZANDO, NI BORRANDO Y VOLVIENDO A
-- CREAR SU FILA.
--
-- POR QUE EXISTE ESTE ARCHIVO:
--
-- Se reporto que cuentas normales aparecian como admin en el Centro de
-- Comando. En el codigo, eso era una etiqueta mal puesta (contaba el login
-- con codigo 2FA de cualquier cliente como ingreso de admin; ya corregido en
-- admin-data). Pero la auditoria encontro un hueco REAL que depende de que
-- ciertas migraciones esten corridas en la base viva:
--
--   1. La politica de INSERT de public.users solo pide auth.uid() = id. La
--      fila del perfil la manda el navegador, con el rol que quiera. El unico
--      freno es el trigger trg_guard_users_insert (2026_zz3). Si ese trigger
--      no esta, cualquiera que se registre puede mandar role = admin y
--      verifyAdmin lo acepta.
--   2. Una politica vieja, allow_upsert_own_user (create_transactions_table),
--      es FOR ALL: deja al usuario BORRAR su propia fila y volverla a insertar
--      como admin. 2026_zz_cierre_rls_abierta no la quita.
--
-- Este archivo cierra las dos cosas sin depender del orden en que se hayan
-- corrido las demas: es idempotente y no nombra columnas que quiza no
-- existan (misma tecnica de 2026_zz3).
--
-- DESPUES DE CORRERLO, en otra pestana:
--   SELECT id, email, role, created_at FROM public.users WHERE role = 'admin';
-- Cada fila tiene que ser alguien del equipo. Si hay una cuenta que no lo
-- es:  UPDATE public.users SET role = 'business' WHERE id = '<id>';
-- ============================================================================


-- ─── 1. Al registrarse nadie es admin (mismo guardia de 2026_zz3) ───────────
CREATE OR REPLACE FUNCTION public.guard_users_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $guard_insert$
DECLARE
  privilegiado boolean := false;
  fila  jsonb;
  raw   jsonb;
  k     text;
  rol   text;
  protegidas text[] := ARRAY[
    'kumplo', 'tusdatos', 'gasfreeCredited', 'mfaBackupHashes',
    'blacklisted', 'isBlocked', 'otcConfig'
  ];
  neutros jsonb := jsonb_build_object(
    'admin_role',           null,
    'balances',             '{}'::jsonb,
    'crypto_balances',      '{}'::jsonb,
    'is_blocked',           false,
    'compliance_hold',      false,
    'custom_monthly_limit', null,
    'custom_daily_limit',   null,
    'is_custom_monthly',    false,
    'is_custom_daily',      false,
    'kyc_status',           'pending'
  );
BEGIN
  BEGIN
    IF auth.role() = 'service_role' THEN privilegiado := true; END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF NOT privilegiado THEN
    BEGIN
      IF public.is_any_admin() THEN privilegiado := true; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  IF privilegiado THEN
    RETURN NEW;
  END IF;

  fila := to_jsonb(NEW);

  FOR k IN SELECT jsonb_object_keys(neutros) LOOP
    IF fila ? k THEN
      fila := jsonb_set(fila, ARRAY[k], neutros -> k, true);
    END IF;
  END LOOP;

  IF fila ? 'role' THEN
    rol := COALESCE(fila ->> 'role', '');
    IF rol NOT IN ('business', 'personal', '') THEN
      fila := jsonb_set(fila, ARRAY['role'], to_jsonb('business'::text), true);
    END IF;
  END IF;

  IF fila ? 'raw_data' THEN
    raw := fila -> 'raw_data';
    IF raw IS NULL OR jsonb_typeof(raw) <> 'object' THEN
      raw := '{}'::jsonb;
    END IF;
    FOREACH k IN ARRAY protegidas LOOP
      raw := raw - k;
    END LOOP;
    fila := jsonb_set(fila, ARRAY['raw_data'], raw, true);
  END IF;

  NEW := jsonb_populate_record(NEW, fila);
  RETURN NEW;
END;
$guard_insert$;

REVOKE ALL ON FUNCTION public.guard_users_insert() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_guard_users_insert ON public.users;
CREATE TRIGGER trg_guard_users_insert
  BEFORE INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_users_insert();


-- ─── 2. Al actualizar, el rol no cambia si no lo cambia un admin ───────────
-- Refuerzo del guardia de columnas sensibles: aunque ese guardia no este,
-- role y admin_role vuelven a lo que eran. Sin nombrar columnas a ciegas.
CREATE OR REPLACE FUNCTION public.guard_users_role_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $guard_role$
DECLARE
  privilegiado boolean := false;
  nueva jsonb;
  vieja jsonb;
  k     text;
BEGIN
  BEGIN
    IF auth.role() = 'service_role' THEN privilegiado := true; END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF NOT privilegiado THEN
    BEGIN
      IF public.is_any_admin() THEN privilegiado := true; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF privilegiado THEN
    RETURN NEW;
  END IF;

  nueva := to_jsonb(NEW);
  vieja := to_jsonb(OLD);
  FOREACH k IN ARRAY ARRAY['role', 'admin_role'] LOOP
    IF nueva ? k THEN
      nueva := jsonb_set(nueva, ARRAY[k], COALESCE(vieja -> k, 'null'::jsonb), true);
    END IF;
  END LOOP;
  NEW := jsonb_populate_record(NEW, nueva);
  RETURN NEW;
END;
$guard_role$;

REVOKE ALL ON FUNCTION public.guard_users_role_update() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_guard_users_role_update ON public.users;
CREATE TRIGGER trg_guard_users_role_update
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_users_role_update();


-- ─── 3. Nadie borra su propia fila (borrar y recrear como admin) ────────────
CREATE OR REPLACE FUNCTION public.guard_users_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $guard_delete$
DECLARE
  privilegiado boolean := false;
BEGIN
  BEGIN
    IF auth.role() = 'service_role' THEN privilegiado := true; END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF NOT privilegiado THEN
    BEGIN
      IF public.is_any_admin() THEN privilegiado := true; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF privilegiado THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Solo un administrador puede borrar un perfil.';
END;
$guard_delete$;

REVOKE ALL ON FUNCTION public.guard_users_delete() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_guard_users_delete ON public.users;
CREATE TRIGGER trg_guard_users_delete
  BEFORE DELETE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_users_delete();


-- ─── 4. Fuera las politicas abiertas que quedaron de antes ──────────────────
DROP POLICY IF EXISTS "allow_upsert_own_user"  ON public.users;
DROP POLICY IF EXISTS "allow_select_all_users" ON public.users;
