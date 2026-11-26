CREATE OR REPLACE FUNCTION public.guard_raw_data_server_keys()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $guard_raw$
DECLARE
  privilegiado boolean := false;
  k text;
  protegidas text[] := ARRAY[
    'gasfreeCredited',
    'gasfreeCreditedTxs',
    'gasfreeCreditedCount',
    'gasfreeIndex',
    'gasfreeHdIndex',
    'gasfreeAddress',
    'gasfreeEoa',
    'gasfreeAddresses',
    'subWallets',
    'mfaEnabled',
    'mfaFactorId',
    'totpSecret',
    'totpSecretEnc',
    'otp',
    'mfaBackupHashes',
    'mfaSessions',
    'mfaLastCounter',
    'passkeys',
    'trustedDevices',
    'passwordHash',
    'kumplo',
    'tusdatos',
    'blacklisted',
    'blacklistedAt',
    'isBlocked',
    'blockReason',
    'blockType',
    'complianceHold',
    'limits',
    'otcConfig',
    '__role',
    'personasSolicitudes',
    'personasAutorizadas',
    'empresaAutorizante',
    'autorizacion',
    'contadores',
    'contadoresSolicitudes',
    'contadorDe'
  ];
  oldraw jsonb := COALESCE(OLD.raw_data, '{}'::jsonb);
  newraw jsonb := COALESCE(NEW.raw_data, '{}'::jsonb);
BEGIN
  IF session_user IN ('postgres', 'supabase_admin') THEN privilegiado := true; END IF;
  BEGIN
    IF auth.role() = 'service_role' THEN privilegiado := true; END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF NOT privilegiado THEN
    BEGIN
      IF public.is_any_admin() THEN privilegiado := true; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF current_setting('lincoin.rpc_confiable', true) = 'on' THEN privilegiado := true; END IF;
  IF privilegiado THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(newraw) <> 'object' THEN
    newraw := '{}'::jsonb;
  END IF;
  IF newraw IS DISTINCT FROM oldraw THEN
    FOREACH k IN ARRAY protegidas LOOP
      IF oldraw ? k THEN
        newraw := jsonb_set(newraw, ARRAY[k], oldraw -> k, true);
      ELSE
        newraw := newraw - k;
      END IF;
    END LOOP;
    IF newraw ? 'ownReferralCode' THEN
      newraw := jsonb_set(newraw, ARRAY['ownReferralCode'], to_jsonb(upper(right(NEW.id::text, 6))), true);
    END IF;
    NEW.raw_data := newraw;
  END IF;
  RETURN NEW;
END;
$guard_raw$;

REVOKE ALL ON FUNCTION public.guard_raw_data_server_keys() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_guard_raw_data_server_keys ON public.users;
CREATE TRIGGER trg_guard_raw_data_server_keys
  BEFORE UPDATE OF raw_data ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_raw_data_server_keys();


CREATE OR REPLACE FUNCTION public.guard_users_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $guard_insert$
DECLARE
  privilegiado boolean := false;
  fila  jsonb;
  raw   jsonb;
  k     text;
  rol   text;
  correo text;
  protegidas text[] := ARRAY[
    'gasfreeCredited',
    'gasfreeCreditedTxs',
    'gasfreeCreditedCount',
    'gasfreeIndex',
    'gasfreeHdIndex',
    'gasfreeAddress',
    'gasfreeEoa',
    'gasfreeAddresses',
    'subWallets',
    'mfaEnabled',
    'mfaFactorId',
    'totpSecret',
    'totpSecretEnc',
    'otp',
    'mfaBackupHashes',
    'mfaSessions',
    'mfaLastCounter',
    'passkeys',
    'trustedDevices',
    'passwordHash',
    'kumplo',
    'tusdatos',
    'blacklisted',
    'blacklistedAt',
    'isBlocked',
    'blockReason',
    'blockType',
    'complianceHold',
    'limits',
    'otcConfig',
    '__role',
    'personasSolicitudes',
    'personasAutorizadas',
    'empresaAutorizante',
    'autorizacion',
    'contadores',
    'contadoresSolicitudes',
    'contadorDe'
  ];
  neutros jsonb := jsonb_build_object(
    'admin_role',           null,
    'balances',             '{}'::jsonb,
    'crypto_balances',      '{}'::jsonb,
    'is_blocked',           false,
    'compliance_hold',      false,
    'custom_monthly_limit', null,
    'custom_daily_limit',   null,
    'is_custom_monthly',    false,
    'is_custom_daily',      false,
    'kyc_status',           'pending'
  );
