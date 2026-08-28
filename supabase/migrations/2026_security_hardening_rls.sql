-- ============================================================
-- SECURITY HARDENING — apply en AMBOS proyectos (Empresas y Personas).
--
-- Contexto: el security audit encontró que fix_rls_full_reset.sql dejó
-- RLS abierto a anon/authenticated con USING (true). Cualquiera con el
-- anon key (que vive en el bundle del browser) podía:
--   UPDATE users SET role='admin', kyc_status='approved', balances=...
--   SELECT raw_data FROM users  (passwordHash, HD index, KYC PII)
--
-- Y migraciones 2026_phase_*.sql referencian is_admin_with_role() /
-- is_any_admin() que NUNCA existieron — esas policies probablemente
-- fallaron silentes y dejaron compliance/treasury sin RLS efectiva.
--
-- Esta migración:
--   1. Define is_any_admin() + is_admin_with_role() tolerantes a las
--      diferencias de schema entre Empresas (users.role='admin') y
--      Personas (users.admin_role IN ('super_admin',...)).
--   2. Reactiva RLS estricta en public.users y public.transactions.
--   3. Agrega trigger BEFORE UPDATE que bloquea cambios a columnas
--      sensibles para usuarios no-admin. Usa to_jsonb para tolerar
--      columnas que existen solo en un proyecto.
--   4. Service role (edge functions) sigue libre — auth.uid() es NULL.
--
-- Idempotente — se puede re-correr sin romper.
-- ============================================================

-- ============================================================
-- 1) FUNCIONES is_any_admin() / is_admin_with_role()
-- ============================================================

-- is_any_admin: true si el caller tiene role='admin' (Empresas)
-- O admin_role IS NOT NULL (Personas). Usamos to_jsonb del row para
-- tolerar si admin_role no existe como columna en este proyecto.
CREATE OR REPLACE FUNCTION public.is_any_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND (
        u.role = 'admin'
        OR COALESCE(NULLIF(to_jsonb(u) ->> 'admin_role', ''), NULL) IS NOT NULL
      )
  );
$$;

-- is_admin_with_role(VARIADIC roles): true si el caller tiene
-- admin_role en la lista (Personas). En Empresas el concepto de
-- sub-rol no existe — devolvemos true si users.role='admin' Y
-- 'super_admin' está en la lista pedida (alineación más segura).
CREATE OR REPLACE FUNCTION public.is_admin_with_role(VARIADIC roles text[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND (
        (to_jsonb(u) ->> 'admin_role') = ANY(roles)
        OR (u.role = 'admin' AND 'super_admin' = ANY(roles))
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_any_admin()             TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_admin_with_role(text[]) TO authenticated, anon;

-- ============================================================
-- 2) RLS estricta en public.users
-- ============================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
           WHERE tablename = 'users' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.users', r.policyname);
  END LOOP;
END $$;

-- SELECT: el user ve su propia fila; admins ven todas.
CREATE POLICY users_select_self_or_admin ON public.users FOR SELECT
  TO authenticated
  USING (auth.uid() = id OR public.is_any_admin());

-- INSERT: signup propio o admin.
CREATE POLICY users_insert_self ON public.users FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY users_insert_admin ON public.users FOR INSERT
  TO authenticated
  WITH CHECK (public.is_any_admin());

-- UPDATE: self (trigger filtra cols sensibles) o admin.
CREATE POLICY users_update_self ON public.users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY users_update_admin ON public.users FOR UPDATE
  TO authenticated
  USING (public.is_any_admin())
  WITH CHECK (public.is_any_admin());

-- DELETE: solo admin (self-delete via edge function delete-self).
CREATE POLICY users_delete_admin ON public.users FOR DELETE
  TO authenticated
  USING (public.is_any_admin());

-- Anon → sin policies → bloqueado.

-- ============================================================
-- 3) Trigger que bloquea cols sensibles para non-admin.
--    Usa to_jsonb para tolerar columnas faltantes (admin_role
--    no existe en Empresas, balances no en Personas, etc.).
-- ============================================================

CREATE OR REPLACE FUNCTION public.guard_users_sensitive_cols()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  sensitive TEXT[] := ARRAY[
    'role',
    'admin_role',
    'kyc_status',
    'kyc_verified_at',
    'balances',
    'crypto_balances',
    'is_blocked',
    'assigned_currency',
    'didit_session_id',
    'raw_data'
  ];
  col TEXT;
  old_val TEXT;
  new_val TEXT;
BEGIN
  -- Service role / sin sesión: dejamos pasar (edge functions ya validan).
  IF caller IS NULL THEN
    RETURN NEW;
  END IF;
  -- Admin: dejamos pasar.
  IF public.is_any_admin() THEN
    RETURN NEW;
  END IF;
  -- Usuario común: chequear cada col sensible.
  FOREACH col IN ARRAY sensitive LOOP
    old_val := to_jsonb(OLD) ->> col;
    new_val := to_jsonb(NEW) ->> col;
    IF old_val IS DISTINCT FROM new_val THEN
      RAISE EXCEPTION 'Cannot change column "%" (sensitive, admin-only)', col
        USING HINT = 'Use edge function or contact compliance';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS users_sensitive_cols_guard ON public.users;
CREATE TRIGGER users_sensitive_cols_guard
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_users_sensitive_cols();

-- ============================================================
-- 4) RLS estricta en public.transactions (si existe)
-- ============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'transactions') THEN
    EXECUTE 'ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

