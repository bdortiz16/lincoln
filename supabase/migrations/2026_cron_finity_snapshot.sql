-- ════════════════════════════════════════════════════════
-- SNAPSHOT AUTOMÁTICO de la tasa USD→COP cada 5 minutos.
--
-- Llama a la edge 'finity-proxy' (action=snapshot_finity) que consulta la
-- tasa REAL de Finity y guarda un punto en fx_rate_snapshots — así la
-- gráfica del convertidor OTC siempre tiene datos, aunque nadie lo abra.
--
-- ⚠️ Antes de correr esto, reemplaza <ANON_KEY> por tu
-- VITE_SUPABASE_ANON_KEY (Supabase → Project Settings → API → anon public).
--
-- Para cambiar el intervalo edita el schedule ('*/5 * * * *' = cada 5 min).
-- Para APAGARLO: SELECT cron.unschedule('cuypay_finity_snapshot');
-- ════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$ BEGIN
  PERFORM cron.unschedule('cuypay_finity_snapshot');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cuypay_finity_snapshot',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://afaysiaontmhgrjnoene.supabase.co/functions/v1/finity-proxy',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', '<ANON_KEY>',
      'Authorization', 'Bearer <ANON_KEY>'
    ),
    body    := jsonb_build_object('action', 'snapshot_finity')
  );
  $$
);

-- Ver el job programado
SELECT jobid, schedule, jobname, active FROM cron.job WHERE jobname = 'cuypay_finity_snapshot';