BEGIN
  IF session_user IN ('postgres', 'supabase_admin') THEN privilegiado := true; END IF;
  BEGIN
    IF auth.role() = 'service_role' THEN privilegiado := true; END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF NOT privilegiado THEN
    BEGIN
      IF public.is_any_admin() THEN privilegiado := true; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF current_setting('lincoin.rpc_confiable', true) = 'on' THEN privilegiado := true; END IF;
  IF privilegiado THEN
    RETURN NEW;
  END IF;

  fila := to_jsonb(NEW);

  FOR k IN SELECT jsonb_object_keys(neutros) LOOP
    IF fila ? k THEN
      fila := jsonb_set(fila, ARRAY[k], neutros -> k, true);
    END IF;
  END LOOP;

  IF fila ? 'role' THEN
    rol := COALESCE(fila ->> 'role', '');
    IF rol NOT IN ('business', 'personal', '') THEN
      fila := jsonb_set(fila, ARRAY['role'], to_jsonb('business'::text), true);
    END IF;
  END IF;

  IF fila ? 'email' THEN
    BEGIN
      correo := NULLIF(lower(btrim(auth.email())), '');
    EXCEPTION WHEN OTHERS THEN correo := NULL; END;
    IF correo IS NOT NULL THEN
      fila := jsonb_set(fila, ARRAY['email'], to_jsonb(correo), true);
    END IF;
  END IF;

  IF fila ? 'raw_data' THEN
    raw := fila -> 'raw_data';
    IF raw IS NULL OR jsonb_typeof(raw) <> 'object' THEN
      raw := '{}'::jsonb;
    END IF;
    FOREACH k IN ARRAY protegidas LOOP
      raw := raw - k;
    END LOOP;
    IF fila ? 'id' THEN
      raw := jsonb_set(raw, ARRAY['ownReferralCode'], to_jsonb(upper(right(fila ->> 'id', 6))), true);
    END IF;
    fila := jsonb_set(fila, ARRAY['raw_data'], raw, true);
  END IF;

  NEW := jsonb_populate_record(NEW, fila);
  RETURN NEW;
END;
$guard_insert$;

REVOKE ALL ON FUNCTION public.guard_users_insert() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_guard_users_insert ON public.users;
CREATE TRIGGER trg_guard_users_insert
  BEFORE INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_users_insert();


CREATE OR REPLACE FUNCTION public.guard_users_sensitive_cols()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $guard_cols$
DECLARE
  privilegiado boolean := false;
  sensibles text[] := ARRAY[
    'role', 'admin_role', 'kyc_status', 'kyc_verified_at', 'balances', 'crypto_balances',
    'is_blocked', 'block_type', 'block_reason', 'compliance_hold',
    'custom_daily_limit', 'custom_monthly_limit', 'is_custom_daily', 'is_custom_monthly', 'limits_currency',
    'assigned_currency', 'didit_session_id', 'email'
  ];
  col text;
BEGIN
  IF session_user IN ('postgres', 'supabase_admin') THEN privilegiado := true; END IF;
  BEGIN
    IF auth.role() = 'service_role' THEN privilegiado := true; END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF NOT privilegiado THEN
    BEGIN
      IF public.is_any_admin() THEN privilegiado := true; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF current_setting('lincoin.rpc_confiable', true) = 'on' THEN privilegiado := true; END IF;
  IF privilegiado OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  FOREACH col IN ARRAY sensibles LOOP
    IF (to_jsonb(OLD) -> col) IS DISTINCT FROM (to_jsonb(NEW) -> col) THEN
      RAISE EXCEPTION 'No se puede cambiar la columna % desde la app', col
        USING HINT = 'La cambia el servidor o un administrador';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$guard_cols$;

REVOKE ALL ON FUNCTION public.guard_users_sensitive_cols() FROM PUBLIC;

DROP TRIGGER IF EXISTS users_sensitive_cols_guard ON public.users;
CREATE TRIGGER users_sensitive_cols_guard
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_users_sensitive_cols();


CREATE OR REPLACE FUNCTION public.guard_users_role_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $guard_role$
DECLARE
  servidor boolean := false;
  admin_app boolean := false;
  nueva jsonb;
  vieja jsonb;
