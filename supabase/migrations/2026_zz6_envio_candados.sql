-- ════════════════════════════════════════════════════════
-- CANDADO CONTRA ENVÍOS DUPLICADOS
--
-- Dos toques seguidos al botón de enviar llegan al servidor como dos pedidos
-- casi simultáneos. El control que buscaba "un envío igual en los últimos 2
-- minutos" leía la tabla de movimientos: los dos pedidos leían antes de que
-- el primero escribiera y los dos pasaban.
--
-- Con esta tabla, cada envío inserta una clave única antes de mover la plata.
-- El segundo pedido choca con la llave primaria y se rechaza. Lo usan
-- mouv-proxy (Bre-B y ACH) y gasfree (USDT). Solo la toca el servidor.
-- ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.envio_candados (
  clave text PRIMARY KEY,
  user_id uuid,
  accion text,
  creado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS envio_candados_creado_idx ON public.envio_candados (creado_at);
ALTER TABLE public.envio_candados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.envio_candados FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.envio_candados TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule('limpiar-envio-candados') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'limpiar-envio-candados');
SELECT cron.schedule('limpiar-envio-candados', '17 * * * *', $lc$DELETE FROM public.envio_candados WHERE creado_at < now() - interval '2 days'$lc$);
