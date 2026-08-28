-- ───────────────────────────────────────────────────────
-- 2026_compliance_hold.sql
--
-- Compliance Hold: cuando hay una o más solicitudes de documentación
-- pendientes para un usuario, su cuenta queda en "hold" y NO puede
-- enviar (`send`) ni cargar (`load`) plata. Solo puede convertir
-- (`convert`) lo que ya tiene en sus wallets — eso le permite mover
-- el saldo dentro de CuyPay pero no aumentar exposición externa
-- hasta que compliance apruebe los docs.
--
-- Reusa la tabla `document_requests` ya existente. No crea
-- `compliance_document_requests` separada para evitar duplicación
-- y mantener un solo origen de verdad. El RPC `get_my_compliance_status`
-- expone los campos con los nombres que pidió la app móvil.
--
-- Estados de document_requests que activan hold:
--   • pending    → la solicitud está esperando respuesta del usuario
--   • submitted  → el usuario respondió, compliance todavía no revisó
--   • escalated  → compliance escaló a otra área, sigue en revisión
--
-- Estados que liberan el hold (siempre y cuando no haya otra activa):
--   • approved   → compliance aprobó, el usuario puede operar
--   • rejected   → compliance rechazó, el caso se cierra
--   • canceled   → compliance canceló la solicitud
-- ───────────────────────────────────────────────────────

-- 1) Columnas en users
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS compliance_hold         boolean     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS compliance_hold_set_at  timestamptz,
    ADD COLUMN IF NOT EXISTS compliance_hold_reason  text;

CREATE INDEX IF NOT EXISTS users_compliance_hold_idx
    ON public.users(compliance_hold) WHERE compliance_hold;

COMMENT ON COLUMN public.users.compliance_hold IS
    'Si true, el user no puede send/load — solo convert. Se setea automáticamente por trigger según document_requests.';

-- 2) Campo opcional para que el usuario suba 1 archivo principal
ALTER TABLE public.document_requests
    ADD COLUMN IF NOT EXISTS user_response_url text;

-- 3) Recompute helper — recalcula el flag para un user
CREATE OR REPLACE FUNCTION public.recompute_compliance_hold(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_has_active boolean;
    v_was_on_hold boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM public.document_requests
        WHERE user_id = p_user_id
          AND status IN ('pending', 'submitted', 'escalated')
    ) INTO v_has_active;

    SELECT compliance_hold INTO v_was_on_hold
    FROM public.users WHERE id = p_user_id;

    UPDATE public.users
    SET
        compliance_hold        = v_has_active,
        compliance_hold_set_at = CASE
            WHEN v_has_active AND NOT COALESCE(v_was_on_hold, false) THEN now()
            WHEN NOT v_has_active THEN NULL
            ELSE compliance_hold_set_at
        END,
        compliance_hold_reason = CASE
            WHEN v_has_active THEN 'Solicitudes de documentación pendientes'
            ELSE NULL
        END
    WHERE id = p_user_id;
END;
$$;

-- 4) Trigger: cualquier INSERT/UPDATE de status/DELETE en document_requests
--    recalcula automáticamente el hold del user afectado.
CREATE OR REPLACE FUNCTION public.tg_document_requests_recompute_hold()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.recompute_compliance_hold(OLD.user_id);
        RETURN OLD;
    END IF;

    PERFORM public.recompute_compliance_hold(NEW.user_id);

    -- Si el user_id cambió (caso raro), también recompute al anterior
    IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
        PERFORM public.recompute_compliance_hold(OLD.user_id);
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS document_requests_hold_trigger ON public.document_requests;
CREATE TRIGGER document_requests_hold_trigger
    AFTER INSERT OR UPDATE OF status, user_id OR DELETE
    ON public.document_requests
    FOR EACH ROW EXECUTE FUNCTION public.tg_document_requests_recompute_hold();

-- 5) RPC público: get_my_compliance_status
--    La app móvil lo llama después del login para decidir si bloquear UI
--    de send/load. Devuelve el estado de hold + las solicitudes activas
--    para mostrarle al usuario qué tiene que hacer.
CREATE OR REPLACE FUNCTION public.get_my_compliance_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid  uuid := auth.uid();
    v_hold boolean;
    v_docs jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('error', 'not authenticated');
    END IF;

    SELECT compliance_hold INTO v_hold
    FROM public.users WHERE id = v_uid;

    SELECT COALESCE(
        jsonb_agg(jsonb_build_object(
            'id',          d.id,
            'doc_type',    d.category,
            'title',       d.title,
            'description', d.description,
            'deadline',    d.due_date,
            'status',      d.status,
            'created_at',  d.requested_at,
            'attachments', d.attachments,
            'user_response_url', d.user_response_url
        ) ORDER BY d.requested_at DESC),
        '[]'::jsonb
    ) INTO v_docs
    FROM public.document_requests d
    WHERE d.user_id = v_uid
      AND d.status IN ('pending', 'submitted', 'escalated');

    RETURN jsonb_build_object(
        'compliance_hold',    COALESCE(v_hold, false),
        'pending_documents',  v_docs
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_compliance_status() TO authenticated;

-- 6) Helper para chequear hold del user actual desde RLS policies
CREATE OR REPLACE FUNCTION public.is_user_on_compliance_hold()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(compliance_hold, false)
    FROM public.users
    WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.is_user_on_compliance_hold() TO authenticated;

-- 7) RLS RESTRICTIVE en transactions: bloquea INSERT de kind='send' o 'load'
--    cuando el user está en compliance_hold. Convert sigue permitido.
--    OJO: esta policy es RESTRICTIVE, se aplica además de las existentes —
--    NO reemplaza la lógica de permisos normal, solo agrega el bloqueo.

DROP POLICY IF EXISTS tx_block_send_load_on_compliance_hold ON public.transactions;
CREATE POLICY tx_block_send_load_on_compliance_hold ON public.transactions
    AS RESTRICTIVE
    FOR INSERT TO authenticated
    WITH CHECK (
        NOT public.is_user_on_compliance_hold()
        OR COALESCE(kind, '') NOT IN ('send', 'load')
    );

COMMENT ON POLICY tx_block_send_load_on_compliance_hold ON public.transactions IS
    'Si el user está en compliance_hold, solo puede insertar TX de tipo convert (o cualquier otro != send/load).';

-- 8) Backfill: recompute para todos los users que tienen al menos una solicitud
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT DISTINCT user_id FROM public.document_requests
    LOOP
        PERFORM public.recompute_compliance_hold(r.user_id);
    END LOOP;
END $$;

-- 9) Verificación: cuántos users quedaron en hold
SELECT
    COUNT(*) FILTER (WHERE compliance_hold)        AS users_en_hold,
    COUNT(*)                                       AS users_totales
FROM public.users;
