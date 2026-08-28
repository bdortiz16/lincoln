-- ───────────────────────────────────────────────────────
-- 2026_document_requests_block_unlock.sql
--
-- Amplía el CHECK constraint de document_requests.category para
-- aceptar 'block_unlock'. Sin esto, el INSERT que hace
-- ComplianceSection.applyBlock() cuando se bloquea con documentos
-- requeridos falla en silencio y la solicitud nunca aparece en
-- Compliance → Documentación.
--
-- Idempotente — dropea el constraint anterior y lo re-crea con la
-- lista completa (incluye limit_increase que ya venía de
-- 2026_document_requests_limit_increase.sql).
-- ───────────────────────────────────────────────────────

ALTER TABLE public.document_requests
    DROP CONSTRAINT IF EXISTS document_requests_category_check;

ALTER TABLE public.document_requests
    ADD CONSTRAINT document_requests_category_check
    CHECK (category IN (
        'source_of_funds',
        'transaction_purpose',
        'beneficiary_id',
        'employment',
        'address',
        'limit_increase',   -- ampliación de topes (iniciada por el user)
        'block_unlock',     -- levantamiento de bloqueo (iniciada por admin)
        'other'
    ));
