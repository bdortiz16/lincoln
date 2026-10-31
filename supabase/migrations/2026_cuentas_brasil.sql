-- ════════════════════════════════════════════════════════
--  cuentas_brasil — la cuenta en Brasil (PIX · BRL) de cada cliente.
--
--  La abre nuestro aliado en Brasil y la asignamos a un cliente de Lincoin.
--  Puede llegar por dos caminos, y los dos terminan en esta misma fila:
--
--    · origen 'manual': el aliado nos entrega los datos de una cuenta ya
--      abierta y un admin la asigna desde el panel.
--    · origen 'api':    la crea la función `gowd` pidiéndosela a su API a
--      través del proxy mTLS (cuando esté su documentación de cuentas).
--
--  Estados:
--    solicitada  el cliente la pidió desde su panel; nadie la asignó todavía
--    en_creacion se le pidió al aliado por API y todavía no confirma
--    activa      tiene datos bancarios y el cliente los ve para recibir PIX
--    rechazada   no se le va a abrir (motivo en `nota_cliente`)
--    suspendida  existía y se congeló (el cliente deja de verla)
--
--  UNA CUENTA ACTIVA POR CLIENTE: el índice parcial de abajo lo garantiza en
--  la base, no en el navegador.
--
--  QUIÉN ESCRIBE
--    Solo el servidor (función `gowd`, con service_role). El cliente lee SU
--    fila a través de la función, que le devuelve solo lo que le sirve. Nada
--    de esta tabla es escribible desde el navegador: una cuenta bancaria
--    asignada al cliente equivocado es plata que llega a quien no es.
-- ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.cuentas_brasil (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL,
  estado          text NOT NULL DEFAULT 'solicitada'
                    CHECK (estado IN ('solicitada', 'en_creacion', 'activa', 'rechazada', 'suspendida')),
  origen          text NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'api')),

  -- ── Titular (lo que se le manda al aliado) ──
  titular         text,
  documento_tipo  text CHECK (documento_tipo IS NULL OR documento_tipo IN ('CPF', 'CNPJ')),
  documento       text,          -- solo dígitos

  -- ── Datos bancarios (lo que ve el cliente cuando está activa) ──
  banco_nombre    text,
  banco_codigo    text,          -- código COMPE de 3 dígitos
  ispb            text,          -- 8 dígitos
  agencia         text,
  conta           text,          -- con dígito verificador, como la entrega el banco
  conta_tipo      text CHECK (conta_tipo IS NULL OR conta_tipo IN ('corrente', 'pagamento', 'poupanca')),
  chave_pix       text,
  chave_pix_tipo  text CHECK (chave_pix_tipo IS NULL OR chave_pix_tipo IN ('cnpj', 'cpf', 'email', 'telefone', 'aleatoria')),

  -- ── Del lado del aliado ──
  gowd_account_id text,          -- id de la cuenta en el aliado, si lo da
  gowd_respuesta  jsonb,         -- respuesta cruda de su API al crearla (auditoría)

  -- ── Trazabilidad ──
  solicitada_at   timestamptz NOT NULL DEFAULT now(),
  activada_at     timestamptz,
  asignada_por    uuid,          -- admin que la asignó o la creó
  nota_cliente    text,          -- lo que el cliente ve (ej. motivo de rechazo)
  nota_interna    text,          -- solo para el equipo
  actualizado_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cuentas_brasil_user_idx   ON public.cuentas_brasil (user_id);
CREATE INDEX IF NOT EXISTS cuentas_brasil_estado_idx ON public.cuentas_brasil (estado, solicitada_at DESC);

-- Una sola cuenta viva por cliente (solicitada, en creación o activa).
CREATE UNIQUE INDEX IF NOT EXISTS cuentas_brasil_una_viva
  ON public.cuentas_brasil (user_id)
  WHERE estado IN ('solicitada', 'en_creacion', 'activa');

-- La misma cuenta bancaria no puede quedar asignada a dos clientes.
CREATE UNIQUE INDEX IF NOT EXISTS cuentas_brasil_conta_unica
  ON public.cuentas_brasil (banco_codigo, agencia, conta)
  WHERE estado IN ('en_creacion', 'activa') AND conta IS NOT NULL;

ALTER TABLE public.cuentas_brasil ENABLE ROW LEVEL SECURITY;

-- Nadie desde el navegador: ni leer ni escribir. Todo pasa por la función.
REVOKE ALL ON public.cuentas_brasil FROM anon, authenticated, PUBLIC;
REVOKE ALL ON SEQUENCE public.cuentas_brasil_id_seq FROM anon, authenticated, PUBLIC;

GRANT ALL ON public.cuentas_brasil TO service_role;
GRANT ALL ON SEQUENCE public.cuentas_brasil_id_seq TO service_role;

NOTIFY pgrst, 'reload schema';
