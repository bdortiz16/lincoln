-- ============================================================================
-- CIERRE DE RLS ABIERTA
-- ============================================================================
--
-- El nombre empieza por 2026_zz a proposito: las migraciones se aplican por
-- ORDEN ALFABETICO, y hay archivos sin prefijo de fecha (create_, seed_) que
-- corren DESPUES de los 2026_ y reabren lo que estos cierran. Este tiene que
-- ser el ultimo.
--
-- Cierra cinco huecos, todos explotables con la llave anonima, que viaja en el
-- JavaScript que descarga cualquiera:
--
--   1. limit_increase_requests y document_requests sin RLS. Encadenan a
--      subirse los topes uno mismo, porque apply_limit_increase es SECURITY
--      DEFINER y solo mira que el status pase a aprobado.
--   2. Politicas FOR ALL USING (true) sin rol, que valen para anonimos. Dejan
--      leer documentos de identidad y escribir limites.
--   3. create_transactions_table.sql recrea politicas que dejan a cualquier
--      usuario autenticado leer TODAS las transacciones y aprobarse depositos.
--   4. apply_limit_increase aplicaba topes sin comprobar quien aprueba.
--   5. El perfil lo INSERTA el cliente y los guardias de users son BEFORE
--      UPDATE: un registro normal podia crear su fila con rol de admin,
--      saldos inventados y el veredicto AML ya aprobado.
--
-- Es idempotente: se puede correr varias veces.
--
-- NOTA PARA EL EDITOR DE SUPABASE: los comentarios no llevan comillas simples
-- a proposito, y cada bloque usa su propia etiqueta de dollar-quote. El editor
-- cuenta comillas para partir el script, y una comilla suelta en un comentario
-- o una etiqueta de dollar-quote repetida lo hacen cortar donde no debe.
--
-- LA COMPROBACION NO VA EN ESTE ARCHIVO, A PROPOSITO. El editor corre todo lo
-- que se le pega dentro de UNA SOLA transaccion: si la consulta de verificacion
-- del final falla, se revierte tambien el DDL que si habia funcionado, y queda
-- pareciendo que los triggers no se crearon cuando en realidad se crearon y se
-- deshicieron en el mismo instante. Eso paso la primera vez. La verificacion
-- vive ahora en 2026_zz_verificacion.sql y se corre APARTE, despues.
-- ============================================================================


-- ─── 1 y 2. Politicas permisivas fuera, y RLS donde falta ───────────────────
DO $cierre_rls$
DECLARE
  t text;
  p record;
  tablas text[] := ARRAY[
    'beneficiaries', 'notifications', 'user_limits', 'kyc_submissions',
    'limit_increase_requests', 'document_requests'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Se borra TODA politica previa de la tabla: las permisivas se combinan
    -- con OR, asi que dejar una sola viva anula a las nuevas.
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;

    -- El dueno ve y crea lo suyo; el admin, todo. El service_role no pasa por
    -- RLS, asi que las edge functions siguen operando igual.
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id::text = auth.uid()::text OR public.is_any_admin())',
      t || '_sel', t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id::text = auth.uid()::text OR public.is_any_admin())',
      t || '_ins', t);

    -- OJO: el UPDATE es SOLO de admin. El dueno no puede editar su propia
    -- solicitud despues de crearla; si pudiera, se aprobaria el aumento de
    -- topes el mismo, que es justo el agujero que esto cierra.
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_any_admin()) WITH CHECK (public.is_any_admin())',
      t || '_upd', t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_any_admin())',
      t || '_del', t);

    -- Se quita el permiso a la llave anonima Y a PUBLIC. Revocar solo a anon
    -- no alcanza cuando el permiso viene heredado de PUBLIC: seguiria pudiendo
    -- leer, y la comprobacion de anon seguiria dando false sin explicacion.
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);

    -- Y se devuelve explicitamente lo que la app SI necesita. Va despues del
    -- revoke a proposito: si el acceso de los usuarios firmados venia heredado
    -- de PUBLIC, el revoke de arriba se lo habria llevado por delante y la app
    -- dejaria de cargar. Las filas las sigue filtrando la RLS de arriba.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END;
$cierre_rls$;


-- ─── 3. Las politicas que reabren transactions y users ──────────────────────
DROP POLICY IF EXISTS "allow_select_all_transactions" ON public.transactions;
DROP POLICY IF EXISTS "allow_update_all_transactions" ON public.transactions;
DROP POLICY IF EXISTS "allow_select_all_users" ON public.users;
DROP POLICY IF EXISTS "users_all" ON public.users;
DROP POLICY IF EXISTS "tx_all" ON public.transactions;


