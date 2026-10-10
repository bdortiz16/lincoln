-- ============================================================================
-- PERSONAS AUTORIZADAS: una persona solo recibe dinero de la empresa que la
-- autorizo, y esa empresa le fija su tope mensual.
-- ============================================================================
--
-- El vinculo vive en la fila de la EMPRESA (raw_data.personasAutorizadas,
-- lista de {id, nombre, docType, docNumber, topeMensual, at}) y solo lo
-- escribe el servidor (funcion edge "autorizaciones"). La persona lleva un
-- espejo en raw_data.empresaAutorizante = {id, nombre}, tambien escrito por
-- el servidor, para que su portal sepa de quien depende.
--
-- Este archivo reemplaza dos funciones:
--   1. lincoin_cargar_cliente: la carga de saldo exige que la persona este
--      autorizada por la empresa que carga.
--   2. cuypay_transfer (pago entre usuarios por ID): una persona solo puede
--      recibir de una empresa que la autorizo; ademas ahora deja los dos
--      movimientos en transactions (antes movia saldo sin registro).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lincoin_cargar_cliente(
  p_codigo TEXT,
  p_monto  NUMERIC,
  p_nota   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $psp$
DECLARE
  v_empresa_id     TEXT;
  v_empresa_nombre TEXT;
  v_empresa_rol    TEXT;
  v_empresa_bal    JSONB;
  v_empresa_raw    JSONB;
  v_cliente_id     TEXT;
  v_cliente_nombre TEXT;
  v_cliente_rol    TEXT;
  v_cliente_bal    JSONB;
  v_monto          NUMERIC;
  v_nota           TEXT;
  v_falta          NUMERIC;
  v_disp           NUMERIC;
  v_toma           NUMERIC;
  v_total          NUMERIC := 0;
  v_riel           TEXT;
  v_detalle        JSONB := '{}'::jsonb;
  v_tx_empresa     UUID;
  v_tx_cliente     UUID;
  v_nuevo_saldo    NUMERIC;
BEGIN
  v_empresa_id := auth.uid()::text;
  IF v_empresa_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No autorizado');
  END IF;

  v_monto := round(p_monto, 2);
  IF v_monto IS NULL OR v_monto <= 0 OR NOT isfinite(v_monto) THEN
    RETURN jsonb_build_object('error', 'Monto inválido');
  END IF;
  v_nota := NULLIF(left(btrim(COALESCE(p_nota, '')), 140), '');

  SELECT full_name, role, COALESCE(balances, '{}'::jsonb), COALESCE(raw_data, '{}'::jsonb)
    INTO v_empresa_nombre, v_empresa_rol, v_empresa_bal, v_empresa_raw
    FROM public.users
   WHERE id::text = v_empresa_id
   FOR UPDATE;

  IF v_empresa_rol IS DISTINCT FROM 'business' THEN
    RETURN jsonb_build_object('error', 'Solo una cuenta Empresa puede cargar saldo a personas');
  END IF;

  SELECT id::text, full_name, role, COALESCE(balances, '{}'::jsonb)
    INTO v_cliente_id, v_cliente_nombre, v_cliente_rol, v_cliente_bal
    FROM public.users
   WHERE COALESCE(NULLIF(raw_data->>'ownReferralCode', ''), upper(right(id::text, 6))) = upper(btrim(p_codigo))
   LIMIT 1;

  IF v_cliente_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No existe una cuenta con ese ID Lincoin');
  END IF;
  IF v_cliente_id = v_empresa_id THEN
    RETURN jsonb_build_object('error', 'No puedes cargarte saldo a ti mismo');
  END IF;
  IF v_cliente_rol IS DISTINCT FROM 'personal' THEN
    RETURN jsonb_build_object('error', 'Ese ID no es de una cuenta Persona');
  END IF;

  -- La persona tiene que estar AUTORIZADA por esta empresa.
  IF NOT (COALESCE(v_empresa_raw -> 'personasAutorizadas', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', v_cliente_id))) THEN
    RETURN jsonb_build_object('error', 'Esa persona no está autorizada por tu empresa. Apruébala en Personas autorizadas.');
  END IF;

  FOREACH v_riel IN ARRAY ARRAY['COP', 'COP_BREB', 'COP_ACH'] LOOP
    v_total := v_total + COALESCE((v_empresa_bal->>v_riel)::numeric, 0);
  END LOOP;
  IF v_total < v_monto THEN
    RETURN jsonb_build_object('error', 'Saldo COP insuficiente', 'disponible', v_total);
  END IF;

  v_falta := v_monto;
  FOREACH v_riel IN ARRAY ARRAY['COP', 'COP_BREB', 'COP_ACH'] LOOP
    EXIT WHEN v_falta <= 0;
    v_disp := COALESCE((v_empresa_bal->>v_riel)::numeric, 0);
    IF v_disp <= 0 THEN CONTINUE; END IF;
    v_toma := LEAST(v_disp, v_falta);
    v_empresa_bal := jsonb_set(v_empresa_bal, ARRAY[v_riel], to_jsonb(round(v_disp - v_toma, 2)), true);
    v_detalle := v_detalle || jsonb_build_object(v_riel, v_toma);
    v_falta := v_falta - v_toma;
  END LOOP;

  UPDATE public.users SET balances = v_empresa_bal WHERE id::text = v_empresa_id;

  v_nuevo_saldo := round(COALESCE((v_cliente_bal->>'COP')::numeric, 0) + v_monto, 2);
  UPDATE public.users
     SET balances = jsonb_set(COALESCE(balances, '{}'::jsonb), ARRAY['COP'], to_jsonb(v_nuevo_saldo), true)
   WHERE id::text = v_cliente_id;

  v_tx_empresa := gen_random_uuid();
  v_tx_cliente := gen_random_uuid();

  INSERT INTO public.transactions (id, user_id, type, amount, currency, status, raw_data)
  VALUES (
    v_tx_empresa, v_empresa_id::uuid, 'pay_sent', v_monto, 'COP', 'Completado',
    jsonb_build_object(
      'psp', true,
      'title', 'Carga de saldo a persona autorizada',
      'beneficiaryName', v_cliente_nombre,
      'recipientName', v_cliente_nombre,
      'counterpartyId', v_cliente_id,
      'counterpartyName', v_cliente_nombre,
      'counterpartyCode', upper(btrim(p_codigo)),
      'note', v_nota,
      'rieles', v_detalle,
      'pairedTxId', v_tx_cliente::text,
      'createdAt', now()
    )
  );

  INSERT INTO public.transactions (id, user_id, type, amount, currency, status, raw_data)
  VALUES (
    v_tx_cliente, v_cliente_id::uuid, 'pay_received', v_monto, 'COP', 'Completado',
    jsonb_build_object(
      'psp', true,
      'title', 'Saldo recibido de ' || COALESCE(v_empresa_nombre, 'una empresa'),
      'senderName', v_empresa_nombre,
      'counterpartyId', v_empresa_id,
      'counterpartyName', v_empresa_nombre,
      'note', v_nota,
      'pairedTxId', v_tx_empresa::text,
      'createdAt', now()
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'cliente_id', v_cliente_id,
    'cliente_nombre', v_cliente_nombre,
    'tx_id', v_tx_empresa::text,
    'monto', v_monto,
    'rieles', v_detalle
  );
END;
$psp$;

REVOKE ALL ON FUNCTION public.lincoin_cargar_cliente(TEXT, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lincoin_cargar_cliente(TEXT, NUMERIC, TEXT) TO authenticated;


-- ─── Pago entre usuarios por ID ─────────────────────────────────────────────
-- Reglas nuevas: una PERSONA solo recibe de una EMPRESA que la autorizo (ni
-- de otra persona, ni de una empresa que no la haya aprobado). Y cada pago
-- deja sus dos movimientos.
CREATE OR REPLACE FUNCTION public.cuypay_transfer(
  p_sender_id      TEXT,
  p_recipient_code TEXT,
  p_amount         NUMERIC,
  p_currency       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $p2p$
DECLARE
  v_sender_name    TEXT;
  v_sender_role    TEXT;
  v_sender_raw     JSONB;
  v_recipient_id   TEXT;
  v_recipient_name TEXT;
  v_recipient_role TEXT;
  v_sender_bal     NUMERIC;
  v_tx_out         UUID;
  v_tx_in          UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.uid()::text <> p_sender_id THEN
    RETURN jsonb_build_object('error', 'No autorizado');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR NOT isfinite(p_amount) THEN
    RETURN jsonb_build_object('error', 'Monto inválido');
  END IF;

  IF p_currency NOT IN ('USD', 'COP', 'CLP', 'MXN', 'PEN') THEN
    RETURN jsonb_build_object('error', 'Moneda no soportada');
  END IF;

  SELECT id::text, full_name, role
    INTO v_recipient_id, v_recipient_name, v_recipient_role
    FROM public.users
   WHERE COALESCE(NULLIF(raw_data->>'ownReferralCode', ''), upper(right(id::text, 6))) = upper(btrim(p_recipient_code))
   LIMIT 1;

  IF v_recipient_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuario no encontrado');
  END IF;
  IF v_recipient_id = p_sender_id THEN
    RETURN jsonb_build_object('error', 'No puedes enviarte dinero a ti mismo');
  END IF;
  IF v_recipient_role = 'admin' THEN
    RETURN jsonb_build_object('error', 'Usuario no encontrado');
  END IF;

  -- Bloquea la fila del emisor: saldo y debito quedan serializados.
  SELECT full_name, role, COALESCE(raw_data, '{}'::jsonb), COALESCE((balances->>p_currency)::NUMERIC, 0)
    INTO v_sender_name, v_sender_role, v_sender_raw, v_sender_bal
    FROM public.users
   WHERE id::text = p_sender_id
   FOR UPDATE;

  -- Una persona solo recibe de la empresa que la autorizo.
  IF v_recipient_role = 'personal' THEN
    IF v_sender_role IS DISTINCT FROM 'business' THEN
      RETURN jsonb_build_object('error', 'Una persona solo puede recibir dinero de una empresa registrada en Lincoin.');
    END IF;
    IF NOT (COALESCE(v_sender_raw -> 'personasAutorizadas', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', v_recipient_id))) THEN
      RETURN jsonb_build_object('error', 'Esa persona no está autorizada por tu empresa. Apruébala en Personas autorizadas.');
    END IF;
  END IF;

  IF v_sender_bal < p_amount THEN
    RETURN jsonb_build_object('error', 'Saldo insuficiente');
  END IF;

  UPDATE public.users
     SET balances = jsonb_set(COALESCE(balances, '{}'::jsonb), ARRAY[p_currency],
           to_jsonb(COALESCE((balances->>p_currency)::NUMERIC, 0) - p_amount), true)
   WHERE id::text = p_sender_id;

  UPDATE public.users
     SET balances = jsonb_set(COALESCE(balances, '{}'::jsonb), ARRAY[p_currency],
           to_jsonb(COALESCE((balances->>p_currency)::NUMERIC, 0) + p_amount), true)
   WHERE id::text = v_recipient_id;

  v_tx_out := gen_random_uuid();
  v_tx_in  := gen_random_uuid();

  INSERT INTO public.transactions (id, user_id, type, amount, currency, status, raw_data)
  VALUES (v_tx_out, p_sender_id::uuid, 'pay_sent', p_amount, p_currency, 'Completado',
    jsonb_build_object('title', 'Pago a ' || COALESCE(v_recipient_name, 'usuario Lincoin'), 'recipientName', v_recipient_name,
      'beneficiaryName', v_recipient_name, 'counterpartyId', v_recipient_id, 'counterpartyName', v_recipient_name,
      'counterpartyCode', upper(btrim(p_recipient_code)), 'pairedTxId', v_tx_in::text, 'createdAt', now()));

  INSERT INTO public.transactions (id, user_id, type, amount, currency, status, raw_data)
  VALUES (v_tx_in, v_recipient_id::uuid, 'pay_received', p_amount, p_currency, 'Completado',
    jsonb_build_object('title', 'Pago recibido de ' || COALESCE(v_sender_name, 'usuario Lincoin'), 'senderName', v_sender_name,
      'counterpartyId', p_sender_id, 'counterpartyName', v_sender_name, 'pairedTxId', v_tx_out::text, 'createdAt', now()));

  RETURN jsonb_build_object('success', true, 'recipient_id', v_recipient_id, 'recipient_name', v_recipient_name);
END;
$p2p$;

REVOKE ALL ON FUNCTION public.cuypay_transfer(TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cuypay_transfer(TEXT, TEXT, NUMERIC, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
