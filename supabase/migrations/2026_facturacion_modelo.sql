-- ════════════════════════════════════════════════════════
--  Facturación automática: el MODELO DE NEGOCIO del cliente.
--
--  Reemplaza (e incluye) lo de 2026_facturacion_items.sql: si aquella no se
--  corrió, con esta basta.
--
--  Dos modelos:
--
--  ROTACIÓN DE CAPITAL. El cliente recibe plata de terceros, la rota y cobra
--  una comisión. Por cada ENTRADA sale una factura de venta con dos ítems que
--  suman exacto lo recibido: "servicio para terceros" (sin IVA, el monto
--  menos la utilidad) y "comisión" (con IVA; base + IVA = utilidad). La
--  utilidad la define el cliente: 1 %, 0,5 %, 0,1 %…
--
--  PSP (PASARELA). El cliente paga a terceros por cuenta de alguien. Por cada
--  SALIDA sale un documento soporte al beneficiario por el monto total, con
--  el ítem de servicio para terceros, sin IVA. La factura de la comisión al
--  cliente la hace el usuario en Siigo.
--
--  Los ítems (productos) los crea el cliente EN SIIGO; acá solo se eligen.
-- ════════════════════════════════════════════════════════

-- De 2026_facturacion_items.sql (por si no se corrió):
ALTER TABLE public.facturacion_config ADD COLUMN IF NOT EXISTS documentos     jsonb;
ALTER TABLE public.facturacion_config ADD COLUMN IF NOT EXISTS items          jsonb;
ALTER TABLE public.facturacion_config ADD COLUMN IF NOT EXISTS ds_document_id integer;
ALTER TABLE public.facturacion_config ADD COLUMN IF NOT EXISTS ds_payment_id  integer;
ALTER TABLE public.comprobantes       ADD COLUMN IF NOT EXISTS factura_tipo   text;

-- El modelo y sus parámetros:
ALTER TABLE public.facturacion_config ADD COLUMN IF NOT EXISTS modelo        text;            -- rotacion | psp
ALTER TABLE public.facturacion_config ADD COLUMN IF NOT EXISTS utilidad_pct  numeric(8,4);    -- 1 = 1 %
ALTER TABLE public.facturacion_config ADD COLUMN IF NOT EXISTS item_terceros text;            -- código del producto "servicio para terceros" en Siigo
ALTER TABLE public.facturacion_config ADD COLUMN IF NOT EXISTS item_comision text;            -- código del producto "comisión" en Siigo
ALTER TABLE public.facturacion_config ADD COLUMN IF NOT EXISTS iva_tax_id    integer;         -- impuesto de la comisión (id en Siigo)
ALTER TABLE public.facturacion_config ADD COLUMN IF NOT EXISTS desc_terceros text;            -- plantilla de la descripción
ALTER TABLE public.facturacion_config ADD COLUMN IF NOT EXISTS desc_comision text;

NOTIFY pgrst, 'reload schema';
