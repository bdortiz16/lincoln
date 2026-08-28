-- ───────────────────────────────────────────────────────
-- 2026_limit_increase_beneficiary.sql
--
-- Aumentos de topes POR BENEFICIARIO (contacto de la libreta).
-- Antes toda solicitud de limit_increase_requests aplicaba los topes
-- al usuario dueño; ahora, si la fila trae beneficiary_id, el trigger
-- de aprobación aplica los topes al CONTACTO (tabla beneficiaries) y
-- deja al usuario intacto.
--
-- RPC request_limit_increase: recreado en base a la definición REAL
-- deployada (inspeccionada con pg_get_functiondef el 2026-07-13):
--   request_limit_increase(p_user_response text, p_attachments jsonb)
--   RETURNS json — chequeo de pendiente + INSERT (user_id, user_response,
--   attachments, status) + json {ok, request_id}.
-- La v2 de abajo conserva esa firma y el contrato de retorno, y agrega
-- parámetros OPCIONALES: p_requested_amount, p_beneficiary_id,
-- p_requested_daily_amount. Las llamadas viejas de iOS siguen funcionando.
-- ───────────────────────────────────────────────────────

-- ═══ 1. Columnas nuevas en la tabla del móvil ═══
ALTER TABLE public.limit_increase_requests
    ADD COLUMN IF NOT EXISTS beneficiary_id uuid REFERENCES public.beneficiaries(id) ON DELETE SET NULL;

-- Tope DIARIO pedido explícitamente por el usuario desde iOS (la app
-- valida que no exceda el 10% del mensual). text para matchear el tipo
-- de requested_amount que ya usa esta tabla; el trigger castea.
ALTER TABLE public.limit_increase_requests
    ADD COLUMN IF NOT EXISTS requested_daily_amount text;

CREATE INDEX IF NOT EXISTS lir_beneficiary_idx
    ON public.limit_increase_requests (beneficiary_id)
    WHERE beneficiary_id IS NOT NULL;

-- ═══ 2. Topes custom en beneficiaries (por si faltan en este entorno) ═══
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS custom_daily_limit   numeric;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS custom_monthly_limit numeric;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS limits_currency      text;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS is_custom_daily      boolean DEFAULT false;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS is_custom_monthly    boolean DEFAULT false;

-- ═══ 3. Trigger de aprobación v5: rama beneficiario vs usuario ═══
-- v5: si la solicitud trae requested_daily_amount (nueva caja de texto de
-- iOS, validada allá a ≤10% del mensual), se aplica ESE valor como tope
-- diario. Si no viene (solicitudes viejas), fallback a la heurística del
-- 20% del mensual. Cap defensivo: el diario nunca supera el mensual.
CREATE OR REPLACE FUNCTION public.apply_limit_increase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_amount numeric;
    v_daily  numeric;
    v_ben    uuid;
BEGIN
    IF NEW.status = 'approved'
       AND COALESCE(OLD.status, '') IS DISTINCT FROM 'approved' THEN

        -- requested_amount / requested_daily_amount son TEXT → cast defensivo
        BEGIN
            v_amount := NULLIF(trim(NEW.requested_amount::text), '')::numeric;
        EXCEPTION WHEN OTHERS THEN
            v_amount := NULL;
        END;

        BEGIN
            v_daily := NULLIF(trim(NEW.requested_daily_amount::text), '')::numeric;
        EXCEPTION WHEN OTHERS THEN
            v_daily := NULL;
        END;
        IF v_daily IS NOT NULL AND v_daily <= 0 THEN v_daily := NULL; END IF;

        BEGIN
            v_ben := (NEW.beneficiary_id::text)::uuid;
        EXCEPTION WHEN OTHERS THEN
            v_ben := NULL;
        END;

        IF v_amount IS NOT NULL AND v_amount > 0 THEN
            -- Diario pedido explícito (cap: nunca mayor al mensual);
            -- fallback 20% del mensual para solicitudes sin el dato nuevo.
            v_daily := COALESCE(LEAST(v_daily, v_amount), ROUND(v_amount * 0.2));

            IF v_ben IS NOT NULL THEN
                -- Solicitud desde la libreta de contactos → topes del CONTACTO
                UPDATE public.beneficiaries
                SET custom_monthly_limit = v_amount,
                    custom_daily_limit   = v_daily,
                    limits_currency   = COALESCE(limits_currency, 'USD'),
                    is_custom_monthly = true,
                    is_custom_daily   = true
                WHERE id = v_ben;
            ELSE
                -- Solicitud global → topes del USUARIO
                UPDATE public.users
                SET custom_monthly_limit = v_amount,
                    custom_daily_limit   = v_daily,
                    limits_currency   = COALESCE(limits_currency, 'USD'),
                    is_custom_monthly = true,
                    is_custom_daily   = true
                WHERE id = (NEW.user_id::text)::uuid;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- Evitar DOBLE aplicación: si Antigravity dejó su propio trigger de
