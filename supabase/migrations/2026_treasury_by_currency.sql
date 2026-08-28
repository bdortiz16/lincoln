-- ════════════════════════════════════════════════════════
-- Tesorería delegada por moneda
--
-- Cada admin de tesorería puede tener asignada UNA moneda
-- principal (COP, CLP, PEN, MXN, BRL). Solo verá las cuentas,
-- transacciones y pares FX que tocan esa moneda.
--
-- assigned_currency = NULL → ve todas (rol "treasury global"
-- como antes, o super_admin)
-- ════════════════════════════════════════════════════════

-- ───── 1. Columna en users ─────
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS assigned_currency TEXT
        CHECK (assigned_currency IS NULL OR assigned_currency IN ('COP','CLP','PEN','MXN','BRL'));

COMMENT ON COLUMN public.users.assigned_currency IS
    'Moneda asignada al admin de tesorería. NULL = ve todas (super_admin o treasury global). Valor = solo ve TX/cuentas/pares de esa moneda.';

-- ───── 2. Vista: balance calculado por moneda ─────
-- Suma los loads aprobados/completed (entradas) y resta los sends aprobados/completed
-- (salidas). Hace lo mismo para los pendientes.
-- NOTA: usamos la columna `amount` y `currency` del esquema CuyPayANDROID.
-- Si la app guarda algo distinto (ej. from_currency), ajustar el COALESCE.
CREATE OR REPLACE VIEW public.currency_balances AS
WITH tx AS (
    SELECT
        COALESCE(currency, 'UNKNOWN') AS currency,
        kind,
        status,
        COALESCE(amount, 0) AS amount
    FROM public.transactions
    WHERE COALESCE(currency, '') <> ''
)
SELECT
    currency,
    -- Saldo confirmado (loads completados - sends completados)
    COALESCE(SUM(amount) FILTER (
        WHERE kind = 'load'
          AND lower(COALESCE(status,'')) IN ('completed','approved','aprobada','completado','aprobado')
    ), 0) -
    COALESCE(SUM(amount) FILTER (
        WHERE kind = 'send'
          AND lower(COALESCE(status,'')) IN ('completed','approved','aprobada','completado','aprobado')
    ), 0) AS confirmed_balance,

    -- Loads pendientes (van a entrar)
    COALESCE(SUM(amount) FILTER (
        WHERE kind = 'load'
          AND lower(COALESCE(status,'')) IN ('pending','pendiente')
    ), 0) AS pending_in,

    -- Sends pendientes (van a salir)
    COALESCE(SUM(amount) FILTER (
        WHERE kind = 'send'
          AND lower(COALESCE(status,'')) IN ('pending','pendiente')
    ), 0) AS pending_out,

    -- Conteos
    COUNT(*) FILTER (
        WHERE lower(COALESCE(status,'')) IN ('pending','pendiente')
    ) AS pending_count,

    COUNT(*) AS total_tx
FROM tx
GROUP BY currency;

GRANT SELECT ON public.currency_balances TO authenticated;

-- ───── 3. Función helper: el caller ¿tiene acceso a esta moneda? ─────
CREATE OR REPLACE FUNCTION public.user_can_see_currency(p_currency TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    u RECORD;
BEGIN
    SELECT admin_role, assigned_currency INTO u
    FROM public.users WHERE id = auth.uid();
    IF NOT FOUND THEN RETURN false; END IF;

    -- super_admin ve todo
    IF u.admin_role = 'super_admin' THEN RETURN true; END IF;

    -- audit/compliance ven todo (solo lectura general)
    IF u.admin_role IN ('audit','compliance') THEN RETURN true; END IF;

    -- treasury sin moneda asignada = treasury global
    IF u.admin_role = 'treasury' AND u.assigned_currency IS NULL THEN RETURN true; END IF;

    -- treasury con moneda asignada = solo su moneda
    IF u.admin_role = 'treasury' AND u.assigned_currency = p_currency THEN RETURN true; END IF;

    RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_can_see_currency(TEXT) TO authenticated;

-- ───── 4. Verificación ─────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'assigned_currency';

SELECT * FROM public.currency_balances ORDER BY currency;

-- Recargar schema cache de PostgREST
NOTIFY pgrst, 'reload schema';