-- ─── 4. Aprobar un aumento de topes es cosa de administradores ──────────────
-- El trigger no puede confiar en que la RLS de la tabla lo proteja: es
-- SECURITY DEFINER y escribe en users. Lo comprueba el mismo.
CREATE OR REPLACE FUNCTION public.apply_limit_increase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $apply_limit$
DECLARE
  v_amount numeric;
  privilegiado boolean := false;
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
      UPDATE public.users
      SET custom_monthly_limit = v_amount,
          custom_daily_limit   = GREATEST(COALESCE(custom_daily_limit, 0)::numeric, ROUND(v_amount * 0.2)),
          limits_currency      = COALESCE(limits_currency, 'USD'),
          is_custom_monthly    = true,
          is_custom_daily      = true
      WHERE id = (NEW.user_id::text)::uuid;
    END IF;
  END IF;
  RETURN NEW;
END;
$apply_limit$;

-- El trigger que la dispara puede no existir en este proyecto: la verificacion
-- devolvio NULL, que significa que la funcion no estaba creada, no que estuviera
-- sin proteger. Se crea aca, pero SOLO si la tabla existe -- si no, un CREATE
-- TRIGGER contra una tabla ausente aborta el script entero y revierte todo lo
-- demas, que es exactamente lo que hay que evitar.
DO $trg_topes$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'limit_increase_requests') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_apply_limit_increase ON public.limit_increase_requests';
    EXECUTE 'CREATE TRIGGER trg_apply_limit_increase AFTER UPDATE OF status ON public.limit_increase_requests FOR EACH ROW EXECUTE FUNCTION public.apply_limit_increase()';
  END IF;
END;
$trg_topes$;


-- ─── 5. Nadie se crea admin al registrarse ──────────────────────────────────
--
-- El perfil de public.users lo INSERTA el navegador, y la politica solo exige
-- que el id sea el suyo. Los guardias que protegen rol, saldos y raw_data son
-- todos BEFORE UPDATE, asi que en el INSERT no corre ninguno: bastaba mandar
-- la fila a mano con rol de admin para tener el panel entero.
--
-- Esto no bloquea el registro (romperlo dejaria sin entrar a todo el mundo):
-- deja pasar el INSERT pero le quita lo que no le corresponde.
CREATE OR REPLACE FUNCTION public.guard_users_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $guard_insert$
DECLARE
  privilegiado boolean := false;
  raw jsonb := COALESCE(NEW.raw_data, '{}'::jsonb);
  k text;
  -- Las mismas claves que protege guard_raw_data_server_keys en el UPDATE.
  protegidas text[] := ARRAY['kumplo', 'tusdatos', 'gasfreeCredited', 'mfaBackupHashes'];
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

  -- Un perfil recien creado no es admin, no tiene saldo y no trae veredicto
  -- de cumplimiento. Todo eso lo escribe el servidor despues.
  IF COALESCE(NEW.role, '') NOT IN ('business', 'personal', '') THEN
    NEW.role := 'business';
  END IF;
  NEW.admin_role := NULL;
  NEW.balances := '{}'::jsonb;
  NEW.crypto_balances := '{}'::jsonb;
  NEW.is_blocked := false;
  NEW.custom_monthly_limit := NULL;
  NEW.custom_daily_limit := NULL;
  NEW.is_custom_monthly := false;
  NEW.is_custom_daily := false;
  NEW.kyc_status := 'pending';

  FOREACH k IN ARRAY protegidas LOOP
    raw := raw - k;
  END LOOP;
  raw := raw - 'blacklisted' - 'isBlocked' - 'otcConfig';
  NEW.raw_data := raw;

  RETURN NEW;
END;
$guard_insert$;

REVOKE ALL ON FUNCTION public.guard_users_insert() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_guard_users_insert ON public.users;
CREATE TRIGGER trg_guard_users_insert
  BEFORE INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_users_insert();


NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- La comprobacion esta en 2026_zz_verificacion.sql. Se corre APARTE, en una
-- pestana nueva, DESPUES de que este script termine sin error. Ver la nota de
-- la cabecera: si la verificacion viaja pegada al DDL y falla, se lleva el DDL
-- con ella.
-- ============================================================================
