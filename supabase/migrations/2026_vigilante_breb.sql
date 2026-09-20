-- Vigilante de dispersiones Bre-B.
--
-- QUE HACE
--   Cada minuto le pregunta a Mouv por los envios de los ultimos 45 minutos.
--   Si uno salio FALLIDO o fue RECHAZADO, marca la dispersion y le devuelve el
--   saldo al cliente en el acto. Si salio COMPLETADO, lo confirma. En los dos
--   casos el cliente recibe el aviso.
--
-- POR QUE ADENTRO DE SUPABASE
--   Hasta ahora esto solo corria cuando alguien abria una pantalla: el cliente
--   al entrar a la app, o el operador al apretar un boton. Un envio devuelto un
--   viernes a las 8 de la noche se quedaba sin reembolsar hasta que alguien
--   mirara. Aca no depende de nadie.
--
-- CADA MINUTO, Y ES BARATO
--   El modo vigilancia mira SOLO lo que sigue en curso y es reciente: una
--   consulta al listado de Mouv y unas pocas filas. El limite de lectura del
--   proveedor es 100/min, asi que una corrida por minuto no lo roza.
--
--   El barrido completo de 5 dias -- el que atrapa devoluciones tardias sobre
--   envios que ya figuraban completados -- sigue yendo aparte, cada 10 min.
--
-- ES IDEMPOTENTE
--   Cada reembolso se reclama con un CAS antes de tocar el saldo, asi que dos
--   corridas superpuestas no acreditan dos veces.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- La URL y la llave NO se escriben acá: quedarian en el cuerpo de la funcion y
-- las lee cualquiera con acceso a la base. Van en la tabla de configuracion,
-- que ya esta cerrada a anon y authenticated.
--
-- Antes de programarlo, guardalos una vez:
--   insert into private_config(key, value) values
--     ('supabase_url', 'https://TUPROYECTO.supabase.co'),
--     ('service_key',  'eyJ...la service_role key...')
--   on conflict (key) do update set value = excluded.value;

CREATE TABLE IF NOT EXISTS public.private_config (
  key   text PRIMARY KEY,
  value text NOT NULL
);
ALTER TABLE public.private_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.private_config FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.private_config TO service_role;

CREATE OR REPLACE FUNCTION public.vigilar_breb(p_recientes int DEFAULT 45)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $vig$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT value INTO v_url FROM private_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM private_config WHERE key = 'service_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'vigilar_breb: falta supabase_url o service_key en private_config';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/mouv-proxy',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'apikey', v_key,
                 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object(
                 'action', 'reconcile_breb',
                 'todos', true,
                 'recientesMin', p_recientes),
    timeout_milliseconds := 60000
  );
END;
$vig$;

REVOKE ALL ON FUNCTION public.vigilar_breb(int) FROM PUBLIC, anon, authenticated;

-- Reprogramar sin duplicar: correr esto dos veces no deja dos vigilantes.
SELECT cron.unschedule('vigilar-breb')        WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vigilar-breb');
SELECT cron.unschedule('conciliar-breb-full') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'conciliar-breb-full');

-- Cada minuto: lo reciente y vivo.
SELECT cron.schedule('vigilar-breb', '* * * * *', $$SELECT public.vigilar_breb(45)$$);

-- Cada 10 minutos: el barrido de 5 dias, por las devoluciones tardias.
SELECT cron.schedule('conciliar-breb-full', '*/10 * * * *', $$SELECT public.vigilar_breb(0)$$);

NOTIFY pgrst, 'reload schema';
