-- ───────────────────────────────────────────────────────
-- 2026_user_block_reason.sql
--
-- Agrega columnas para que el bloqueo desde Compliance guarde
-- motivo estructurado + checklist de documentos requeridos para
-- levantar el bloqueo. Las apps mobile leen esto para renderizar
-- el ComplianceBanner rojo con el sheet de detalle.
--
-- Nuevas columnas en public.users:
--   block_reason        text        — motivo elegido por el admin
--   block_notes         text        — nota libre opcional
--   required_documents  jsonb array — ['cedula_front','proof_income',…]
--
-- No borra ni renombra nada existente. Idempotente.
-- ───────────────────────────────────────────────────────

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS block_reason       text,
    ADD COLUMN IF NOT EXISTS block_notes        text,
    ADD COLUMN IF NOT EXISTS required_documents jsonb DEFAULT '[]'::jsonb;

-- Índice para queries del banner mobile (busca users con block activo).
CREATE INDEX IF NOT EXISTS idx_users_is_active_false
    ON public.users(id) WHERE is_active = false;
