-- ============================================================================
-- FUERA LOS VOLCADOS PUBLICOS DE USUARIOS Y TRANSACCIONES
-- ============================================================================
--
-- POR QUE EXISTE ESTE ARCHIVO (incidente de septiembre 2026):
--
-- cuypay_get_all_users() y cuypay_get_all_transactions() son SECURITY DEFINER
-- y hacen SELECT * de public.users y public.transactions saltandose la RLS.
-- 2026_lock_dangerous_rpcs_and_fx les quito EXECUTE a anon y authenticated,
-- pero en Postgres toda funcion nace con EXECUTE para PUBLIC, y PUBLIC nunca
-- se revoco. Resultado: cualquiera con la clave anonima del sitio (que va en
-- el bundle) podia bajarse la tabla de usuarios completa, con raw_data
-- adentro: hashes de codigos de respaldo del 2FA, datos de KYC, saldos.
--
-- Con esos hashes (SHA-256 sin sal de un codigo de 8 simbolos) rompieron dos
-- codigos de respaldo de la cuenta admin y entraron al panel el 5 de
-- septiembre. La app no llama a estas funciones: se eliminan.
--
-- Ademas: ninguna funcion futura nace ejecutable por PUBLIC.
-- ============================================================================

DROP FUNCTION IF EXISTS public.cuypay_get_all_users();
DROP FUNCTION IF EXISTS public.cuypay_get_all_transactions();
DROP FUNCTION IF EXISTS public.cuypay_save_profile(text, jsonb);

-- Las funciones que se creen de aqui en adelante NO son ejecutables por
-- PUBLIC: cada una tiene que conceder su EXECUTE a proposito.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- COMPROBACION (otra pestana): toda funcion SECURITY DEFINER de public que
-- PUBLIC, anon o authenticated puedan ejecutar. Cada fila hay que poder
-- explicarla; la que no, se le revoca:
--   REVOKE EXECUTE ON FUNCTION public.<nombre>(<args>) FROM PUBLIC, anon, authenticated;
-- ============================================================================
--
-- SELECT p.proname AS funcion,
--        pg_get_function_identity_arguments(p.oid) AS argumentos,
--        string_agg(DISTINCT rp.grantee, ', ') AS quien_puede
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- JOIN information_schema.routine_privileges rp
--   ON rp.specific_schema = n.nspname AND rp.routine_name = p.proname
-- WHERE n.nspname = 'public' AND p.prosecdef
--   AND rp.grantee IN ('PUBLIC', 'anon', 'authenticated')
-- GROUP BY p.proname, p.oid
-- ORDER BY p.proname;