-- aprobación con otro nombre, lo soltamos — apply_limit_increase queda
-- como el único que aplica topes.
DROP TRIGGER IF EXISTS handle_limit_increase_approval ON public.limit_increase_requests;
DROP TRIGGER IF EXISTS trg_handle_limit_increase_approval ON public.limit_increase_requests;
DROP TRIGGER IF EXISTS on_limit_increase_approval ON public.limit_increase_requests;

DROP TRIGGER IF EXISTS trg_apply_limit_increase ON public.limit_increase_requests;
CREATE TRIGGER trg_apply_limit_increase
    AFTER UPDATE OF status ON public.limit_increase_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.apply_limit_increase();

-- ═══ 4. RPC request_limit_increase v2 ═══
-- Mismo nombre/orden/tipos de los 2 params originales + retorno json →
-- las llamadas actuales de iOS (p_user_response, p_attachments) siguen
-- resolviendo. Los params nuevos son opcionales. Soltamos overloads
-- previos para que PostgREST no se confunda con funciones ambiguas.
DROP FUNCTION IF EXISTS public.request_limit_increase(text, jsonb);
DROP FUNCTION IF EXISTS public.request_limit_increase(text, jsonb, text);
DROP FUNCTION IF EXISTS public.request_limit_increase(text, jsonb, numeric);
DROP FUNCTION IF EXISTS public.request_limit_increase(text, jsonb, text, uuid);
DROP FUNCTION IF EXISTS public.request_limit_increase(text, jsonb, text, uuid, text);

CREATE FUNCTION public.request_limit_increase(
    p_user_response          text,
    p_attachments            jsonb DEFAULT '[]'::jsonb,
    p_requested_amount       text  DEFAULT NULL,
    p_beneficiary_id         uuid  DEFAULT NULL,
    p_requested_daily_amount text  DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_pending_count int;
    v_request_id uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'not_authenticated', 'message', 'Debes iniciar sesión.');
    END IF;

    -- Si es para un contacto, validar que sea del usuario
    IF p_beneficiary_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.beneficiaries
        WHERE id = p_beneficiary_id AND owner_user_id = v_uid
    ) THEN
        RETURN json_build_object('ok', false, 'error', 'beneficiary_not_found', 'message', 'Ese contacto no existe o no es tuyo.');
    END IF;

    -- Una pendiente por ÁMBITO: global aparte, y cada contacto aparte
    -- (puedes tener una global pendiente y otra para un contacto).
    SELECT COUNT(*) INTO v_pending_count
      FROM public.limit_increase_requests
     WHERE user_id = v_uid
       AND status = 'pending'
       AND beneficiary_id IS NOT DISTINCT FROM p_beneficiary_id;

    IF v_pending_count > 0 THEN
        RETURN json_build_object('ok', false, 'error', 'already_pending', 'message', 'Ya tienes una solicitud de ampliación en revisión.');
    END IF;

    INSERT INTO public.limit_increase_requests
        (user_id, user_response, attachments, status,
         requested_amount, beneficiary_id, requested_daily_amount)
    VALUES
        (v_uid, p_user_response, p_attachments, 'pending',
         NULLIF(trim(coalesce(p_requested_amount, '')), ''),
         p_beneficiary_id,
         NULLIF(trim(coalesce(p_requested_daily_amount, '')), ''))
    RETURNING id INTO v_request_id;

    RETURN json_build_object('ok', true, 'request_id', v_request_id);
END;
$$;

REVOKE ALL ON FUNCTION public.request_limit_increase(text, jsonb, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_limit_increase(text, jsonb, text, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
