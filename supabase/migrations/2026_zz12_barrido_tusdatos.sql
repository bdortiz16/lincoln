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

CREATE OR REPLACE FUNCTION public.tusdatos_barrido()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $td$
DECLARE v_url text; v_sec text;
BEGIN
  SELECT value INTO v_url FROM private_config WHERE key = 'supabase_url';
  SELECT value INTO v_sec FROM private_config WHERE key = 'aviso_secret';
  IF v_url IS NULL OR v_sec IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := v_url || '/functions/v1/tusdatos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_sec),
    body := jsonb_build_object('action', 'barrido'),
    timeout_milliseconds := 140000);
END $td$;

REVOKE ALL ON FUNCTION public.tusdatos_barrido() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('tusdatos-barrido') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tusdatos-barrido');
SELECT cron.schedule('tusdatos-barrido', '*/5 * * * *', $c$SELECT public.tusdatos_barrido()$c$);

SELECT public.tusdatos_barrido();
