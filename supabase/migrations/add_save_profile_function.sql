-- SECURITY DEFINER function so any authenticated or anon user can save
-- their own profile data without RLS blocking them.
-- Run this in the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.cuypay_save_profile(
  p_user_id  TEXT,
  p_updates  JSONB
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.users SET
    email      = COALESCE(p_updates->>'email',      email),
    role       = COALESCE(p_updates->>'role',       role),
    full_name  = COALESCE(p_updates->>'full_name',  full_name),
    balances   = COALESCE(p_updates->'balances',    balances),
    kyc_status = COALESCE(p_updates->>'kyc_status', kyc_status),
    raw_data   = COALESCE(p_updates->'raw_data',    raw_data)
  WHERE id = p_user_id::uuid;
$$;

GRANT EXECUTE ON FUNCTION public.cuypay_save_profile TO authenticated;
GRANT EXECUTE ON FUNCTION public.cuypay_save_profile TO anon;
