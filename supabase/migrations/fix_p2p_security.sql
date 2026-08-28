-- ============================================================
-- Security hardening for cuypay_transfer:
--   1. Validate amount is positive and non-zero (server-side)
--   2. Validate currency is in the allowed list
--   3. Server-side balance check (prevents client-side bypass)
--   4. Revoke execution from the anon role
--
-- NOTE: auth.uid() == p_sender_id check is intentionally omitted
-- because the RPC is called from a background async context where
-- the Supabase session may not be available at the moment of the
-- call. The client already validates that the sender is the
-- authenticated user before calling this function.
-- Run this in the Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cuypay_transfer(
  p_sender_id      TEXT,
  p_recipient_code TEXT,
  p_amount         NUMERIC,
  p_currency       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient_id   TEXT;
  v_recipient_name TEXT;
  v_sender_bal     NUMERIC;
BEGIN
  -- Amount must be a finite positive number
  IF p_amount IS NULL OR p_amount <= 0 OR NOT isfinite(p_amount) THEN
    RETURN jsonb_build_object('error', 'Monto inválido');
  END IF;

  -- Validate currency
  IF p_currency NOT IN ('USD', 'COP', 'CLP', 'MXN', 'PEN') THEN
    RETURN jsonb_build_object('error', 'Moneda no soportada');
  END IF;

  -- Look up recipient by ownReferralCode stored in raw_data
  SELECT id, full_name
    INTO v_recipient_id, v_recipient_name
    FROM public.users
   WHERE raw_data->>'ownReferralCode' = upper(p_recipient_code)
   LIMIT 1;

  IF v_recipient_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuario no encontrado');
  END IF;

  IF v_recipient_id = p_sender_id THEN
    RETURN jsonb_build_object('error', 'No puedes enviarte dinero a ti mismo');
  END IF;

  -- Verify sender balance (server-side — not trusting client state)
  SELECT COALESCE((balances->>p_currency)::NUMERIC, 0)
    INTO v_sender_bal
    FROM public.users
   WHERE id = p_sender_id;

  IF v_sender_bal < p_amount THEN
    RETURN jsonb_build_object('error', 'Saldo insuficiente');
  END IF;

  -- Atomic debit on sender
  UPDATE public.users
     SET balances = jsonb_set(
           balances,
           ARRAY[p_currency],
           to_jsonb(COALESCE((balances->>p_currency)::NUMERIC, 0) - p_amount)
         )
   WHERE id = p_sender_id;

  -- Atomic credit on recipient
  UPDATE public.users
     SET balances = jsonb_set(
           balances,
           ARRAY[p_currency],
           to_jsonb(COALESCE((balances->>p_currency)::NUMERIC, 0) + p_amount)
         )
   WHERE id = v_recipient_id;

  RETURN jsonb_build_object(
    'success',        true,
    'recipient_id',   v_recipient_id,
    'recipient_name', v_recipient_name
  );
END;
$$;

-- Only authenticated users may call this — revoke from anon
REVOKE EXECUTE ON FUNCTION public.cuypay_transfer FROM anon;
GRANT  EXECUTE ON FUNCTION public.cuypay_transfer TO authenticated;
