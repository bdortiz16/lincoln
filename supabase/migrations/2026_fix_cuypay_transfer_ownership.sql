-- ============================================================
-- cuypay_transfer — endurecimiento de seguridad (P2P)
--
-- Corrige dos fallas del fix_p2p_security.sql anterior:
--   1. IDOR: NO validaba que quien llama sea el DUEÑO de p_sender_id, así
--      que cualquier usuario autenticado podía pasar el id de una víctima
--      y debitarle su saldo. Ahora se exige auth.uid() = p_sender_id.
--   2. Carrera de doble-gasto: el chequeo de saldo y el débito eran dos
--      sentencias sin bloqueo → dos clics/llamadas concurrentes podían
--      pasar ambos el check y debitar dos veces (saldo negativo, doble
--      crédito al receptor). Ahora la fila del emisor se bloquea con
--      FOR UPDATE, serializando las transferencias concurrentes.
--
-- Correr en el SQL Editor de Supabase.
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
  -- (1) SEGURIDAD: quien llama debe ser el DUEÑO de la cuenta que envía.
  -- Sin esto, cualquier autenticado podía debitar la cuenta de otro (IDOR).
  IF auth.uid() IS NULL OR auth.uid()::text <> p_sender_id THEN
    RETURN jsonb_build_object('error', 'No autorizado');
  END IF;

  -- Monto positivo y finito.
  IF p_amount IS NULL OR p_amount <= 0 OR NOT isfinite(p_amount) THEN
    RETURN jsonb_build_object('error', 'Monto inválido');
  END IF;

  -- Moneda permitida.
  IF p_currency NOT IN ('USD', 'COP', 'CLP', 'MXN', 'PEN') THEN
    RETURN jsonb_build_object('error', 'Moneda no soportada');
  END IF;

  -- Buscar al receptor por su ownReferralCode.
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

  -- (2) Bloquear la fila del emisor: el chequeo de saldo y el débito quedan
  -- serializados. Una segunda llamada concurrente espera aquí y ve el saldo
  -- YA debitado, evitando el doble-gasto.
  SELECT COALESCE((balances->>p_currency)::NUMERIC, 0)
    INTO v_sender_bal
    FROM public.users
   WHERE id = p_sender_id
   FOR UPDATE;

  IF v_sender_bal < p_amount THEN
    RETURN jsonb_build_object('error', 'Saldo insuficiente');
  END IF;

  -- Débito atómico del emisor.
  UPDATE public.users
     SET balances = jsonb_set(
           balances,
           ARRAY[p_currency],
           to_jsonb(COALESCE((balances->>p_currency)::NUMERIC, 0) - p_amount)
         )
   WHERE id = p_sender_id;

  -- Crédito atómico del receptor.
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

-- Solo usuarios autenticados; nunca anon.
REVOKE EXECUTE ON FUNCTION public.cuypay_transfer FROM anon;
GRANT  EXECUTE ON FUNCTION public.cuypay_transfer TO authenticated;
