-- ════════════════════════════════════════════════════════
--  Facturación automática: qué DOCUMENTO sale por cada operación, y los
--  ÍTEMS que lleva.
--
--  Antes había una sola regla: "estas operaciones → factura de venta con
--  este producto". Una empresa emite dos cosas distintas según de qué lado
--  va la plata:
--
--    · Le ENTRA plata (depósito, pago recibido)  → FACTURA DE VENTA (FV).
--    · Le SALE plata a alguien que no factura     → DOCUMENTO SOPORTE (DS),
--      el que la DIAN exige por compras a no obligados a facturar.
--
--  `documentos` dice, por tipo de operación, cuál de los dos sale (o
--  ninguno). `items` son las líneas del documento: producto de Siigo,
--  descripción, cantidad, cómo se calcula el valor (el monto de la
--  operación, un porcentaje del monto, o un valor fijo) e impuesto.
-- ════════════════════════════════════════════════════════

ALTER TABLE public.facturacion_config ADD COLUMN IF NOT EXISTS documentos     jsonb;    -- { "load": "FV", "dispersion": "DS", … }
ALTER TABLE public.facturacion_config ADD COLUMN IF NOT EXISTS items          jsonb;    -- [ { code, description, quantity, valor, porcentaje, fijo, tax_id } ]
ALTER TABLE public.facturacion_config ADD COLUMN IF NOT EXISTS ds_document_id integer;  -- tipo de comprobante "Documento soporte" en Siigo
ALTER TABLE public.facturacion_config ADD COLUMN IF NOT EXISTS ds_payment_id  integer;  -- forma de pago para el documento soporte

-- Qué salió: factura de venta o documento soporte.
ALTER TABLE public.comprobantes ADD COLUMN IF NOT EXISTS factura_tipo text;  -- FV | DS

NOTIFY pgrst, 'reload schema';
