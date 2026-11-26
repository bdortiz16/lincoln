-- ════════════════════════════════════════════════════════
-- VIGILANTE COINSENDA: concilia las Cuentas 3 y 4 sin que nadie tenga el
-- panel abierto.
--
-- El 5 nov dos envíos ACH · Cuenta 4 que el banco devolvió después de
-- pagados se reembolsaron recién cuando el dueño entró al panel: la
-- conciliación de estas cuentas solo la corrían el panel y un cron de GitHub
-- que nunca tuvo sus secretos. Ahora la base llama cada 3 minutos a
-- mouv-proxy (acción vigilar_coinsenda), que:
--   · revisa los envíos de Coinsenda que siguen Procesando, y
--   · relee los Completado de los últimos 7 días por si el banco los devolvió;
-- si Coinsenda da un envío por rechazado, lo marca Rechazado y le devuelve al
-- cliente monto + comisión (sale en Fallos).
--
-- Se autentica con la clave que la base genera para sí misma (aviso_secret),
-- igual que el vigilante de Finity: nadie copia llaves. Es idempotente: cada
-- reembolso se reclama con un CAS, y correr este archivo dos veces no deja
-- dos tareas programadas.
-- ════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE IF NOT EXISTS public.private_config (key text PRIMARY KEY, value text NOT NULL);
ALTER TABLE public.private_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.private_config FROM anon, authenticated, PUBLIC;

INSERT INTO public.private_config(key, value)
VALUES ('supabase_url', 'https://wqleypebmfiaygrurnrc.supabase.co')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.private_config(key, value)
VALUES ('aviso_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.vigilar_coinsenda()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $vc$
DECLARE v_url text; v_sec text;
BEGIN
  SELECT value INTO v_url FROM private_config WHERE key = 'supabase_url';
  SELECT value INTO v_sec FROM private_config WHERE key = 'aviso_secret';
  IF v_url IS NULL OR v_sec IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := v_url || '/functions/v1/mouv-proxy',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_sec),
    body := jsonb_build_object('action', 'vigilar_coinsenda'),
    timeout_milliseconds := 120000);
END $vc$;

REVOKE ALL ON FUNCTION public.vigilar_coinsenda() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('vigilar-coinsenda') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vigilar-coinsenda');
SELECT cron.schedule('vigilar-coinsenda', '*/3 * * * *', $c$SELECT public.vigilar_coinsenda()$c$);
