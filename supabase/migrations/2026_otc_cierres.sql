-- ============================================================================
-- Mesa OTC manual — cierres y su conversacion
-- ============================================================================
--
-- La mesa automatica (riel ACH) convierte sola: el cliente aprieta y el saldo
-- se mueve. La mesa MANUAL no: es una operacion NEGOCIADA. El cliente dice
-- cuanto quiere mover, la mesa confirma a que tasa la toma, se acuerdan las
-- instrucciones de pago, alguien paga, alguien libera. Entre esos dos extremos
-- hay una conversacion, y esa conversacion ES la operacion.
--
-- DOS TABLAS:
--
--   otc_closes    · la solicitud de cierre y en que estado esta.
--   otc_messages  · lo que se dijeron el cliente y la mesa, en orden.
--
-- POR QUE MENSAJERIA PROPIA Y NO EL CHAT DE SOPORTE
--   El hilo tiene que colgar de LA ORDEN, no del usuario. Cuando hay que
--   explicar por que se libero un cierre de 3.000.000, lo que se mira es el
--   hilo de ESE cierre: que tasa se acordo, quien dijo que ya habia pagado, a
--   que hora. Un chat de soporte general mezcla eso con el resto y vive en un
--   tercero, que no responde por nuestro expediente.
--
-- DOS TASAS, A PROPOSITO
--   rate_cotizada  · la que vio el cliente cuando pidio el cierre. Es
--                    INDICATIVA y se guarda para poder decir despues "esto es
--                    lo que le mostramos".
--   rate_final     · la que la mesa efectivamente toma. Es la que manda.
--   No se guarda una sola porque no son la misma cosa: prometer que la tasa de
--   la pantalla es la de ejecucion, en una operacion que tarda minutos y se
--   negocia por chat, seria mentir.
--
-- Solo las escribe el servidor (service_role), a traves de la edge otc-mesa.
-- Con GRANT explicito: el service_role se salta la RLS pero NO los permisos de
-- tabla, y sin el grant PostgREST deja la tabla fuera de su cache y responde
-- "no existe".
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.otc_closes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Referencia corta que se dice por telefono y se pega en el chat.
  ref             text        NOT NULL UNIQUE,
  user_id         uuid        NOT NULL,

  -- 'vende_usdt' = el cliente entrega USDT y recibe COP (el caso normal).
  -- 'compra_usdt' = al reves.
  side            text        NOT NULL DEFAULT 'vende_usdt',

  -- Lo que el cliente ENTREGA y lo que ESPERA recibir, tal como lo pidio.
  from_currency   text        NOT NULL,
  from_amount     numeric     NOT NULL CHECK (from_amount > 0),
  to_currency     text        NOT NULL,
  to_amount       numeric,

  rate_cotizada   numeric,                    -- la que vio el cliente
  rate_final      numeric,                    -- la que la mesa toma
  rate_fuente     text,                       -- de donde salio la cotizada

  -- Donde quiere recibir. Texto libre + estructurado: la mesa opera con
  -- bancos que cambian, y encorsetarlo en columnas fijas obliga a migrar la
  -- tabla cada vez que entra un banco nuevo.
  payout          jsonb       DEFAULT '{}'::jsonb,

  -- abierta → en_proceso → esperando_pago → pagada → completada
  --                                      ↘ cancelada
  status          text        NOT NULL DEFAULT 'abierta',
  motivo_cierre   text,                       -- por que se cancelo, si se cancelo

  -- Quien la esta atendiendo. Sin esto, dos operadores contestan el mismo
  -- cierre y el cliente ve dos tasas distintas.
  tomada_por      uuid,
  tomada_por_nom  text,
  tomada_at       timestamptz,

  -- Sellos de cada paso. Van como columnas y no dentro de un jsonb de
  -- historial porque son lo que se ordena y se filtra en el panel.
  confirmada_at   timestamptz,                -- la mesa fijo rate_final
  pagada_at       timestamptz,                -- el cliente dijo que envio
  completada_at   timestamptz,                -- la mesa libero
  cancelada_at    timestamptz,

  -- Para el contador de "sin leer" de cada lado. Se comparan contra
  -- last_msg_at en vez de llevar un entero que se desincroniza.
  last_msg_at     timestamptz,
  last_msg_por    text,                       -- 'cliente' | 'mesa' | 'sistema'
  visto_cliente   timestamptz,
  visto_mesa      timestamptz,

  notas_internas  text,                       -- solo mesa; el cliente no lo ve
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- El panel abre siempre por "las que esperan a la mesa, primero las viejas".
CREATE INDEX IF NOT EXISTS otc_closes_status_idx  ON public.otc_closes (status, created_at DESC);
CREATE INDEX IF NOT EXISTS otc_closes_user_idx    ON public.otc_closes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS otc_closes_abiertas_idx
  ON public.otc_closes (created_at)
  WHERE status IN ('abierta', 'en_proceso', 'esperando_pago', 'pagada');

ALTER TABLE public.otc_closes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.otc_closes FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.otc_closes TO service_role;


CREATE TABLE IF NOT EXISTS public.otc_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  close_id    uuid        NOT NULL REFERENCES public.otc_closes(id) ON DELETE CASCADE,

  -- 'cliente' | 'mesa' | 'sistema'. El de sistema es el que narra los cambios
  -- de estado ("la mesa fijo la tasa en 3.339") para que el hilo se pueda leer
  -- solo, sin cruzarlo con la tabla de estados.
  autor       text        NOT NULL,
  autor_id    uuid,
  autor_nom   text,

  body        text,
  adjunto_url text,                           -- comprobante de pago

  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otc_messages_close_idx ON public.otc_messages (close_id, created_at);

ALTER TABLE public.otc_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.otc_messages FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.otc_messages TO service_role;


-- Limpieza de politicas viejas si se corre dos veces.
DO $limpia_pol_otc$
DECLARE p record;
BEGIN
  FOR p IN SELECT tablename, policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename IN ('otc_closes', 'otc_messages') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END;
$limpia_pol_otc$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Comprobacion APARTE, en otra pestana (pegada aca, un error revierte el DDL):
--
--   SELECT
--     EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='otc_closes')   AS closes,
--     EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='otc_messages') AS mensajes,
--     NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
--                 WHERE table_schema='public' AND table_name IN ('otc_closes','otc_messages')
--                   AND grantee IN ('anon','authenticated','PUBLIC'))                          AS cerradas_al_cliente;
-- ============================================================================
