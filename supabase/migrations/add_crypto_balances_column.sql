-- ============================================================
-- Add crypto_balances column to separate USDT/USDC from fiat.
-- Run this in Supabase SQL Editor.
-- ============================================================

-- 1. Add the column (safe to run multiple times)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS crypto_balances JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. Migrate any existing USDT/USDC from balances → crypto_balances
UPDATE public.users
SET
  crypto_balances = jsonb_build_object(
    'USDT', COALESCE((balances->>'USDT')::numeric, 0),
    'USDC', COALESCE((balances->>'USDC')::numeric, 0),
    'BTC',  COALESCE((balances->>'BTC')::numeric, 0),
    'ETH',  COALESCE((balances->>'ETH')::numeric, 0)
  ),
  balances = balances - 'USDT' - 'USDC' - 'BTC' - 'ETH'
WHERE
  (balances ? 'USDT') OR (balances ? 'USDC') OR (balances ? 'BTC') OR (balances ? 'ETH');

-- 3. Re-create admin RPC functions to include the new column
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

GRANT EXECUTE ON FUNCTION public.cuypay_get_all_users        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cuypay_get_all_transactions TO anon, authenticated;
