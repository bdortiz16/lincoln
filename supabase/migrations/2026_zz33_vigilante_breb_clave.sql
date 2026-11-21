-- ════════════════════════════════════════════════════════
-- VIGILANTE BRE-B con la clave de la base.
--
-- 2026_vigilante_breb programó vigilar_breb cada minuto (y el barrido de 5
-- días cada 10), pero la función pedía una 'service_key' guardada a mano en
-- private_config que nunca se guardó: corría y salía sin hacer nada. Las
-- devoluciones Bre-B solo se reembolsaban con el panel abierto o cuando el
-- cliente entraba a la app (revisión del 6 nov).
--
-- Ahora usa la clave que la base genera para sí misma (aviso_secret), como
-- los vigilantes de Finity y Coinsenda, y llama a la acción vigilar_breb de
-- mouv-proxy (que corre reconcile_breb para todos). Nadie copia llaves.
-- Idempotente: se puede correr dos veces sin dejar tareas repetidas.
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

CREATE OR REPLACE FUNCTION public.vigilar_breb(p_recientes int DEFAULT 45)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $vb$
DECLARE v_url text; v_sec text;
BEGIN
  SELECT value INTO v_url FROM private_config WHERE key = 'supabase_url';
  SELECT value INTO v_sec FROM private_config WHERE key = 'aviso_secret';
  IF v_url IS NULL OR v_sec IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := v_url || '/functions/v1/mouv-proxy',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_sec),
    body := jsonb_build_object('action', 'vigilar_breb', 'todos', true, 'recientesMin', p_recientes),
    timeout_milliseconds := 60000);
END $vb$;

REVOKE ALL ON FUNCTION public.vigilar_breb(int) FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('vigilar-breb') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vigilar-breb');
SELECT cron.unschedule('conciliar-breb-full') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'conciliar-breb-full');
SELECT cron.schedule('vigilar-breb', '* * * * *', $c1$SELECT public.vigilar_breb(45)$c1$);
SELECT cron.schedule('conciliar-breb-full', '*/10 * * * *', $c2$SELECT public.vigilar_breb(0)$c2$);
