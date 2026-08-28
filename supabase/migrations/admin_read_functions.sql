-- ============================================================
-- Admin read functions — bypass RLS so the admin can always
-- see all users and transactions regardless of policy state.
-- Run in Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cuypay_get_all_users()
RETURNS SETOF public.users
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.users;
$$;

CREATE OR REPLACE FUNCTION public.cuypay_get_all_transactions()
RETURNS SETOF public.transactions
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.transactions;
$$;

-- Grant to both roles so admin-bypass (anon) and real JWT (authenticated) both work
GRANT EXECUTE ON FUNCTION public.cuypay_get_all_users        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cuypay_get_all_transactions TO anon, authenticated;
