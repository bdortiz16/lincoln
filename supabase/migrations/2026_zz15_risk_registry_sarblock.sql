-- ════════════════════════════════════════════════════════════════════
-- Lincoin Risk con Sarblock — idempotente, no toca datos existentes.
--
-- El padrón (risk_registry) guarda un resultado por documento y lo
-- comparten todas las cuentas. Las filas de Sarblock necesitan dos cosas
-- que las de TusDatos no tenían:
--   · ficha    → la ficha completa con el catálogo de la consulta (todas
--                las fuentes), para dar el mismo veredicto y el mismo PDF
--                a la siguiente cuenta que pregunte sin pagar otra vez.
--   · criterio → qué versión de la matriz de riesgo de Lincoin la juzgó.
--
-- Solo agrega columnas vacías: las filas que ya existen no cambian.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.risk_registry ADD COLUMN IF NOT EXISTS ficha jsonb;
ALTER TABLE public.risk_registry ADD COLUMN IF NOT EXISTS criterio text;

COMMENT ON COLUMN public.risk_registry.ficha IS 'Ficha completa de Sarblock (con catálogo) para reutilizar sin costo. NULL en filas de TusDatos.';
COMMENT ON COLUMN public.risk_registry.criterio IS 'Versión de la matriz de riesgo de Lincoin que juzgó la ficha (p. ej. lincoin-v1-2026-10-27).';
