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

-- 3. (ELIMINADO por seguridad — pentest #5) Antes este archivo RE-CREABA los
-- RPC cuypay_get_all_users/_transactions (SECURITY DEFINER) y los GRANTeaba a
-- anon → dumpeaban TODA la base (incluye totpSecret/PII). En un replay por
-- orden de nombre, este archivo ('a...') corría DESPUÉS del lock ('2026_...')
-- y reabría el hueco. Se quitó: el panel admin lee vía la edge function
-- admin-data (service-role), no por estos RPC.
