-- ============================================================================
-- COMPROBACION DE LAS MIGRACIONES DE SEGURIDAD
-- ============================================================================
--
-- ESTE ARCHIVO NO CAMBIA NADA. Solo mira. Se puede correr cuantas veces sea.
--
-- POR QUE ESTA SEPARADO: el editor de Supabase corre todo lo que se le pega
-- dentro de UNA SOLA transaccion. Si la consulta de comprobacion que va al
-- final de un script falla -- aunque sea por una tonteria de sintaxis en la
-- consulta misma -- se revierte tambien el DDL que si habia funcionado. Queda
-- entonces pareciendo que los triggers no se crearon, cuando lo que paso es que
-- se crearon y se deshicieron en el mismo instante. Eso ya nos paso una vez:
-- el error era "column reference oid is ambiguous" en la ultima linea, y se
-- llevo por delante el trigger que impide que alguien se registre como admin.
--
-- ORDEN: primero correr los scripts de abajo (cada uno en su propia pestana,
-- uno por vez, esperando a que termine sin error), y DESPUES esta consulta.
--
--   1. 2026_lincoin_risk.sql
--   2. 2026_tusdatos_protected_key.sql
--   3. 2026_no_borrar_beneficiario_bloqueado.sql
--   4. 2026_zz_cierre_rls_abierta.sql        <- va de ultimo, siempre
--
-- Las once columnas deben decir true.
-- ============================================================================

SELECT
  -- ── 2026_lincoin_risk.sql ────────────────────────────────────────────────
  EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'risk_registry'
  ) AS risk_tabla,

  COALESCE((
    SELECT rowsecurity FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'risk_registry'
  ), false) AS risk_cerrada,

  -- ── 2026_tusdatos_protected_key.sql ──────────────────────────────────────
  COALESCE((
    SELECT position('''tusdatos''' in pg_get_functiondef(p.oid)) > 0
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'guard_raw_data_server_keys' AND n.nspname = 'public'
    LIMIT 1
  ), false) AS tusdatos_protegido,

  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_guard_raw_data_server_keys' AND NOT tgisinternal
  ) AS raw_data_trigger,

  -- ── 2026_no_borrar_beneficiario_bloqueado.sql ────────────────────────────
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_guard_beneficiario_bloqueado' AND NOT tgisinternal
  ) AS benef_no_borrable,

  -- ── 2026_zz_cierre_rls_abierta.sql ───────────────────────────────────────
  --
  -- OJO CON ESTA: es una comprobacion en negativo, asi que tambien da true
  -- cuando la tabla NO existe. Mirar junto con la columna tablas_presentes.
  NOT EXISTS (
    SELECT 1 FROM pg_tables t
    WHERE t.schemaname = 'public'
      AND t.tablename IN ('limit_increase_requests','document_requests',
                          'beneficiaries','notifications','user_limits','kyc_submissions')
      AND NOT t.rowsecurity
  ) AS rls_puesta,

  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname IN ('allow_select_all_transactions','allow_update_all_transactions',
                         'allow_select_all_users','users_all','tx_all',
                         'beneficiaries_all','notifications_all','user_limits_all','kyc_submissions_all')
  ) AS permisivas_fuera,

  -- LA MAS IMPORTANTE. Sin este trigger cualquiera que se registre puede
  -- mandar su propia fila de public.users con rol de admin y tener el panel.
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_guard_users_insert' AND NOT tgisinternal
  ) AS insert_protegido,

  -- COALESCE a proposito: sin el, si la funcion no existe la columna sale NULL
  -- y NULL no es false -- se lee como si no hubiera respuesta, cuando la
  -- respuesta es que no esta.
  COALESCE((
    SELECT position('Solo un administrador' in pg_get_functiondef(p.oid)) > 0
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'apply_limit_increase' AND n.nspname = 'public'
    LIMIT 1
  ), false) AS topes_protegidos,

  NOT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee IN ('anon', 'PUBLIC')
      AND table_name IN ('limit_increase_requests','document_requests',
                         'kyc_submissions','user_limits','beneficiaries','notifications')
  ) AS anon_revocado,

  -- Cuantas de las seis tablas existen de verdad. Si aca sale menos de 6, las
  -- dos comprobaciones en negativo de arriba estan dando true por ausencia y no
  -- por estar cerradas.
  (
    SELECT count(*) FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('limit_increase_requests','document_requests',
                        'beneficiaries','notifications','user_limits','kyc_submissions')
  ) AS tablas_presentes;


-- ============================================================================
-- SI ALGUNA COLUMNA SALE FALSE — seleccionar el bloque de abajo con el mouse y
-- correr SOLO eso (el editor corre la seleccion si hay algo seleccionado).
-- Dice quien sigue teniendo permiso y quien se lo dio.
-- ============================================================================
--
-- SELECT table_name, grantee, grantor, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND grantee IN ('anon', 'PUBLIC')
--   AND table_name IN ('limit_increase_requests','document_requests',
--                      'kyc_submissions','user_limits','beneficiaries','notifications')
-- ORDER BY table_name, grantee, privilege_type;
--
-- Si en grantor sale un rol que no es postgres (por ejemplo supabase_admin),
-- el REVOKE no alcanza: en Postgres solo puede revocar un permiso quien lo
-- concedio. Ahi hay que correr el REVOKE desde ese rol o cambiar el dueno de la
-- tabla. Mandame el resultado y te paso el comando exacto.
--
-- ============================================================================
-- Y para ver que triggers tiene public.users encima, que es donde viven casi
-- todos los guardias:
-- ============================================================================
--
-- SELECT tgname, pg_get_triggerdef(oid) AS definicion
-- FROM pg_trigger
-- WHERE tgrelid = 'public.users'::regclass AND NOT tgisinternal
-- ORDER BY tgname;
