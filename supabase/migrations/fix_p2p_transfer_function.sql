-- ============================================================
-- CuyPay P2P Transfer: simple atomic balance swap.
-- Run this ONE script in Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cuypay_p2p_transfer(
  p_sender_id    TEXT,
  p_recipient_id TEXT,
  p_sender_bal   JSONB,
  p_recipient_bal JSONB
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.users SET balances = p_sender_bal    WHERE id = p_sender_id::uuid;
  UPDATE public.users SET balances = p_recipient_bal WHERE id = p_recipient_id::uuid;
$$;

GRANT EXECUTE ON FUNCTION public.cuypay_p2p_transfer TO authenticated;
GRANT EXECUTE ON FUNCTION public.cuypay_p2p_transfer TO anon;
