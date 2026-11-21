-- ══════════════════════════════════════════════════════════════════════
-- 2026_zz30 — Revisión de seguridad (5 nov 2026). Idempotente.
--
-- 1) guard_raw_data_server_keys / guard_users_insert (copia de zz11): se
--    agregan a las claves que solo escribe el servidor 'sarblock' (la ficha
--    de riesgo: con ella una empresa se sacaba del barrido AML), 'sirelEnvios'
--    (radicados con fecha inventada), 'documentosContables', 'breb' y
--    'cuentaNo' (la llave Bre-B asignada) y 'colaborador' (marca del equipo).
-- 2) lincoin_cargar_cliente (copia de zz27): el saldo del operador se SUMA en
--    la misma sentencia en vez de escribir un valor leído antes. Con la lectura
--    vieja, una carga concurrente con un débito del operador borraba el débito
--    (el operador conservaba lo que ya había enviado). Y la marca
--    lincoin.rpc_confiable se enciende justo antes de escribir y se apaga al
--    terminar: antes quedaba encendida el resto de la transacción.
-- 3) adjust_balances: un delta nulo, NaN o fuera de rango se rechaza. NaN o
--    Infinity llegan como null en el JSON, jsonb_set(…, NULL) devuelve NULL y
--    el UPDATE dejaba TODOS los saldos de la cuenta en NULL.
-- 4) Donde ya existe el secreto 2FA cifrado, se borra la copia en claro: la
--    fila propia es legible desde el navegador.
-- 5) GraphQL cerrado para anon/authenticated: la app no lo usa, y en una sola
--    mutación se podía llamar una función que enciende la marca de confianza
--    y, en la misma transacción, escribir saldos saltándose los guardianes.
-- ══════════════════════════════════════════════════════════════════════

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
    'contadorDe',
    'sarblock',
    'sirelEnvios',
    'documentosContables',
    'breb',
    'cuentaNo',
    'colaborador'
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
    'contadorDe',
    'sarblock',
    'sirelEnvios',
    'documentosContables',
    'breb',
    'cuentaNo',
    'colaborador'
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
  v_2fa            TEXT;
BEGIN
  v_empresa_id := auth.uid()::text;
  IF v_empresa_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No autorizado');
  END IF;
  v_2fa := public._segundo_factor_cliente(15);
  IF v_2fa IS NOT NULL THEN
    RETURN jsonb_build_object('error', v_2fa, 'pide2fa', true);
  END IF;
  IF public.motivo_bloqueo(v_empresa_id) IS NOT NULL THEN
    RETURN jsonb_build_object('error', public.motivo_bloqueo(v_empresa_id));
  END IF;
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

  PERFORM set_config('lincoin.rpc_confiable', 'on', true);

  UPDATE public.users SET balances = v_empresa_bal WHERE id::text = v_empresa_id;

  UPDATE public.users
     SET balances = jsonb_set(COALESCE(balances, '{}'::jsonb), ARRAY['COP'],
                              to_jsonb(round(COALESCE((balances->>'COP')::numeric, 0) + v_monto, 2)), true)
   WHERE id::text = v_cliente_id
  RETURNING round(COALESCE((balances->>'COP')::numeric, 0), 2) INTO v_nuevo_saldo;

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

  PERFORM set_config('lincoin.rpc_confiable', '', true);

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

CREATE OR REPLACE FUNCTION public.adjust_balances(
  p_user_id uuid,
  p_fiat    jsonb DEFAULT '{}'::jsonb,
  p_crypto  jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bal jsonb; v_cry jsonb; k text; d numeric; cur numeric; nv numeric;
BEGIN
  SELECT balances, crypto_balances INTO v_bal, v_cry
    FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  v_bal := COALESCE(v_bal, '{}'::jsonb);
  v_cry := COALESCE(v_cry, '{}'::jsonb);

  FOR k, d IN SELECT key, value::numeric FROM jsonb_each_text(COALESCE(p_fiat, '{}'::jsonb)) LOOP
    IF d IS NULL OR d = 'NaN'::numeric OR abs(d) >= 1e15 THEN
      RETURN jsonb_build_object('error', 'delta_invalido', 'currency', k);
    END IF;
    cur := COALESCE((v_bal->>k)::numeric, 0); nv := cur + d;
    IF nv < 0 THEN RETURN jsonb_build_object('error', 'insufficient', 'currency', k); END IF;
    v_bal := jsonb_set(v_bal, ARRAY[k], to_jsonb(round(nv, 8)));
  END LOOP;

  FOR k, d IN SELECT key, value::numeric FROM jsonb_each_text(COALESCE(p_crypto, '{}'::jsonb)) LOOP
    IF d IS NULL OR d = 'NaN'::numeric OR abs(d) >= 1e15 THEN
      RETURN jsonb_build_object('error', 'delta_invalido', 'currency', k);
    END IF;
    cur := COALESCE((v_cry->>k)::numeric, 0); nv := cur + d;
    IF nv < 0 THEN RETURN jsonb_build_object('error', 'insufficient', 'currency', k); END IF;
    v_cry := jsonb_set(v_cry, ARRAY[k], to_jsonb(round(nv, 8)));
  END LOOP;

  UPDATE public.users SET balances = v_bal, crypto_balances = v_cry WHERE id = p_user_id;
  RETURN jsonb_build_object('ok', true, 'balances', v_bal, 'crypto_balances', v_cry);
END $$;

REVOKE ALL ON FUNCTION public.adjust_balances(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_balances(uuid, jsonb, jsonb) TO service_role;

UPDATE public.users
   SET raw_data = raw_data - 'totpSecret'
 WHERE raw_data ? 'totpSecret' AND raw_data ? 'totpSecretEnc';

DO $graphql$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'graphql_public') THEN
    EXECUTE 'REVOKE USAGE ON SCHEMA graphql_public FROM anon, authenticated';
    EXECUTE 'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA graphql_public FROM anon, authenticated';
  END IF;
END
$graphql$;

NOTIFY pgrst, 'reload schema';
