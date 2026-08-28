-- ───────────────────────────────────────────────────────
-- 2026_user_block_type.sql
--
-- Agrega columna block_type para distinguir bloqueo temporal
-- (el user puede desbloquearse subiendo docs) vs bloqueo
-- permanente (no hay flujo de desbloqueo desde la app, solo
-- vía intervención manual).
--
-- Flujo:
--   1) Admin bloquea temporalmente + pide docs.
--   2) User sube docs a document_requests.
--   3) Admin revisa. Si NO justifican, presiona "Bloqueo
--      permanente" en el ReviewModal → block_type='permanent'.
--   4) Mobile ComplianceBanner rojo cambia de "subí docs para
--      desbloquearte" → "cuenta bloqueada permanentemente,
--      contactá soporte".
--
-- Idempotente.
-- ───────────────────────────────────────────────────────

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS block_type text
        CHECK (block_type IN ('temporary', 'permanent'));
