-- ════════════════════════════════════════════════════════
-- ARREGLO TODO-EN-UNO (reemplaza FIX-contactos y FIX-movimientos).
-- El proyecto no tenía public.is_any_admin() — la base de los candados.
-- Orden: 1) crear is_any_admin  2) candado de users SIN raw_data
--        3) políticas de transactions (leer/insertar lo propio)
-- Es idempotente: correrlo dos veces no daña nada.
-- ════════════════════════════════════════════════════════

-- 1) Función base: ¿el usuario autenticado es admin?
CREATE OR REPLACE FUNCTION public.is_any_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- 2) Candado de columnas sensibles en users — SIN raw_data (ahí viven los
--    contactos y el usuario debe poder escribirlos). role/saldos/kyc
--    siguen siendo solo-admin.
CREATE OR REPLACE FUNCTION public.guard_users_sensitive_cols()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  sensitive TEXT[] := ARRAY[
    'role', 'admin_role', 'kyc_status', 'kyc_verified_at',
    'balances', 'crypto_balances', 'is_blocked',
    'assigned_currency', 'didit_session_id'
  ];
  col TEXT;
  old_val TEXT;
  new_val TEXT;
BEGIN
  IF caller IS NULL THEN RETURN NEW; END IF;          -- service role
  IF public.is_any_admin() THEN RETURN NEW; END IF;   -- admin
  FOREACH col IN ARRAY sensitive LOOP
    old_val := to_jsonb(OLD) ->> col;
    new_val := to_jsonb(NEW) ->> col;
    IF old_val IS DISTINCT FROM new_val THEN
      RAISE EXCEPTION 'Cannot change column "%" (sensitive, admin-only)', col;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS users_sensitive_cols_guard ON public.users;
CREATE TRIGGER users_sensitive_cols_guard
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_users_sensitive_cols();

-- 3) transactions: RLS con "cada quien lo suyo"
DO $$
DECLARE r RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='transactions') THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY';
  FOR r IN SELECT policyname FROM pg_policies
           WHERE tablename='transactions' AND schemaname='public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.transactions', r.policyname);
  END LOOP;
  EXECUTE $p$CREATE POLICY tx_select_own_or_admin ON public.transactions
    FOR SELECT TO authenticated
    USING ((user_id IS NOT NULL AND user_id::text = auth.uid()::text) OR public.is_any_admin())$p$;
  EXECUTE $p$CREATE POLICY tx_insert_own_or_admin ON public.transactions
    FOR INSERT TO authenticated
    WITH CHECK ((user_id IS NOT NULL AND user_id::text = auth.uid()::text) OR public.is_any_admin())$p$;
  EXECUTE $p$CREATE POLICY tx_update_admin ON public.transactions
    FOR UPDATE TO authenticated
    USING (public.is_any_admin()) WITH CHECK (public.is_any_admin())$p$;
  EXECUTE $p$CREATE POLICY tx_delete_admin ON public.transactions
    FOR DELETE TO authenticated
    USING (public.is_any_admin())$p$;
END $$;

-- 4) Verificación: debe listar las 4 políticas tx_*
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'transactions'
ORDER BY policyname;
