-- ============================================================
-- adjust_balances — ajuste ATÓMICO de saldos (pentest #4).
--
-- Las edge functions hacían leer-modificar-escribir del objeto JSON completo
-- `balances`/`crypto_balances` SIN bloqueo de fila → dos operaciones
-- concurrentes de la MISMA cuenta podían pisarse (una restauraba el riel que
-- la otra acababa de debitar) y duplicar fondos. Esta función bloquea la fila
-- con FOR UPDATE y aplica los deltas con jsonb_set en una sola transacción,
-- validando que ningún saldo quede negativo. Solo la usan las edge functions
-- con service-role (nunca el cliente).
--
-- p_fiat  = { "COP_BREB": -12000, "COP": 5000, ... }   (deltas en balances)
-- p_crypto= { "USDT": -3.5, ... }                        (deltas en crypto_balances)
-- ============================================================

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
    cur := COALESCE((v_bal->>k)::numeric, 0); nv := cur + d;
    IF nv < 0 THEN RETURN jsonb_build_object('error', 'insufficient', 'currency', k); END IF;
    v_bal := jsonb_set(v_bal, ARRAY[k], to_jsonb(round(nv, 8)));
  END LOOP;

  FOR k, d IN SELECT key, value::numeric FROM jsonb_each_text(COALESCE(p_crypto, '{}'::jsonb)) LOOP
    cur := COALESCE((v_cry->>k)::numeric, 0); nv := cur + d;
    IF nv < 0 THEN RETURN jsonb_build_object('error', 'insufficient', 'currency', k); END IF;
    v_cry := jsonb_set(v_cry, ARRAY[k], to_jsonb(round(nv, 8)));
  END LOOP;

  UPDATE public.users SET balances = v_bal, crypto_balances = v_cry WHERE id = p_user_id;
  RETURN jsonb_build_object('ok', true, 'balances', v_bal, 'crypto_balances', v_cry);
END $$;

-- Solo el backend (service-role). Nunca anon/authenticated/PUBLIC.
REVOKE ALL ON FUNCTION public.adjust_balances(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_balances(uuid, jsonb, jsonb) TO service_role;
