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


-- ─── 4 y 5. Aprobar topes, y que nadie se cree admin al registrarse ────────
--
-- ESAS DOS FUNCIONES SE MUDARON A 2026_zz3_guardias_sin_columnas_fijas.sql.
--
-- La version que vivia aca nombraba columnas de public.users a ciegas
-- (admin_role, is_custom_monthly, limits_currency...) tomadas de
-- _lincoin_full_schema.sql, que es una reconstruccion best-effort y no la base
-- real. PL/pgSQL compila el cuerpo de una funcion la primera vez que corre, no
-- al crearla: el script decia Success, el trigger quedaba puesto, y el fallo
-- aparecia despues en cada INSERT con "record new has no field admin_role".
-- El guardia que debia impedir que alguien se registrara como admin impedia
-- que se registrara nadie.
--
-- En 2026_zz3 ninguna de las dos nombra una columna a ciegas. Correr ESE
-- archivo despues de este.

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- La comprobacion esta en 2026_zz_verificacion.sql. Se corre APARTE, en una
-- pestana nueva, DESPUES de que este script termine sin error. Ver la nota de
-- la cabecera: si la verificacion viaja pegada al DDL y falla, se lleva el DDL
-- con ella.
-- ============================================================================
