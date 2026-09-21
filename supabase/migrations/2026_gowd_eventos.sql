-- ════════════════════════════════════════════════════════
--  gowd_eventos — todo lo que el banco de Brasil nos manda, tal como llegó.
--
--  POR QUE UNA TABLA Y NO SOLO LOGS
--    Un webhook de un banco mueve plata. Si algo sale mal hay que poder
--    mostrar QUE nos mandaron y CUANDO, no "me parece que llegó". Los logs de
--    edge functions se borran solos a los pocos días; una disputa con un banco
--    no se resuelve en pocos días.
--
--  VERIFICADO ES LA COLUMNA QUE IMPORTA
--    Mientras no sepamos cómo firma Gowd sus webhooks, los eventos se guardan
--    con verificado = false. NADA que toque saldos puede leer una fila con
--    verificado = false. Guardar un evento no es creerle.
-- ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.gowd_eventos (
  id           bigserial PRIMARY KEY,
  recibido_at  timestamptz NOT NULL DEFAULT now(),

  -- false mientras no haya secreto configurado o la firma no valide.
  verificado   boolean NOT NULL DEFAULT false,
  -- 'sin_secreto' | 'header' | 'hmac_hex' | 'hmac_b64' | 'rechazado'
  metodo_auth  text,

  -- Nombres de las cabeceras que trajo, y los valores de las que no son
  -- credenciales. Con esto se descubre su esquema de firma sin guardar el
  -- secreto de nadie en claro.
  headers      jsonb,
  ip           text,

  -- El cuerpo tal cual y, si parseó, como JSON. Se guardan los dos: si su
  -- formato cambia, el texto crudo sigue siendo la prueba.
  cuerpo_texto text,
  cuerpo       jsonb,

  -- Se marca cuando algo del sistema ya actuó sobre este evento. Hoy nada lo
  -- hace: no hay lógica de negocio de Gowd todavía.
  procesado    boolean NOT NULL DEFAULT false,
  procesado_at timestamptz,
  nota         text
);

CREATE INDEX IF NOT EXISTS gowd_eventos_recibido_idx
  ON public.gowd_eventos (recibido_at DESC);

-- Para encontrar rápido lo que todavía no se atendió.
CREATE INDEX IF NOT EXISTS gowd_eventos_pendientes_idx
  ON public.gowd_eventos (recibido_at DESC)
  WHERE verificado = true AND procesado = false;

ALTER TABLE public.gowd_eventos ENABLE ROW LEVEL SECURITY;

-- Acá adentro hay datos de clientes y montos de un banco. No lo lee ni el
-- cliente ni la app: solo el backend.
REVOKE ALL ON public.gowd_eventos FROM anon, authenticated, PUBLIC;
REVOKE ALL ON SEQUENCE public.gowd_eventos_id_seq FROM anon, authenticated, PUBLIC;

-- service_role saltea RLS pero NO los GRANT de tabla: sin esto, PostgREST ni
-- siquiera la muestra.
GRANT ALL ON public.gowd_eventos TO service_role;
GRANT ALL ON SEQUENCE public.gowd_eventos_id_seq TO service_role;
