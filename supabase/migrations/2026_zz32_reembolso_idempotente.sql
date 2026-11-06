-- ════════════════════════════════════════════════════════
-- REEMBOLSO IDEMPOTENTE: un envío se devuelve UNA vez, y se puede reintentar
-- solo sin miedo.
--
-- Hasta ahora la devolución de un envío rechazado era un adjust_balances
-- suelto. Si la respuesta se perdía (red, timeout, 5xx), no había forma de
-- saber si el saldo había vuelto: reintentarlo podía pagar dos veces, así que
-- la fila quedaba en revisión manual y la plata del cliente esperaba a que un
-- admin la mirara (auditoría del 6 nov).
--
-- Ahora cada devolución deja una fila en reembolsos_envio con el id del envío
-- como llave, y el registro y el crédito van en la MISMA transacción: o pasan
-- los dos o ninguno. Si se reintenta un envío ya devuelto, la función contesta
-- 'ya_aplicado' sin tocar el saldo. Eso es lo que deja a mouv-proxy reintentar
-- solo las devoluciones que fallaron.
--
-- Idempotente: se puede correr dos veces. Solo la llama la llave de servicio.
-- ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.reembolsos_envio (
  tx_id      uuid        PRIMARY KEY,
  user_id    uuid        NOT NULL,
  currency   text        NOT NULL,
  monto      numeric     NOT NULL CHECK (monto > 0),
  origen     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.reembolsos_envio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reembolsos_envio FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reembolsar_envio(
  p_tx_id    uuid,
  p_user_id  uuid,
  p_currency text,
  p_monto    numeric,
  p_origen   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $re$
DECLARE
  v_previo public.reembolsos_envio%ROWTYPE;
  v_adj jsonb;
BEGIN
  IF p_tx_id IS NULL OR p_user_id IS NULL OR coalesce(p_currency, '') = '' THEN
    RETURN jsonb_build_object('error', 'datos_incompletos');
  END IF;
  IF p_monto IS NULL OR p_monto = 'NaN'::numeric OR p_monto <= 0 OR p_monto >= 1e15 THEN
    RETURN jsonb_build_object('error', 'monto_invalido');
  END IF;

  INSERT INTO public.reembolsos_envio (tx_id, user_id, currency, monto, origen)
  VALUES (p_tx_id, p_user_id, p_currency, p_monto, p_origen)
  ON CONFLICT (tx_id) DO NOTHING;

  IF NOT FOUND THEN
    -- Ya se devolvió antes (quizá la respuesta de esa vez se perdió).
    SELECT * INTO v_previo FROM public.reembolsos_envio WHERE tx_id = p_tx_id;
    RETURN jsonb_build_object('ok', true, 'ya_aplicado', true,
      'monto', v_previo.monto, 'currency', v_previo.currency, 'at', v_previo.created_at);
  END IF;

  v_adj := public.adjust_balances(p_user_id, jsonb_build_object(p_currency, p_monto), '{}'::jsonb);
  IF v_adj ? 'error' THEN
    -- No se acreditó: se borra el registro para que un reintento sí aplique.
    DELETE FROM public.reembolsos_envio WHERE tx_id = p_tx_id;
    RETURN v_adj;
  END IF;
  RETURN jsonb_build_object('ok', true, 'ya_aplicado', false,
    'saldo', v_adj->'balances'->p_currency);
END $re$;

REVOKE ALL ON FUNCTION public.reembolsar_envio(uuid, uuid, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reembolsar_envio(uuid, uuid, text, numeric, text) TO service_role;
