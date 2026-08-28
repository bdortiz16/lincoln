-- ───────────────────────────────────────────────────────
-- 2026_aml_rules_scope.sql
--
-- Alcance de las reglas AML: son GENERALES (aplican a todos los
-- usuarios) con la excepción de negocio clave — usuarios que ya
-- justificaron sus movimientos ante Compliance o tienen topes
-- aumentados aprobados (custom limits) pueden quedar eximidos.
--
-- Columnas nuevas en public.aml_rules:
--   applies_to            text    — 'all' (hoy el único valor; extensible)
--   exempt_custom_limits  boolean — true = usuarios con custom_daily_limit
--                                   o custom_monthly_limit NO disparan la regla
--   tx_count              integer — umbral de cantidad de TXs para reglas
--                                   velocity / frequent_low
--
-- El motor que evalúa las reglas (edge/cron de Antigravity) debe:
--   1) Cargar las reglas is_active=true.
--   2) Si exempt_custom_limits=true, SALTEAR la evaluación para
--      usuarios donde users.custom_daily_limit IS NOT NULL
--      OR users.custom_monthly_limit IS NOT NULL.
--
-- Idempotente.
-- ───────────────────────────────────────────────────────

ALTER TABLE public.aml_rules
    ADD COLUMN IF NOT EXISTS applies_to           text    NOT NULL DEFAULT 'all',
    ADD COLUMN IF NOT EXISTS exempt_custom_limits boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS tx_count             integer;
