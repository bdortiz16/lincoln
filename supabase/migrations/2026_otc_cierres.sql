-- Mesa OTC manual: cierres y su conversacion.
--
-- otc_closes    = la solicitud de cierre y en que estado esta.
-- otc_messages  = lo que se dijeron el cliente y la mesa, en orden.
--
-- El hilo cuelga de LA ORDEN y no del usuario: para explicar por que se libero
-- un cierre hay que poder releer ESE cierre, no un chat general.
--
-- Dos tasas a proposito: rate_cotizada es la que vio el cliente (indicativa) y
-- rate_final la que la mesa toma. No son lo mismo y el expediente necesita las
-- dos.
--
-- Solo las escribe el servidor via la edge otc-mesa. GRANT explicito: el
-- service_role se salta la RLS pero NO los permisos de tabla, y sin el grant
-- PostgREST deja la tabla fuera de su cache y responde que no existe.

CREATE TABLE IF NOT EXISTS public.otc_closes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ref             text        NOT NULL UNIQUE,
  user_id         uuid        NOT NULL,
  side            text        NOT NULL DEFAULT 'vende_usdt',
  from_currency   text        NOT NULL,
  from_amount     numeric     NOT NULL CHECK (from_amount > 0),
  to_currency     text        NOT NULL,
  to_amount       numeric,
  rate_cotizada   numeric,
  rate_final      numeric,
  rate_fuente     text,
  payout          jsonb       DEFAULT '{}'::jsonb,
  status          text        NOT NULL DEFAULT 'abierta',
  motivo_cierre   text,
  tomada_por      uuid,
  tomada_por_nom  text,
  tomada_at       timestamptz,
  confirmada_at   timestamptz,
  pagada_at       timestamptz,
  completada_at   timestamptz,
  cancelada_at    timestamptz,
  last_msg_at     timestamptz,
  last_msg_por    text,
  visto_cliente   timestamptz,
  visto_mesa      timestamptz,
  notas_internas  text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otc_closes_status_idx ON public.otc_closes (status, created_at DESC);
CREATE INDEX IF NOT EXISTS otc_closes_user_idx   ON public.otc_closes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS otc_closes_vivos_idx  ON public.otc_closes (created_at)
  WHERE status IN ('abierta', 'en_proceso', 'esperando_pago', 'pagada');

ALTER TABLE public.otc_closes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.otc_closes FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.otc_closes TO service_role;

CREATE TABLE IF NOT EXISTS public.otc_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  close_id    uuid        NOT NULL REFERENCES public.otc_closes(id) ON DELETE CASCADE,
  autor       text        NOT NULL,
  autor_id    uuid,
  autor_nom   text,
  body        text,
  adjunto_url text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otc_messages_close_idx ON public.otc_messages (close_id, created_at);

ALTER TABLE public.otc_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.otc_messages FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.otc_messages TO service_role;

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