DO $$
DECLARE r RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'transactions') THEN
    FOR r IN SELECT policyname FROM pg_policies
             WHERE tablename = 'transactions' AND schemaname = 'public'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.transactions', r.policyname);
    END LOOP;
  END IF;
END $$;

DO $$
DECLARE
  has_owner BOOLEAN;
  has_user  BOOLEAN;
  select_using TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'transactions') THEN
    RETURN;
  END IF;

  -- Detectamos qué columna usa la tabla para identificar al dueño.
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='transactions' AND column_name='owner_user_id')
    INTO has_owner;
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='transactions' AND column_name='user_id')
    INTO has_user;

  select_using := 'public.is_any_admin()';
  IF has_owner THEN
    select_using := '(owner_user_id IS NOT NULL AND owner_user_id = auth.uid()) OR ' || select_using;
  END IF;
  IF has_user THEN
    select_using := '(user_id IS NOT NULL AND user_id = auth.uid()) OR ' || select_using;
  END IF;

  EXECUTE format('CREATE POLICY tx_select_owner_or_admin ON public.transactions FOR SELECT TO authenticated USING (%s)', select_using);
  EXECUTE 'CREATE POLICY tx_insert_admin ON public.transactions FOR INSERT TO authenticated WITH CHECK (public.is_any_admin())';
  EXECUTE 'CREATE POLICY tx_update_admin ON public.transactions FOR UPDATE TO authenticated USING (public.is_any_admin()) WITH CHECK (public.is_any_admin())';
  EXECUTE 'CREATE POLICY tx_delete_admin ON public.transactions FOR DELETE TO authenticated USING (public.is_any_admin())';
END $$;

-- ============================================================
-- 5) Revocar grants explícitos a anon que dejó fix_rls_full_reset.
-- ============================================================

REVOKE ALL ON public.users FROM anon;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='transactions') THEN
    EXECUTE 'REVOKE ALL ON public.transactions FROM anon';
  END IF;
END $$;

-- ============================================================
-- 6) Smoke check (aparece en logs del SQL Editor al aplicar)
-- ============================================================

DO $$
DECLARE
  policies_users INT;
  policies_tx    INT := 0;
  trigger_exists BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO policies_users FROM pg_policies WHERE tablename = 'users' AND schemaname='public';
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='transactions') THEN
    SELECT COUNT(*) INTO policies_tx FROM pg_policies WHERE tablename = 'transactions' AND schemaname='public';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'users_sensitive_cols_guard'
      AND tgrelid = 'public.users'::regclass
  ) INTO trigger_exists;
  RAISE NOTICE 'security_hardening: policies users=%, transactions=%, trigger=%',
    policies_users, policies_tx, trigger_exists;
END $$;
