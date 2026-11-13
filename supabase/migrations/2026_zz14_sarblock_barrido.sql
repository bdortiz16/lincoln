-- ════════════════════════════════════════════════════════════════════
-- Barrido de Sarblock (cada 5 minutos) — idempotente.
--
-- Recoge las consultas de antecedentes que quedaron en curso: las que
-- todavía procesan y las que Sarblock cerró con una fuente "en curso" que
-- completa después en el mismo check. Sin esto, una ficha quedaría
-- "consultando" hasta que alguien abriera la pantalla de Beneficiarios (y
-- mientras tanto no sale plata hacia ese beneficiario).
--
-- La función sarblock no hace nada si system_config.sarblock_config no está
-- activo, así que correr esta migración antes de encender Sarblock es
-- inofensivo. Mismo mecanismo que el barrido de TusDatos.
-- ════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.sarblock_barrido()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $sb$
DECLARE v_url text; v_sec text;
BEGIN
  SELECT value INTO v_url FROM private_config WHERE key = 'supabase_url';
  SELECT value INTO v_sec FROM private_config WHERE key = 'aviso_secret';
  IF v_url IS NULL OR v_sec IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := v_url || '/functions/v1/sarblock',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_sec),
    body := jsonb_build_object('action', 'barrido'),
    timeout_milliseconds := 140000);
END $sb$;

REVOKE ALL ON FUNCTION public.sarblock_barrido() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('sarblock-barrido') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sarblock-barrido');
SELECT cron.schedule('sarblock-barrido', '*/5 * * * *', $c$SELECT public.sarblock_barrido()$c$);
