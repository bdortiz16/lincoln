-- ───────────────────────────────────────────────────────
-- 2026_document_requests_limit_increase.sql
--
-- Amplía el flujo de document_requests para que el USER pueda
-- iniciar una solicitud (no solo el admin como hoy).
--
-- Caso de uso: el cliente quiere ampliar sus topes de transferencia
-- diarios/mensuales. Desde la app iOS/Android, abre "Topes y Límites
-- → Solicitar ampliación", adjunta los 4 documentos requeridos
-- (cédula, selfie, comprobante ingresos, factura servicios) y le
-- llega al admin en Compliance → Documentación como una solicitud
-- tipo 'limit_increase' en status 'submitted' (ya respondida, lista
-- para revisar).
-- ───────────────────────────────────────────────────────

-- 1) Ampliar el CHECK constraint del category para aceptar 'limit_increase'
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
        'limit_increase',   -- nuevo: iniciado por el user
        'other'
    ));

-- 2) RPC que la app móvil llama desde "Solicitar ampliación de topes".
--    Crea la solicitud en status 'submitted' (no 'pending') porque el
--    user YA está mandando los documentos en este mismo acto — el flujo
--    nace con respuesta. El admin solo aprueba/rechaza.
--
--    attachments es un array de objetos { url, name?, mime? } que la
--    app sube primero al bucket de Storage y después pasa las URLs acá.
--
--    Devuelve el id de la solicitud creada, o un error claro si el user
--    ya tiene otra ampliación de topes pendiente (evita spam).
CREATE OR REPLACE FUNCTION public.request_limit_increase(
    p_user_response text,
    p_attachments   jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_id  uuid;
    v_existing uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('error', 'not authenticated');
    END IF;

    -- Validación: bloquear si ya hay una ampliación abierta del mismo user
    SELECT id INTO v_existing
    FROM public.document_requests
    WHERE user_id = v_uid
      AND category = 'limit_increase'
      AND status IN ('pending', 'submitted', 'escalated')
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object(
            'error', 'already_pending',
            'message', 'Ya tenés una solicitud de ampliación en revisión.',
            'existing_id', v_existing
        );
    END IF;

    -- Validación de attachments — mínimo 1 archivo
    IF jsonb_array_length(COALESCE(p_attachments, '[]'::jsonb)) = 0 THEN
        RETURN jsonb_build_object(
            'error', 'no_attachments',
            'message', 'Adjuntá al menos un documento.'
        );
    END IF;

    INSERT INTO public.document_requests (
        user_id,
        category,
        title,
        description,
        status,
        requested_by,
        user_response,
        responded_at,
        attachments
    ) VALUES (
        v_uid,
        'limit_increase',
        'Solicitud de ampliación de topes',
        'El usuario solicita aumentar los topes de transferencia diarios y mensuales. Adjuntos: cédula, selfie con documento, comprobante de ingresos, recibo de servicios.',
        'submitted',          -- nace con respuesta
        v_uid,                -- iniciada por el propio user
        COALESCE(p_user_response, ''),
        now(),
        p_attachments
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object(
        'ok', true,
        'id', v_id,
        'status', 'submitted',
        'message', 'Solicitud enviada. Te respondemos en 1-2 días hábiles.'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_limit_increase(text, jsonb) TO authenticated;

-- 3) Asegurar que el bucket de storage existe para que la app pueda
--    subir los archivos antes de llamar al RPC. Si Antigravity ya lo
--    creó en otra migración, este INSERT es no-op por ON CONFLICT.
INSERT INTO storage.buckets (id, name, public)
VALUES ('doc_requests', 'doc_requests', false)
ON CONFLICT (id) DO NOTHING;

-- 4) Policy para que el user solo pueda subir/leer SUS archivos
--    en doc_requests/<user_id>/...
DROP POLICY IF EXISTS doc_requests_user_upload ON storage.objects;
CREATE POLICY doc_requests_user_upload ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'doc_requests'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS doc_requests_user_read_own ON storage.objects;
CREATE POLICY doc_requests_user_read_own ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'doc_requests'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Admins de compliance/super_admin leen TODOS los archivos del bucket
DROP POLICY IF EXISTS doc_requests_admin_read_all ON storage.objects;
CREATE POLICY doc_requests_admin_read_all ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'doc_requests'
        AND EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = auth.uid()
              AND u.admin_role IN ('super_admin', 'compliance')
        )
    );
