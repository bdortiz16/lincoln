-- ───────────────────────────────────────────────────────
-- 2026_limit_increase_apply_trigger.sql
--
-- Al aprobar una solicitud en limit_increase_requests, aplicar el
-- requested_amount a los TOPES REALES del usuario (users.custom_
-- monthly_limit) — sin esto la aprobación era solo visual y las
-- transacciones seguían evaluando el tope viejo.
--
-- Política aplicada:
--   custom_monthly_limit = requested_amount
--   custom_daily_limit   = max(actual, 20% del mensual solicitado)
--     (heurística razonable; el admin puede afinar con el editor
--      de topes "Aprobar y ajustar topes")
--   limits_currency      = 'USD' si estaba vacía
--   is_custom_monthly    = true   ← las apps leen estos flags para saber
--   is_custom_daily      = true     que el usuario tiene topes justificados
--
-- Solo dispara en la transición → 'approved' (no re-aplica en
-- updates posteriores de notas etc.).
-- ───────────────────────────────────────────────────────

-- Flags que consumen iOS/Android (y exime de reglas AML generales)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_custom_daily   boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_custom_monthly boolean DEFAULT false;

-- v3: requested_amount es TEXT en la tabla del móvil → cast explícito a
-- numeric antes de comparar/multiplicar (error original: "operator does
-- not exist: text > integer"). user_id también se castea defensivamente.
CREATE OR REPLACE FUNCTION public.apply_limit_increase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_amount numeric;
BEGIN
    IF NEW.status = 'approved'
       AND COALESCE(OLD.status, '') IS DISTINCT FROM 'approved' THEN

        BEGIN
            v_amount := NULLIF(trim(NEW.requested_amount::text), '')::numeric;
        EXCEPTION WHEN OTHERS THEN
            v_amount := NULL; -- monto ilegible: no aplicar nada, pero no romper el Aprobar
        END;

        IF v_amount IS NOT NULL AND v_amount > 0 THEN
            UPDATE public.users
            SET custom_monthly_limit = v_amount,
                custom_daily_limit   = GREATEST(
                    COALESCE(custom_daily_limit, 0)::numeric,
                    ROUND(v_amount * 0.2)
                ),
                limits_currency   = COALESCE(limits_currency, 'USD'),
                is_custom_monthly = true,
                is_custom_daily   = true
            WHERE id = (NEW.user_id::text)::uuid;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_limit_increase ON public.limit_increase_requests;
CREATE TRIGGER trg_apply_limit_increase
    AFTER UPDATE OF status ON public.limit_increase_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.apply_limit_increase();
