-- Mesa OTC manual: plazo para pagar y comprobante del envio.
--
-- vence_at: hasta cuando el cliente tiene para pagar y subir el comprobante,
-- contado desde que la mesa fija la tasa. Vencido, el cierre se cancela: una
-- tasa acordada no se puede sostener indefinidamente mientras el mercado se
-- mueve.
--
-- OJO: cancelar por vencimiento NO prueba que el cliente no haya pagado. Puede
-- haber enviado el dinero sobre la hora y no llegar a subir el comprobante. Por
-- eso el hilo del cierre queda ABIERTO aunque este cancelado, y el mensaje de
-- cancelacion le dice que escriba en vez de volver a montar la orden.
ALTER TABLE public.otc_closes ADD COLUMN IF NOT EXISTS vence_at timestamptz;

-- Comprobantes de pago. Bucket PRIVADO: es un documento bancario del cliente.
-- Sin politicas para anon ni authenticated a proposito -- la app Empresas usa
-- auth propia y auth.uid() ahi es nulo, asi que una politica basada en el no
-- protegeria nada. Todo entra y sale por la edge otc-mesa, que valida al
-- llamante y firma URLs temporales.
INSERT INTO storage.buckets (id, name, public)
VALUES ('otc-comprobantes', 'otc-comprobantes', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "otc_comprobantes_sin_acceso_directo" ON storage.objects;

NOTIFY pgrst, 'reload schema';
