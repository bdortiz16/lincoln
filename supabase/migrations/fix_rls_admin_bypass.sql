-- ============================================================
-- Fix RLS so admin-bypass (anon role) can read/update data.
-- The admin bypass login skips Supabase Auth, so requests arrive
-- as the 'anon' role. Without these policies the balance update
-- after approving a deposit silently fails.
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- 1. Ensure the balances column exists (in case it was never created)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS balances JSONB NOT NULL DEFAULT '{"USD":0,"COP":0,"CLP":0,"MXN":0,"PEN":0}';

-- 2. users table: let anon (admin-bypass) SELECT all users
DROP POLICY IF EXISTS "allow_anon_select_users" ON public.users;
CREATE POLICY "allow_anon_select_users"
  ON public.users FOR SELECT
  TO anon
  USING (true);

-- 3. users table: let anon (admin-bypass) UPDATE any user (balance approvals, KYC, etc.)
DROP POLICY IF EXISTS "allow_anon_update_users" ON public.users;
CREATE POLICY "allow_anon_update_users"
  ON public.users FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- 4. transactions table: let anon SELECT all transactions
DROP POLICY IF EXISTS "allow_anon_select_transactions" ON public.transactions;
CREATE POLICY "allow_anon_select_transactions"
  ON public.transactions FOR SELECT
  TO anon
  USING (true);

-- 5. transactions table: let anon INSERT transactions (internal treasury movements)
DROP POLICY IF EXISTS "allow_anon_insert_transactions" ON public.transactions;
CREATE POLICY "allow_anon_insert_transactions"
  ON public.transactions FOR INSERT
  TO anon
  WITH CHECK (true);

-- 6. transactions table: let anon UPDATE status (approve/reject)
DROP POLICY IF EXISTS "allow_anon_update_transactions" ON public.transactions;
CREATE POLICY "allow_anon_update_transactions"
  ON public.transactions FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
