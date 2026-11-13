-- ════════════════════════════════════════════════════════
-- VIGILANTE FINITY: devuelve el saldo de los envíos rechazados sin que nadie
-- tenga la app abierta.
--
-- Un envío por Finity (ACH o Bre-B · Cuenta 2) puede rechazarse minutos
-- después de confirmado. Antes eso solo se detectaba cuando el cliente o un
-- admin abrían la pantalla. Ahora la base llama cada 2 minutos a mouv-proxy
-- (acción vigilar_finity), que consulta el estado en Finity y, si fue
-- rechazado o devuelto, marca Rechazado y reintegra monto + comisión.
--
-- Cada 20 minutos hace además un barrido de los Bre-B · Cuenta 2 completados
-- de los últimos 3 días, por si el banco los devuelve tarde.
--
-- Se autentica con la clave que la base genera para sí misma (aviso_secret):
-- nadie copia llaves. Es idempotente: cada reembolso se reclama con un CAS.
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

CREATE OR REPLACE FUNCTION public.vigilar_finity(p_barrido boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $vf$
DECLARE v_url text; v_sec text;
BEGIN
  SELECT value INTO v_url FROM private_config WHERE key = 'supabase_url';
  SELECT value INTO v_sec FROM private_config WHERE key = 'aviso_secret';
  IF v_url IS NULL OR v_sec IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := v_url || '/functions/v1/mouv-proxy',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_sec),
    body := jsonb_build_object('action', 'vigilar_finity', 'barrido', p_barrido),
    timeout_milliseconds := 120000);
END $vf$;

REVOKE ALL ON FUNCTION public.vigilar_finity(boolean) FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('vigilar-finity') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vigilar-finity');
SELECT cron.unschedule('vigilar-finity-barrido') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vigilar-finity-barrido');
SELECT cron.schedule('vigilar-finity', '*/2 * * * *', $c1$SELECT public.vigilar_finity(false)$c1$);
SELECT cron.schedule('vigilar-finity-barrido', '*/20 * * * *', $c2$SELECT public.vigilar_finity(true)$c2$);
