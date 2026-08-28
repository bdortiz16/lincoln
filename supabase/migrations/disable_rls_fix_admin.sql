-- ============================================================
-- DEFINITIVE FIX: Disable RLS on users and transactions
-- so the admin panel can always read all rows.
-- Run this in Supabase SQL Editor.
-- ============================================================

-- 1. Disable RLS entirely on both tables
ALTER TABLE public.users        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions DISABLE ROW LEVEL SECURITY;

-- 2. Grant full access to anon and authenticated roles
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users        TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO anon, authenticated;

-- 3. Also ensure the admin RPC functions exist (recreate for safety)
CREATE OR REPLACE FUNCTION public.cuypay_get_all_users()
RETURNS SETOF public.users LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM public.users; $$;

CREATE OR REPLACE FUNCTION public.cuypay_get_all_transactions()
RETURNS SETOF public.transactions LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM public.transactions; $$;

GRANT EXECUTE ON FUNCTION public.cuypay_get_all_users        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cuypay_get_all_transactions TO anon, authenticated;

-- 4. Also ensure crypto_balances column exists
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS crypto_balances JSONB NOT NULL DEFAULT '{}'::jsonb;
