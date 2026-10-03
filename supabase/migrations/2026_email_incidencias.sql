-- ════════════════════════════════════════════════════════
--  email_incidencias — las direcciones a las que el correo NO está llegando.
--
--  POR QUE EXISTE
--    Cuando una dirección rebota en duro o alguien marca un correo como spam,
--    Resend la pone en su lista de supresión y DEJA DE MANDARLE. Para siempre,
--    hasta que alguien la saque a mano.
--
--    Lo grave no es eso: es que cuando mandamos a una dirección suprimida,
--    Resend igual nos contesta que aceptó el envío. Nuestra función lo toma
--    como éxito y le dice a la persona "te mandamos un código, revisá tu
--    correo" — un correo que Resend ya decidió que nunca va a salir. La
--    persona reintenta, ve el mismo mensaje, y nunca entra. Desde nuestro lado
--    no se ve absolutamente nada.
--
--    Nos pasó con admin@lincoin.me y tardamos horas en darnos cuenta. A un
--    cliente le pasaría igual, solo que él no puede escribirnos para contarlo:
--    el correo es justamente el canal que se rompió.
--
--  QUIEN LA LLENA
--    El webhook de Resend (función resend-webhook), con los eventos de rebote,
--    queja y entrega demorada.
-- ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.email_incidencias (
  id          bigserial PRIMARY KEY,
  creado_at   timestamptz NOT NULL DEFAULT now(),

  -- Siempre en minúsculas: las direcciones no distinguen mayúsculas y buscar
  -- por ellas con distinto formato es la forma más fácil de no encontrar nada.
  email       text NOT NULL,

  -- 'bounced' | 'complained' | 'delivery_delayed' | 'failed'
  tipo        text NOT NULL,
  -- 'hard' | 'soft' | null — un rebote duro es definitivo; uno blando no.
  dureza      text,
  motivo      text,

  email_id    text,          -- el id del envío en Resend, para poder rastrearlo
  asunto      text,
  crudo       jsonb,         -- el evento completo, por si su formato cambia

  -- Se marca cuando alguien ya la sacó de la lista de supresión y confirmó
  -- que el correo vuelve a llegar. Hasta entonces, esa persona está a ciegas.
  resuelto    boolean NOT NULL DEFAULT false,
  resuelto_at timestamptz,
  resuelto_por text
);

-- Lo que el panel pregunta: qué hay sin resolver, lo más nuevo primero.
CREATE INDEX IF NOT EXISTS email_incidencias_pendientes_idx
  ON public.email_incidencias (creado_at DESC)
  WHERE resuelto = false;

CREATE INDEX IF NOT EXISTS email_incidencias_email_idx
  ON public.email_incidencias (lower(email));

ALTER TABLE public.email_incidencias ENABLE ROW LEVEL SECURITY;

-- Saber a quién no le llega el correo es saber quién está por quedarse afuera
-- de su cuenta. No lo lee la app del cliente.
REVOKE ALL ON public.email_incidencias FROM anon, authenticated, PUBLIC;
REVOKE ALL ON SEQUENCE public.email_incidencias_id_seq FROM anon, authenticated, PUBLIC;

-- service_role saltea RLS pero NO los GRANT de tabla: sin esto, PostgREST ni
-- siquiera la muestra.
GRANT ALL ON public.email_incidencias TO service_role;
GRANT ALL ON SEQUENCE public.email_incidencias_id_seq TO service_role;
