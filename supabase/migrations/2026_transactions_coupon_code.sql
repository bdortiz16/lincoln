-- ───────────────────────────────────────────────────────
-- 2026_transactions_coupon_code.sql
--
-- Persiste el cupón aplicado en cada transacción de tipo convert
-- (también funciona para send/load si en el futuro se aceptan).
--
-- Por qué dos columnas y no solo el código:
--   • coupon_code: lo que el cliente escribió/aplicó. Sirve para
--     mostrar "Cupón aplicado: WELCOME20" en el detalle de la TX
--     y para auditar qué campañas convirtieron.
--   • coupon_discount_pct: snapshot del % que estaba activo AL
--     MOMENTO de la transacción. Si después el admin cambia el %
--     o desactiva el cupón, la TX vieja sigue mostrando el valor
--     real que le aplicaron al cliente (no el actual).
--
-- Ambas son NULLABLE — TXs sin cupón siguen funcionando igual.
--
-- Cómo lo persiste la app:
--   La app móvil llama al RPC create_convert_transaction(... p_coupon_code text).
--   Ese RPC (que vive en el repo de Antigravity) tiene que extraer
--   el % del cupón desde public.app_settings.value->'coupons' (donde
--   el admin lo edita desde el panel) y guardar AMBOS valores en la fila.
-- ───────────────────────────────────────────────────────

ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS coupon_code         text,
    ADD COLUMN IF NOT EXISTS coupon_discount_pct numeric;

CREATE INDEX IF NOT EXISTS transactions_coupon_code_idx
    ON public.transactions(coupon_code)
    WHERE coupon_code IS NOT NULL;

COMMENT ON COLUMN public.transactions.coupon_code IS
    'Código del cupón aplicado por el cliente al crear la TX (NULL si no usó cupón).';
COMMENT ON COLUMN public.transactions.coupon_discount_pct IS
    'Snapshot del % de descuento que el cupón otorgaba AL MOMENTO de la TX.';

-- ─────────────────────────────────────────────
-- Helper que cualquiera puede usar para resolver un cupón al
-- momento de aplicarlo. Devuelve el % de descuento si el cupón
-- está activo, o NULL si no existe / está inactivo / vencido.
--
-- El RPC create_convert_transaction de Antigravity debería llamar
-- a esta función para resolver el % a guardar en coupon_discount_pct.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_coupon_discount(p_code text)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_coupons jsonb;
    v_match   jsonb;
    v_pct     numeric;
    v_exp     timestamptz;
    v_active  boolean;
BEGIN
    IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
        RETURN NULL;
    END IF;

    -- app_settings es key/value singleton: probamos value, después config,
    -- y por último columnas planas. Eso cubre las 3 shapes históricas.
    SELECT COALESCE(
               (SELECT value->'coupons'  FROM public.app_settings LIMIT 1),
               (SELECT config->'coupons' FROM public.app_settings LIMIT 1)
           )
    INTO v_coupons;

    IF v_coupons IS NULL OR jsonb_typeof(v_coupons) <> 'array' THEN
        RETURN NULL;
    END IF;

    -- Buscamos el primero que matchee code (case-insensitive)
    SELECT elem INTO v_match
    FROM jsonb_array_elements(v_coupons) AS elem
    WHERE upper(elem->>'code') = upper(trim(p_code))
    LIMIT 1;

    IF v_match IS NULL THEN
        RETURN NULL;
    END IF;

    v_active := COALESCE((v_match->>'active')::boolean, false);
    IF NOT v_active THEN
        RETURN NULL;
    END IF;

    -- Si tiene fecha de vencimiento, chequear que no esté vencido
    IF v_match ? 'expires_at' AND v_match->>'expires_at' IS NOT NULL THEN
        v_exp := (v_match->>'expires_at')::timestamptz;
        IF v_exp < now() THEN RETURN NULL; END IF;
    END IF;

    v_pct := (v_match->>'discount')::numeric;
    IF v_pct IS NULL OR v_pct <= 0 THEN
        RETURN NULL;
    END IF;

    RETURN v_pct;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_coupon_discount(text) TO authenticated;

-- ─────────────────────────────────────────────
-- Verificación
-- ─────────────────────────────────────────────
SELECT
    column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'transactions'
  AND column_name IN ('coupon_code', 'coupon_discount_pct');
