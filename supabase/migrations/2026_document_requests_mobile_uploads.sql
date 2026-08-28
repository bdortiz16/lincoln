-- ───────────────────────────────────────────────────────
-- 2026_document_requests_mobile_uploads.sql
--
-- Sincroniza el schema de document_requests con lo que están
-- subiendo las apps mobile:
--   • category ahora acepta slugs de documentos individuales
--     (cedula_front, selfie, proof_income, etc.) además de las
--     categorías originales de solicitud (source_of_funds, etc.)
--   • Nueva columna file_url text para la URL pública del archivo
--     subido al bucket doc_requests/{user_id}/…
--
-- El mobile hace INSERT o UPDATE de 1 fila por documento —
-- category = slug del doc, file_url = URL pública, status='submitted'.
-- El admin lista todas las filas de un user y aprueba/rechaza
-- individualmente cada documento.
--
-- Idempotente.
-- ───────────────────────────────────────────────────────

-- 1) File URL
ALTER TABLE public.document_requests
    ADD COLUMN IF NOT EXISTS file_url text;

-- 2) Extender el CHECK constraint de category para admitir slugs de docs
ALTER TABLE public.document_requests
    DROP CONSTRAINT IF EXISTS document_requests_category_check;

ALTER TABLE public.document_requests
    ADD CONSTRAINT document_requests_category_check
    CHECK (category IN (
        -- Categorías de solicitud (una request abarca varios docs)
        'source_of_funds',
        'transaction_purpose',
        'beneficiary_id',
        'employment',
        'address',
        'limit_increase',
        'block_unlock',
        'other',
        -- Slugs de documentos individuales (una request = un archivo)
        'cedula_front',
        'cedula_back',
        'selfie',
        'proof_address',
        'proof_income',
        'bank_statement',
        'tax_return'
        -- 'source_of_funds' aparece arriba y también sirve como slug
    ));

-- 3) Índice para el listado del admin — filtro por status='submitted'
--    es la vista principal
CREATE INDEX IF NOT EXISTS document_requests_status_submitted_idx
    ON public.document_requests(user_id, requested_at DESC)
    WHERE status = 'submitted';
