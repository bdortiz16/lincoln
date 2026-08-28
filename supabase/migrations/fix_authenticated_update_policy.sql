-- ============================================================
-- Fix: Allow authenticated users to update their own profile.
-- This is required for KYC submission and profile updates.
-- The upsert was replaced by update() in saveUser, so we only
-- need UPDATE permission (no INSERT needed anymore via saveUser).
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- Re-enable RLS on users (in case it was disabled during debugging)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 1. Authenticated users can SELECT their own row
DROP POLICY IF EXISTS "allow_auth_select_own_user" ON public.users;
CREATE POLICY "allow_auth_select_own_user"
  ON public.users FOR SELECT
  TO authenticated
  USING (auth.uid()::text = id);

-- 2. Authenticated users can UPDATE their own row (KYC, profile, etc.)
DROP POLICY IF EXISTS "allow_auth_update_own_user" ON public.users;
CREATE POLICY "allow_auth_update_own_user"
  ON public.users FOR UPDATE
  TO authenticated
  USING (auth.uid()::text = id)
  WITH CHECK (auth.uid()::text = id);

-- 3. Authenticated users can INSERT their own row (needed on first profile creation)
DROP POLICY IF EXISTS "allow_auth_insert_own_user" ON public.users;
CREATE POLICY "allow_auth_insert_own_user"
  ON public.users FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid()::text = id);

-- 4. anon (admin-bypass) can SELECT all users
DROP POLICY IF EXISTS "allow_anon_select_users" ON public.users;
CREATE POLICY "allow_anon_select_users"
  ON public.users FOR SELECT
  TO anon
  USING (true);

-- 5. anon (admin-bypass) can UPDATE any user
DROP POLICY IF EXISTS "allow_anon_update_users" ON public.users;
CREATE POLICY "allow_anon_update_users"
  ON public.users FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- 6. anon (admin-bypass) can INSERT users (needed for registerUser in offline mode)
DROP POLICY IF EXISTS "allow_anon_insert_users" ON public.users;
CREATE POLICY "allow_anon_insert_users"
  ON public.users FOR INSERT
  TO anon
  WITH CHECK (true);

-- Also re-apply transactions policies in case they were lost
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_auth_select_own_transactions" ON public.transactions;
CREATE POLICY "allow_auth_select_own_transactions"
  ON public.transactions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "allow_auth_insert_own_transactions" ON public.transactions;
CREATE POLICY "allow_auth_insert_own_transactions"
  ON public.transactions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS "allow_anon_select_transactions" ON public.transactions;
CREATE POLICY "allow_anon_select_transactions"
  ON public.transactions FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "allow_anon_insert_transactions" ON public.transactions;
CREATE POLICY "allow_anon_insert_transactions"
  ON public.transactions FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "allow_anon_update_transactions" ON public.transactions;
CREATE POLICY "allow_anon_update_transactions"
  ON public.transactions FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
