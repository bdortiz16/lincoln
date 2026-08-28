-- ============================================================
-- CuyPay P2P Transfer: SECURITY DEFINER function so an
-- authenticated user can atomically deduct from their own
-- balance and credit another user's balance without needing
-- a permissive UPDATE policy on the users table.
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

-- Only authenticated users may call this — unauthenticated clients must not initiate transfers
REVOKE EXECUTE ON FUNCTION public.cuypay_transfer FROM anon;
GRANT  EXECUTE ON FUNCTION public.cuypay_transfer TO authenticated;
