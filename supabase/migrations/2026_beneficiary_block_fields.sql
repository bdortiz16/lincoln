-- ───────────────────────────────────────────────────────
-- 2026_beneficiary_block_fields.sql
--
-- Columnas de bloqueo estructurado para beneficiarios (terceros) —
-- mirror de las de users. El admin bloquea con motivo + checklist
-- de documentos requeridos; la app mobile lee estas columnas para
-- mostrar el flujo de re-documentación vía Didit al dueño.
--
-- También extiende el CHECK de kyc_status (si existe) para aceptar
-- el nuevo estado 'blocked'.
--
-- Idempotente.
-- ───────────────────────────────────────────────────────

ALTER TABLE public.beneficiaries
    ADD COLUMN IF NOT EXISTS block_type         text
        CHECK (block_type IN ('temporary', 'permanent')),
    ADD COLUMN IF NOT EXISTS block_reason       text,
    ADD COLUMN IF NOT EXISTS block_notes        text,
    ADD COLUMN IF NOT EXISTS required_documents jsonb DEFAULT '[]'::jsonb;

-- Extender el CHECK de kyc_status para aceptar 'blocked'.
-- Si la tabla no tenía constraint, este bloque lo crea permisivo.
ALTER TABLE public.beneficiaries
    DROP CONSTRAINT IF EXISTS beneficiaries_kyc_status_check;

ALTER TABLE public.beneficiaries
    ADD CONSTRAINT beneficiaries_kyc_status_check
    CHECK (kyc_status IS NULL OR kyc_status IN (
        'approved','pending','rejected','in_progress',
        'in_review','verified','expired','declined','blocked'
    ));
