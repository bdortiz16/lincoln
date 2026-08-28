-- ───────────────────────────────────────────────────────
-- 2026_to_currency_use_snapshots.sql
--
-- Fix del fix: public.to_currency() leía de public.fx_rates (la
-- tabla de seed inicial, donde COP/USD vale 4000 hardcodeado y
-- nunca cambia). La TRM REAL vive en public.fx_rate_snapshots,
-- alimentada cada hora por la edge function fx-snapshot desde
-- Fawaz Currency API.
--
-- Esta migración reescribe to_currency para que:
--   1) Primero busque la snapshot MÁS RECIENTE de fx_rate_snapshots
--      (donde están las TRM reales del día).
--   2) Si no hay snapshot del par, intenta el par inverso.
--   3) Si tampoco, cae a public.fx_rates (legacy seed).
--   4) Como último recurso, constantes hardcoded para que el
--      sistema no se rompa si Fawaz cayó.
-- ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.to_currency(
    p_amount     numeric,
    p_from       text,
    p_to         text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_rate    numeric;
    v_inv     numeric;
    v_amt_usd numeric;
BEGIN
    IF p_amount IS NULL OR p_amount = 0 THEN RETURN 0; END IF;
    IF p_from IS NULL OR p_to IS NULL THEN RETURN p_amount; END IF;
    IF UPPER(p_from) = UPPER(p_to) THEN RETURN p_amount; END IF;

    -- 1) snapshot más reciente del par directo
    BEGIN
        SELECT rate INTO v_rate
        FROM public.fx_rate_snapshots
        WHERE UPPER(from_currency) = UPPER(p_from)
          AND UPPER(to_currency)   = UPPER(p_to)
        ORDER BY captured_at DESC
        LIMIT 1;
        IF v_rate IS NOT NULL AND v_rate > 0 THEN
            RETURN p_amount * v_rate;
        END IF;

        -- 2) snapshot inversa
        SELECT rate INTO v_inv
        FROM public.fx_rate_snapshots
        WHERE UPPER(from_currency) = UPPER(p_to)
          AND UPPER(to_currency)   = UPPER(p_from)
        ORDER BY captured_at DESC
        LIMIT 1;
        IF v_inv IS NOT NULL AND v_inv > 0 THEN
            RETURN p_amount / v_inv;
        END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- 3) fx_rates legacy (seed) por si el snapshot está vacío
    BEGIN
        SELECT rate INTO v_rate
        FROM public.fx_rates
        WHERE UPPER(from_currency) = UPPER(p_from)
          AND UPPER(to_currency)   = UPPER(p_to)
          AND is_active = true
        ORDER BY effective_from DESC NULLS LAST
        LIMIT 1;
        IF v_rate IS NOT NULL AND v_rate > 0 THEN
            RETURN p_amount * v_rate;
        END IF;

        SELECT rate INTO v_inv
        FROM public.fx_rates
        WHERE UPPER(from_currency) = UPPER(p_to)
          AND UPPER(to_currency)   = UPPER(p_from)
          AND is_active = true
        ORDER BY effective_from DESC NULLS LAST
        LIMIT 1;
        IF v_inv IS NOT NULL AND v_inv > 0 THEN
            RETURN p_amount / v_inv;
        END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- 4) Último recurso: constantes hardcoded vía pivote USD.
    --    Estas no se usan si Fawaz está vivo (cron cada hora popula
    --    fx_rate_snapshots y se gana por el paso 1).
    v_amt_usd := p_amount * CASE UPPER(p_from)
        WHEN 'USD' THEN 1.0
        WHEN 'COP' THEN 1.0 / 4000.0
        WHEN 'CLP' THEN 1.0 / 950.0
        WHEN 'PEN' THEN 1.0 / 3.7
        WHEN 'MXN' THEN 1.0 / 17.0
        WHEN 'BRL' THEN 1.0 / 5.5
        WHEN 'VES' THEN 1.0 / 36.0
        WHEN 'EUR' THEN 1.08
        ELSE 1.0
    END;

    RETURN v_amt_usd * CASE UPPER(p_to)
        WHEN 'USD' THEN 1.0
        WHEN 'COP' THEN 4000.0
        WHEN 'CLP' THEN 950.0
        WHEN 'PEN' THEN 3.7
        WHEN 'MXN' THEN 17.0
        WHEN 'BRL' THEN 5.5
        WHEN 'VES' THEN 36.0
        WHEN 'EUR' THEN 1.0 / 1.08
        ELSE 1.0
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.to_currency(numeric, text, text) TO anon, authenticated;
