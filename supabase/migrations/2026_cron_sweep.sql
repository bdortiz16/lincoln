-- ════════════════════════════════════════════════════════
-- BARRIDO AUTOMÁTICO cada 1 minuto: llama a la edge tatum-wallet
-- (action=sweep_all) que mueve el USDT de todos los buzones de clientes
-- a la wallet recaudadora.
--
-- ⚠️ Antes de correr esto, reemplaza <ANON_KEY> por tu VITE_SUPABASE_ANON_KEY
-- (Supabase → Project Settings → API → anon public).
--
-- Requiere las extensiones pg_cron y pg_net (Supabase las trae; se activan
-- abajo si no están). Para cambiar el intervalo, edita el schedule
-- ('* * * * *' = cada minuto; '*/5 * * * *' = cada 5 min).
--
-- Para APAGARLO: SELECT cron.unschedule('cuypay_sweep_all');
-- ════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Quita el job previo si existe (idempotente)
DO $$ BEGIN
  PERFORM cron.unschedule('cuypay_sweep_all');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Programa el barrido cada minuto
SELECT cron.schedule(
  'cuypay_sweep_all',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://afaysiaontmhgrjnoene.supabase.co/functions/v1/tatum-wallet',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', '<ANON_KEY>',
      'Authorization', 'Bearer <ANON_KEY>'
    ),
    body    := jsonb_build_object('action', 'sweep_all')
  );
  $$
);

-- Ver los jobs programados
SELECT jobid, schedule, jobname, active FROM cron.job WHERE jobname = 'cuypay_sweep_all';
