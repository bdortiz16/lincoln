-- ============================================================
-- FULL RLS RESET — run this in Supabase SQL Editor.
-- Drops ALL policies on users/transactions and recreates
-- permissive ones for both anon (admin-bypass) and authenticated.
-- ============================================================

-- 1. Enable RLS (idempotent)
ALTER TABLE public.users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- 2. Drop every existing policy on users
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'users' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.users', r.policyname);
  END LOOP;
END $$;

-- 3. Drop every existing policy on transactions
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'transactions' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.transactions', r.policyname);
  END LOOP;
END $$;

-- 4. Users — allow everything for authenticated and anon
CREATE POLICY "users_select_all" ON public.users FOR SELECT USING (true);
CREATE POLICY "users_insert_all" ON public.users FOR INSERT WITH CHECK (true);
CREATE POLICY "users_update_all" ON public.users FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "users_delete_all" ON public.users FOR DELETE USING (true);

-- 5. Transactions — allow everything for authenticated and anon
CREATE POLICY "tx_select_all"  ON public.transactions FOR SELECT USING (true);
CREATE POLICY "tx_insert_all"  ON public.transactions FOR INSERT WITH CHECK (true);
CREATE POLICY "tx_update_all"  ON public.transactions FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "tx_delete_all"  ON public.transactions FOR DELETE USING (true);

-- 6. Re-grant table access to roles (in case grants were dropped)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users        TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated, anon;