BEGIN
  IF session_user IN ('postgres', 'supabase_admin') THEN servidor := true; END IF;
  BEGIN
    IF auth.role() = 'service_role' THEN servidor := true; END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF servidor THEN
    RETURN NEW;
  END IF;
  BEGIN
    IF public.is_any_admin() THEN admin_app := true; END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  nueva := to_jsonb(NEW);
  vieja := to_jsonb(OLD);

  IF NOT admin_app THEN
    IF nueva ? 'role' THEN nueva := jsonb_set(nueva, ARRAY['role'], COALESCE(vieja -> 'role', 'null'::jsonb), true); END IF;
    IF nueva ? 'admin_role' THEN nueva := jsonb_set(nueva, ARRAY['admin_role'], COALESCE(vieja -> 'admin_role', 'null'::jsonb), true); END IF;
    NEW := jsonb_populate_record(NEW, nueva);
    RETURN NEW;
  END IF;

  IF (vieja ->> 'role') = 'admin' OR (nueva ->> 'role') = 'admin'
     OR (nueva -> 'admin_role') IS DISTINCT FROM (vieja -> 'admin_role') THEN
    IF (nueva -> 'role') IS DISTINCT FROM (vieja -> 'role')
       OR (nueva -> 'admin_role') IS DISTINCT FROM (vieja -> 'admin_role')
       OR ((vieja ->> 'role') = 'admin' AND (nueva -> 'email') IS DISTINCT FROM (vieja -> 'email')) THEN
      RAISE EXCEPTION 'El rol de administrador y los datos de un administrador solo los cambia el servidor';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard_role$;

REVOKE ALL ON FUNCTION public.guard_users_role_update() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_guard_users_role_update ON public.users;
CREATE TRIGGER trg_guard_users_role_update
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_users_role_update();


CREATE OR REPLACE FUNCTION public.guard_transactions_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $guard_tx$
DECLARE
  privilegiado boolean := false;
  raw jsonb;
  k text;
  servidor text[] := ARRAY['source', 'acct', 'lincoin', 'firmaServidor', 'firmaConv', 'reverso', 'reversaDe', 'reversaAuto', 'noRevierte', 'debitado', 'debitadoCol', 'debitadoAt', 'servidor', 'refunded', 'creditClaimed', 'convertPhase', 'traceId', 'usdtOut', 'fwd', 'providerAddress', 'providerRef', 'providerTraceId', 'debitUsd', 'grossSwept', 'feeCop', 'grossCop', 'netoCop', 'netCop', 'depositId', 'payinStatus', 'finityMovement', 'benefDoc', 'recordOnly', 'revisionManual', 'refDuplicada', 'utilityCop', 'creditUsd', 'finityToAmount', 'finityRate', 'rail', 'cuentaBreb', 'firmaCobro'];
BEGIN
  IF session_user IN ('postgres', 'supabase_admin') THEN privilegiado := true; END IF;
  BEGIN
    IF auth.role() = 'service_role' THEN privilegiado := true; END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF NOT privilegiado THEN
    BEGIN
      IF public.is_any_admin() THEN privilegiado := true; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF current_setting('lincoin.rpc_confiable', true) = 'on' THEN privilegiado := true; END IF;
  IF privilegiado THEN
    RETURN NEW;
  END IF;
  NEW.status := 'Pendiente';
  raw := COALESCE(NEW.raw_data, '{}'::jsonb);
  IF jsonb_typeof(raw) <> 'object' THEN
    raw := '{}'::jsonb;
  END IF;
  FOREACH k IN ARRAY servidor LOOP
    raw := raw - k;
  END LOOP;
  NEW.raw_data := raw || jsonb_build_object('insertadoPorCliente', true);
  RETURN NEW;
END;
$guard_tx$;

REVOKE ALL ON FUNCTION public.guard_transactions_insert() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_guard_transactions_insert ON public.transactions;
CREATE TRIGGER trg_guard_transactions_insert
  BEFORE INSERT ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_transactions_insert();


CREATE OR REPLACE FUNCTION public.guard_transactions_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $guard_txu$
DECLARE
  privilegiado boolean := false;
BEGIN
  IF session_user IN ('postgres', 'supabase_admin') THEN privilegiado := true; END IF;
  BEGIN
    IF auth.role() = 'service_role' THEN privilegiado := true; END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF NOT privilegiado THEN
    BEGIN
      IF public.is_any_admin() THEN privilegiado := true; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF current_setting('lincoin.rpc_confiable', true) = 'on' THEN privilegiado := true; END IF;
  IF privilegiado THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Los movimientos solo los modifica el servidor';
END;
$guard_txu$;

REVOKE ALL ON FUNCTION public.guard_transactions_update() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_guard_transactions_update ON public.transactions;
CREATE TRIGGER trg_guard_transactions_update
  BEFORE UPDATE OR DELETE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_transactions_update();


