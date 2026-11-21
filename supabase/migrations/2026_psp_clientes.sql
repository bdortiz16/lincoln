-- ============================================================================
-- PSP: UNA EMPRESA LE CARGA SALDO EN COP A UNA PERSONA POR SU ID LINCOIN
-- ============================================================================
--
-- La empresa registrada en Lincoin tiene clientes que abren cuenta Persona.
-- Desde su panel (Clientes), la empresa busca a la persona por su ID Lincoin
-- y le carga saldo. Esta función hace el movimiento completo y atómico:
--
--   1. Verifica que quien llama es una cuenta EMPRESA y el receptor una
--      cuenta PERSONA (nunca admin, nunca uno mismo).
--   2. Bloquea la fila de la empresa y descuenta el monto de sus rieles COP
--      en orden: COP, COP_BREB, COP_ACH. La persona solo tiene "COP".
--   3. Acredita el saldo COP de la persona.
--   4. Deja DOS movimientos en transactions, uno por lado, con el nombre de
--      la contraparte, para que cada quien vea de dónde vino o a dónde fue.
--
-- Solo COP por ahora: las demás monedas van "próximamente" en el panel
-- Persona, y esta función las rechaza a propósito.
--
-- No reemplaza a cuypay_transfer (pago entre usuarios): esa mueve saldo sin
-- dejar movimientos y sirve para otra cosa.
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

  -- Quien llama: una empresa. Se bloquea su fila para que dos cargas al
  -- tiempo no descuenten el mismo saldo dos veces.
  SELECT full_name, role, COALESCE(balances, '{}'::jsonb)
    INTO v_empresa_nombre, v_empresa_rol, v_empresa_bal
    FROM public.users
   WHERE id::text = v_empresa_id
   FOR UPDATE;

  IF v_empresa_rol IS DISTINCT FROM 'business' THEN
    RETURN jsonb_build_object('error', 'Solo una cuenta Empresa puede cargar saldo a clientes');
  END IF;

  -- El receptor: una persona, por su ID Lincoin.
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

  -- Saldo COP disponible en la empresa, sumando sus rieles.
  FOREACH v_riel IN ARRAY ARRAY['COP', 'COP_BREB', 'COP_ACH'] LOOP
    v_total := v_total + COALESCE((v_empresa_bal->>v_riel)::numeric, 0);
  END LOOP;
  IF v_total < v_monto THEN
    RETURN jsonb_build_object('error', 'Saldo COP insuficiente', 'disponible', v_total);
  END IF;

  -- Descuento en orden de riel. Queda anotado de cuál salió cada parte.
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

  -- Crédito a la persona, solo en COP.
  v_nuevo_saldo := round(COALESCE((v_cliente_bal->>'COP')::numeric, 0) + v_monto, 2);
  UPDATE public.users
     SET balances = jsonb_set(COALESCE(balances, '{}'::jsonb), ARRAY['COP'], to_jsonb(v_nuevo_saldo), true)
   WHERE id::text = v_cliente_id;

  -- Los dos movimientos. Los ids se generan aquí para cruzarlos entre sí.
  v_tx_empresa := gen_random_uuid();
  v_tx_cliente := gen_random_uuid();

  INSERT INTO public.transactions (id, user_id, type, amount, currency, status, raw_data)
  VALUES (
    v_tx_empresa, v_empresa_id::uuid, 'pay_sent', v_monto, 'COP', 'Completado',
    jsonb_build_object(
      'psp', true,
      'title', 'Carga de saldo a cliente',
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

-- Toda cuenta queda con su ID Lincoin guardado (las filas viejas no lo traían).
UPDATE public.users
   SET raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object('ownReferralCode', upper(right(id::text, 6)))
 WHERE COALESCE(raw_data->>'ownReferralCode', '') = '';

NOTIFY pgrst, 'reload schema';
