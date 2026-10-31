-- ════════════════════════════════════════════════════════
--  gowd_eventos — todo lo que el banco de Brasil nos manda, tal como llegó.
--
--  POR QUE UNA TABLA Y NO SOLO LOGS
--    Un webhook de un banco mueve plata. Si algo sale mal hay que poder
--    mostrar QUE nos mandaron y CUANDO, no "me parece que llegó". Los logs de
--    edge functions se borran solos a los pocos días; una disputa con un banco
--    no se resuelve en pocos días.
--
--  UN POSTBACK DE GOWD NO ES UNA PRUEBA
--    Su documentación describe el cuerpo del postback y qué hay que
--    contestarle (200 con returnCode SUCCESS, y si no reintentan 4 veces más).
--    No describe NINGUNA firma ni secreto: por lo que está escrito, cualquiera
--    que descubra la URL puede mandarnos "ORDER-PAYIN.PAID" por el monto que
--    se le ocurra.
--
--    Por eso la regla es: el postback AVISA, no ACREDITA. Antes de mover un
--    peso hay que preguntarle a la API de Gowd por ese id y creerle a la
--    respuesta, no al aviso. confirmado_api es la columna que marca eso.
--
--    verificado  = la entrega traía una firma válida (si algún día la tienen)
--    confirmado_api = le preguntamos a Gowd y nos confirmó. ESTA es la que
--                     habilita a tocar saldos.
--
--  GOWD REINTENTA
--    Si no contestamos 200, reintentan 4 veces más. O sea que el MISMO evento
--    llega hasta 5 veces. Acá se guardan todas las entregas (son la auditoría);
--    lo que tiene que ser idempotente es quien las procese.
-- ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.gowd_eventos (
  id           bigserial PRIMARY KEY,
  recibido_at  timestamptz NOT NULL DEFAULT now(),

  -- false mientras no haya secreto configurado o la firma no valide.
  verificado   boolean NOT NULL DEFAULT false,
  -- 'sin_secreto' | 'header' | 'hmac_hex' | 'hmac_b64' | 'rechazado'
  metodo_auth  text,

  -- Le preguntamos a la API de Gowd por este id y nos confirmó. SOLO con esto
  -- en true se puede mover un saldo. Un postback por sí solo no alcanza.
  confirmado_api boolean NOT NULL DEFAULT false,

  -- ── Lo que trae el postback, ya separado ──
  -- Se extraen para poder buscar sin abrir el JSON, pero el JSON completo
  -- queda igual: si su formato cambia, el crudo sigue siendo la prueba.
  orden_id     text,        -- id interno de Gowd
  orden_code   text,        -- nuestro código, el que mandamos al crear
  evento       text,        -- ORDER-PAYIN.PAID, ORDER-PAYOUT.ERROR, ...
  estado       text,        -- PAID | EXPIRED | CANCELED | ERROR | REFUNDED | ...
  tipo         text,        -- PAY-IN | PAY-OUT | REFUND | LOAD | TRANSFER
  end_to_end   text,        -- endToEndId del PIX, cuando viene
  -- El monto como TEXTO, nunca como número de punto flotante: "50.00" pasado
  -- por un float deja de ser 50.00 y en plata eso no se perdona.
  monto_valor  text,
  monto_moneda text,
  actualizado_at timestamptz,  -- updatedAt: cuándo cambió de estado

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

-- Para que quien procese pueda preguntar "¿esta transición ya la atendí?"
-- antes de actuar — Gowd manda el mismo evento hasta 5 veces.
CREATE INDEX IF NOT EXISTS gowd_eventos_orden_idx
  ON public.gowd_eventos (orden_id, evento, actualizado_at);

CREATE INDEX IF NOT EXISTS gowd_eventos_code_idx
  ON public.gowd_eventos (orden_code);

-- Para encontrar rápido lo que todavía no se atendió.
CREATE INDEX IF NOT EXISTS gowd_eventos_pendientes_idx
  ON public.gowd_eventos (recibido_at DESC)
  WHERE procesado = false;

ALTER TABLE public.gowd_eventos ENABLE ROW LEVEL SECURITY;

-- Acá adentro hay datos de clientes y montos de un banco. No lo lee ni el
-- cliente ni la app: solo el backend.
REVOKE ALL ON public.gowd_eventos FROM anon, authenticated, PUBLIC;
REVOKE ALL ON SEQUENCE public.gowd_eventos_id_seq FROM anon, authenticated, PUBLIC;

-- service_role saltea RLS pero NO los GRANT de tabla: sin esto, PostgREST ni
-- siquiera la muestra.
GRANT ALL ON public.gowd_eventos TO service_role;
GRANT ALL ON SEQUENCE public.gowd_eventos_id_seq TO service_role;