DROP POLICY IF EXISTS allow_select_all_transactions ON public.transactions;
DROP POLICY IF EXISTS allow_update_all_transactions ON public.transactions;
DROP POLICY IF EXISTS allow_insert_all_transactions ON public.transactions;
DROP POLICY IF EXISTS allow_select_all_users ON public.users;
DROP POLICY IF EXISTS allow_upsert_own_user ON public.users;
DROP POLICY IF EXISTS users_all ON public.users;
DROP POLICY IF EXISTS tx_all ON public.transactions;

DO $hold$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'is_user_on_compliance_hold') THEN
    EXECUTE 'DROP POLICY IF EXISTS tx_block_send_load_on_compliance_hold ON public.transactions';
    EXECUTE 'CREATE POLICY tx_block_send_load_on_compliance_hold ON public.transactions AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.is_user_on_compliance_hold() OR COALESCE(type, '''') NOT IN (''send'', ''load''))';
  END IF;
END
$hold$;


CREATE OR REPLACE FUNCTION public.motivo_bloqueo(p_uid text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $bloqueo$
DECLARE
  f jsonb;
BEGIN
  SELECT to_jsonb(u) INTO f FROM public.users u WHERE u.id::text = p_uid;
  IF f IS NULL THEN
    RETURN 'Usuario no encontrado';
  END IF;
  IF f ->> 'is_blocked' = 'true' OR f -> 'raw_data' ->> 'isBlocked' = 'true' THEN
    RETURN 'Esta cuenta está bloqueada y no puede realizar operaciones. Contacta a soporte.';
  END IF;
  IF f -> 'raw_data' ->> 'blacklisted' = 'true' THEN
    RETURN 'Esta cuenta está en la lista negra y no puede realizar operaciones.';
  END IF;
  IF f ->> 'compliance_hold' = 'true' THEN
    RETURN 'Tu cuenta tiene una revisión de cumplimiento pendiente. Mientras tanto no puede enviar dinero.';
  END IF;
  RETURN NULL;
END;
$bloqueo$;

REVOKE ALL ON FUNCTION public.motivo_bloqueo(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.motivo_bloqueo(text) TO service_role;


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
  IF public.motivo_bloqueo(v_empresa_id) IS NOT NULL THEN
    RETURN jsonb_build_object('error', public.motivo_bloqueo(v_empresa_id));
  END IF;
  PERFORM set_config('lincoin.rpc_confiable', 'on', true);

  v_monto := round(p_monto, 2);
  IF v_monto IS NULL OR v_monto <= 0 OR v_monto >= 1e15 THEN
    RETURN jsonb_build_object('error', 'Monto inválido');
  END IF;
  v_nota := NULLIF(left(btrim(COALESCE(p_nota, '')), 140), '');

  SELECT full_name, role, COALESCE(balances, '{}'::jsonb), COALESCE(raw_data, '{}'::jsonb)
    INTO v_empresa_nombre, v_empresa_rol, v_empresa_bal, v_empresa_raw
    FROM public.users
   WHERE id::text = v_empresa_id
   FOR UPDATE;

  IF v_empresa_rol IS DISTINCT FROM 'business' THEN
    RETURN jsonb_build_object('error', 'Solo una cuenta Empresa puede cargar saldo a sus clientes');
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
    RETURN jsonb_build_object('error', 'Ese ID no es de una cuenta de operador');
  END IF;

  IF NOT (COALESCE(v_empresa_raw -> 'personasAutorizadas', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', v_cliente_id))) THEN
    RETURN jsonb_build_object('error', 'Ese cliente todavía no está aprobado para operar con tu empresa. Revisa su estado en Clientes.');
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
  IF public.motivo_bloqueo(p_sender_id) IS NOT NULL THEN
    RETURN jsonb_build_object('error', public.motivo_bloqueo(p_sender_id));
  END IF;
  PERFORM set_config('lincoin.rpc_confiable', 'on', true);

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount >= 1e15 THEN
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

  SELECT full_name, role, COALESCE(raw_data, '{}'::jsonb), COALESCE((balances->>p_currency)::NUMERIC, 0)
    INTO v_sender_name, v_sender_role, v_sender_raw, v_sender_bal
    FROM public.users
   WHERE id::text = p_sender_id
   FOR UPDATE;

  IF v_recipient_role = 'personal' THEN
    IF v_sender_role IS DISTINCT FROM 'business' THEN
      RETURN jsonb_build_object('error', 'Ese ID es de un operador: solo recibe dinero de la empresa con la que opera.');
    END IF;
    IF NOT (COALESCE(v_sender_raw -> 'personasAutorizadas', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', v_recipient_id))) THEN
      RETURN jsonb_build_object('error', 'Ese cliente todavía no está aprobado para operar con tu empresa. Revisa su estado en Clientes.');
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


CREATE OR REPLACE FUNCTION public.admin_complete_withdrawal(p_tx_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $completar$
DECLARE
  v_tx record;
BEGIN
  IF NOT public.is_app_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'tx_not_found'); END IF;
  IF v_tx.status <> 'Pendiente' THEN RETURN jsonb_build_object('error', 'no_pendiente', 'status', v_tx.status); END IF;
  IF COALESCE(v_tx.raw_data ->> 'insertadoPorCliente', '') = 'true' AND COALESCE(v_tx.raw_data ->> 'debitado', '') <> 'true' THEN
    RETURN jsonb_build_object('error', 'sin_debito', 'message', 'Esta solicitud no tiene un débito verificado por el servidor. No se puede aprobar.');
  END IF;
  UPDATE public.transactions SET status = 'Completado' WHERE id = p_tx_id;
  RETURN jsonb_build_object('ok', true);
END;
$completar$;

CREATE OR REPLACE FUNCTION public.admin_reject_withdrawal(p_tx_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $rechazar$
DECLARE
  v_tx record;
  v_col text;
  v_devuelve boolean;
BEGIN
  IF NOT public.is_app_admin() THEN RETURN jsonb_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'tx_not_found'); END IF;
  IF v_tx.status <> 'Pendiente' THEN RETURN jsonb_build_object('error', 'no_pendiente', 'status', v_tx.status); END IF;
  IF v_tx.type IS DISTINCT FROM 'send' THEN RETURN jsonb_build_object('error', 'no_es_retiro'); END IF;
  v_devuelve := COALESCE(v_tx.raw_data ->> 'debitado', '') = 'true'
             OR COALESCE(v_tx.raw_data ->> 'insertadoPorCliente', '') <> 'true';
  IF v_devuelve THEN
    v_col := COALESCE(NULLIF(v_tx.raw_data ->> 'debitadoCol', ''), v_tx.currency);
    PERFORM public._credit_user_balance(v_tx.user_id, v_col, v_tx.amount::numeric);
  END IF;
  UPDATE public.transactions
     SET status = 'Rechazado',
         raw_data = COALESCE(raw_data, '{}'::jsonb)
                    || jsonb_build_object('rejectReason', COALESCE(p_reason, 'Rechazado por administración'), 'reembolsado', v_devuelve)
   WHERE id = p_tx_id;
  RETURN jsonb_build_object('ok', true, 'reembolsado', v_devuelve);
END;
$rechazar$;

REVOKE ALL ON FUNCTION public.admin_complete_withdrawal(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_reject_withdrawal(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_complete_withdrawal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_withdrawal(uuid, text) TO authenticated;


DO $revocar$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS firma
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('recompute_compliance_hold', 'increment_hd_counter', 'refresh_admin_overview_stats', 'get_my_2fa', 'set_2fa_secret_by_id')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.firma);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.firma);
  END LOOP;
END
$revocar$;

DO $alertas$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'compliance_alerts') THEN
    EXECUTE 'DROP POLICY IF EXISTS "compliance_insert_alerts" ON public.compliance_alerts';
  END IF;
END
$alertas$;

DO $vista$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname = 'public' AND matviewname = 'admin_overview_stats') THEN
    EXECUTE 'REVOKE ALL ON public.admin_overview_stats FROM PUBLIC, anon, authenticated';
  END IF;
END
$vista$;


DO $indices$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cupo_solicitudes') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cupo_solicitudes WHERE estado = 'en_proceso'
       GROUP BY user_id, beneficiario_clave HAVING count(*) > 1
    ) THEN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS cupo_solicitudes_una_en_proceso ON public.cupo_solicitudes (user_id, beneficiario_clave) WHERE estado = ''en_proceso''';
    ELSE
      RAISE NOTICE 'Hay solicitudes de cupo duplicadas en proceso: no se creó el índice único';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE raw_data ->> 'ownReferralCode' IS NOT NULL
     GROUP BY upper(raw_data ->> 'ownReferralCode') HAVING count(*) > 1
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS users_own_referral_code_uq ON public.users (upper(raw_data ->> ''ownReferralCode'')) WHERE raw_data ->> ''ownReferralCode'' IS NOT NULL';
  ELSE
    RAISE NOTICE 'Hay IDs Lincoin repetidos: no se creó el índice único';
  END IF;
END
$indices$;

NOTIFY pgrst, 'reload schema';
