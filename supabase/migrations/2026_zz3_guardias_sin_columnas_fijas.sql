-- ============================================================================
-- LOS GUARDIAS NO PUEDEN NOMBRAR COLUMNAS QUE QUIZA NO EXISTEN
-- ============================================================================
--
-- POR QUE EXISTE ESTE ARCHIVO:
--
-- guard_users_insert hacia NEW.admin_role := NULL. En public.users de este
-- proyecto NO hay columna admin_role. PL/pgSQL no se queja al CREAR la
-- funcion -- compila el cuerpo la primera vez que corre -- asi que el script
-- termino con "Success" y el trigger quedo puesto. El fallo aparecia despues,
-- en cada INSERT: record new has no field admin_role. O sea que el guardia que
-- debia impedir que alguien se registrara como admin impedia que se registrara
-- NADIE.
--
-- El guardia se escribio contra _lincoin_full_schema.sql, que es una
-- reconstruccion best-effort del esquema, no contra la base real. La pista
-- estaba a la vista y no la lei: apply_limit_increase no existia en este
-- proyecto, lo que significaba que su migracion nunca se habia corrido aca --
-- y con ella tampoco las columnas is_custom_daily e is_custom_monthly que esa
-- migracion agrega.
--
-- COMO SE ARREGLA, PARA QUE NO VUELVA A PASAR:
--
-- Ninguna de las dos funciones nombra ya una columna a ciegas.
--
--   · guard_users_insert convierte la fila a jsonb, cambia SOLO las claves que
--     la fila realmente trae, y la vuelve a armar. Si la columna no esta, no
--     hay nada que neutralizar y no hay nada que romper. Si manana alguien
--     agrega admin_role, el guardia empieza a protegerla sin tocar nada.
--
--   · apply_limit_increase arma su UPDATE en tiempo de ejecucion con las
--     columnas de topes que existan. Si no existe ninguna, no actualiza nada
--     pero deja aprobar la solicitud: trabar el boton Aprobar seria peor.
--
-- Es idempotente y no cambia lo que los guardias PROTEGEN, solo como lo hacen.
--
-- NOTA PARA EL EDITOR DE SUPABASE: sin comillas simples en los comentarios, y
-- cada bloque con su propia etiqueta de dollar-quote. La comprobacion va en
-- otra pestana -- si viaja pegada y falla, revierte el DDL de arriba.
-- ============================================================================


-- ─── 1. Nadie se crea admin al registrarse, y nadie deja de poder registrarse ─
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
  -- Claves de raw_data que un perfil recien creado NO puede traer.
  protegidas text[] := ARRAY[
    'kumplo', 'tusdatos', 'gasfreeCredited', 'mfaBackupHashes',
    'blacklisted', 'isBlocked', 'otcConfig'
  ];
  -- Columnas que se neutralizan SI EXISTEN. Un perfil recien creado no es
  -- admin, no tiene saldo y no trae veredicto de cumplimiento; todo eso lo
  -- escribe el servidor despues.
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

  -- Solo se toca lo que la fila REALMENTE tiene. Esta es la linea que evita
  -- que el guardia se caiga por una columna que no existe.
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


-- ─── 2. Aprobar topes: solo un admin, y solo las columnas que existan ───────
CREATE OR REPLACE FUNCTION public.apply_limit_increase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $apply_limit$
DECLARE
  v_amount     numeric;
  privilegiado boolean := false;
  sets         text[]  := '{}';
  hay          boolean;
BEGIN
  IF NEW.status = 'approved'
     AND COALESCE(OLD.status, '') IS DISTINCT FROM 'approved' THEN

    -- El servidor (edge functions) y los admins pueden aprobar. Nadie mas.
    BEGIN
      IF auth.role() = 'service_role' THEN privilegiado := true; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    IF NOT privilegiado THEN
      BEGIN
        IF public.is_any_admin() THEN privilegiado := true; END IF;
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;

    IF NOT privilegiado THEN
      RAISE EXCEPTION 'Solo un administrador puede aprobar un aumento de limites.';
    END IF;

    BEGIN
      v_amount := NULLIF(trim(NEW.requested_amount::text), '')::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_amount := NULL;   -- monto ilegible: no aplicar nada, pero no romper el Aprobar
    END;

    IF v_amount IS NOT NULL AND v_amount > 0 THEN

      SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'users'
                       AND column_name = 'custom_monthly_limit') INTO hay;
      IF hay THEN
        sets := sets || format('custom_monthly_limit = %L::numeric', v_amount);
      END IF;

      SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'users'
                       AND column_name = 'custom_daily_limit') INTO hay;
      IF hay THEN
        sets := sets || format(
          'custom_daily_limit = GREATEST(COALESCE(custom_daily_limit, 0)::numeric, ROUND(%L::numeric * 0.2))',
          v_amount);
      END IF;

      SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'users'
                       AND column_name = 'limits_currency') INTO hay;
      IF hay THEN
        sets := sets || 'limits_currency = COALESCE(limits_currency, ''USD'')';
      END IF;

      SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'users'
                       AND column_name = 'is_custom_monthly') INTO hay;
      IF hay THEN
        sets := sets || 'is_custom_monthly = true';
      END IF;

      SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'users'
                       AND column_name = 'is_custom_daily') INTO hay;
      IF hay THEN
        sets := sets || 'is_custom_daily = true';
      END IF;

      -- Si no existe ninguna columna de topes, no se actualiza nada pero el
      -- Aprobar no se rompe. Trabar el boton seria peor que no aplicar topes.
      IF COALESCE(array_length(sets, 1), 0) > 0 THEN
        EXECUTE format(
          'UPDATE public.users SET %s WHERE id::text = %L',
          array_to_string(sets, ', '),
          NEW.user_id::text);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$apply_limit$;


-- El trigger que dispara lo de arriba, solo si la tabla existe: un CREATE
-- TRIGGER contra una tabla ausente aborta el script y revierte todo lo demas.
DO $trg_topes$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'limit_increase_requests') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_apply_limit_increase ON public.limit_increase_requests';
    EXECUTE 'CREATE TRIGGER trg_apply_limit_increase AFTER UPDATE OF status ON public.limit_increase_requests FOR EACH ROW EXECUTE FUNCTION public.apply_limit_increase()';
  END IF;
END;
$trg_topes$;


NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- La comprobacion va en 2026_zz_verificacion.sql, en otra pestana.
-- ============================================================================
