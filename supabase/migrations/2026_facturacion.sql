-- ════════════════════════════════════════════════════════
--  facturacion_config — la conexión de CADA cliente con su facturador.
--
--  QUÉ ES
--    El cliente (la empresa que usa Lincoin) tiene su propia cuenta de Siigo.
--    Pide sus credenciales de API, las pone en Contabilidad → Configuración,
--    y desde ahí Lincoin se conecta a SU Siigo y le emite la factura sola
--    apenas una operación se completa. Una fila por cliente.
--
--  LAS CREDENCIALES NO VIVEN EN EL NAVEGADOR
--    El access_key de Siigo se guarda CIFRADO (field-crypto, misma llave que
--    los demás secretos por cliente) y nunca vuelve a la pantalla: la
--    pantalla solo ve si hay una guardada y cuándo se probó. Nadie lee esta
--    tabla desde el cliente: RLS deniega todo y solo la edge function
--    `facturacion`, con el service role, la toca.
--
--  LO QUE SE ELIGE DE LOS CATÁLOGOS DE SIIGO
--    Una factura en Siigo necesita: tipo de documento (FV), vendedor, forma
--    de pago y producto. No se adivinan: "Probar conexión" los trae de la
--    cuenta del cliente y el cliente elige. Se guarda el id elegido y una
--    copia del catálogo para mostrar el nombre sin volver a pedirlo.
--
--  QUÉ SE FACTURA
--    `disparadores` dice qué tipos de operación generan factura. Por defecto,
--    las ENTRADAS (depósitos y pagos recibidos): es lo que una empresa
--    factura — lo que le pagan. Un envío a un proveedor es una compra, no una
--    venta; se puede activar, pero no viene activado.
-- ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.facturacion_config (
  user_id           uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  proveedor         text NOT NULL DEFAULT 'siigo',
  activo            boolean NOT NULL DEFAULT false,

  -- Credenciales de la API de Siigo del cliente. access_key va CIFRADO.
  username          text,
  access_key_enc    text,
  partner_id        text,

  -- Lo elegido de los catálogos de Siigo.
  document_id       integer,
  seller_id         integer,
  payment_id        integer,
  product_code      text,
  product_description text,

  -- A quién se le factura cuando la operación no trae un documento de
  -- contraparte (un depósito, por ejemplo). Consumidor final en Colombia:
  -- 222222222222.
  cliente_default_nit text DEFAULT '222222222222',
  cliente_default_nombre text DEFAULT 'Consumidor final',
  -- Si la contraparte no existe en Siigo, ¿se crea sola?
  crear_clientes    boolean NOT NULL DEFAULT true,

  -- Tipos de operación que generan factura.
  disparadores      jsonb NOT NULL DEFAULT '["load","pay_received"]'::jsonb,
  -- Enviar a la DIAN (stamp) y al correo del cliente (mail).
  stamp             boolean NOT NULL DEFAULT true,
  mail              boolean NOT NULL DEFAULT true,
  observaciones     text,

  -- Última prueba de conexión y su resultado, textual. "No se pudo" no
  -- sirve; "401 Unauthorized: invalid access_key" sí.
  ultimo_test_at    timestamptz,
  ultimo_test_ok    boolean,
  ultimo_error      text,
  catalogos         jsonb,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.facturacion_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facturacion_config FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.facturacion_config TO service_role;

-- ── El resultado de cada factura, en el comprobante ──
-- comprobantes ya tenía factura_proveedor / factura_numero / factura_cufe /
-- factura_at. Se agregan el estado, el error textual, los intentos y la URL
-- pública que devuelve Siigo.
ALTER TABLE public.comprobantes ADD COLUMN IF NOT EXISTS factura_estado   text;  -- pendiente | emitida | error | omitida
ALTER TABLE public.comprobantes ADD COLUMN IF NOT EXISTS factura_error    text;
ALTER TABLE public.comprobantes ADD COLUMN IF NOT EXISTS factura_intentos integer NOT NULL DEFAULT 0;
ALTER TABLE public.comprobantes ADD COLUMN IF NOT EXISTS factura_url      text;
ALTER TABLE public.comprobantes ADD COLUMN IF NOT EXISTS factura_id       text;  -- id interno de Siigo
ALTER TABLE public.comprobantes ADD COLUMN IF NOT EXISTS factura_detalle  jsonb; -- lo que Siigo contestó, tal cual

CREATE INDEX IF NOT EXISTS comprobantes_factura_pend_idx
  ON public.comprobantes (user_id, emitido_at DESC)
  WHERE factura_estado IN ('pendiente', 'error');

GRANT ALL ON public.comprobantes TO service_role;
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Secrets que necesita la edge function `facturacion`:
--   FIELD_ENC_KEY   — la misma que ya usan los demás secretos por cliente.
-- La URL base de Siigo es https://api.siigo.com y no se configura: si algún
-- día cambia, se cambia en el código con un despliegue, no a mano por cliente.
-- ============================================================================
