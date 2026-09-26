-- ════════════════════════════════════════════════════════════════════
-- 2026_security_posture.sql
--
-- Función de solo LECTURA que reporta el estado de las defensas que viven
-- en la base: triggers de blindaje, RLS por tabla y la RPC atómica de
-- saldos. El panel "Agente de seguridad" del admin la consulta para saber
-- si una protección está PUESTA de verdad o solo escrita en el repo.
--
-- Por qué hace falta: hasta ahora la única forma de saber si un trigger
-- estaba aplicado era abrir el SQL Editor y buscarlo a mano. Un blindaje
-- que se cree instalado y no lo está es peor que no tenerlo, porque nadie
-- lo vuelve a mirar.
--
-- No devuelve NINGÚN dato de clientes: solo nombres de objetos y booleanos.
--
-- Pegar en el SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.security_posture()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  result jsonb;
  has_raw_guard      boolean;
  has_cols_guard     boolean;
  has_adjust         boolean;
  rls_users          boolean;
  rls_tx             boolean;
  rls_syscfg         boolean;
  syscfg_exists      boolean;
  policies_users     int;
  policies_tx        int;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'users'
      AND t.tgname = 'trg_guard_raw_data_server_keys' AND NOT t.tgisinternal
  ) INTO has_raw_guard;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'users'
      AND t.tgname = 'users_sensitive_cols_guard' AND NOT t.tgisinternal
  ) INTO has_cols_guard;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'adjust_balances'
  ) INTO has_adjust;

  SELECT COALESCE(bool_or(c.relrowsecurity), false) INTO rls_users
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'users';

  SELECT COALESCE(bool_or(c.relrowsecurity), false) INTO rls_tx
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'transactions';

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'system_config'
  ) INTO syscfg_exists;

  IF syscfg_exists THEN
    SELECT COALESCE(bool_or(c.relrowsecurity), false) INTO rls_syscfg
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'system_config';
  ELSE
    rls_syscfg := NULL;
  END IF;

  SELECT count(*) INTO policies_users FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'users';

  SELECT count(*) INTO policies_tx FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'transactions';

  result := jsonb_build_object(
    'rawDataGuard',      has_raw_guard,
    'sensitiveColsGuard',has_cols_guard,
    'adjustBalancesRpc', has_adjust,
    'rlsUsers',          rls_users,
    'rlsTransactions',   rls_tx,
    'rlsSystemConfig',   rls_syscfg,
    'policiesUsers',     policies_users,
    'policiesTransactions', policies_tx,
    'checkedAt',         now()
  );
  RETURN result;
END $$;

-- Solo el service_role (las edge functions) la ejecuta. El panel llega a
-- ella a través de admin-data, que ya exige sesión de admin.
REVOKE ALL ON FUNCTION public.security_posture() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.security_posture() FROM anon;
REVOKE ALL ON FUNCTION public.security_posture() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.security_posture() TO service_role;

NOTIFY pgrst, 'reload schema';
