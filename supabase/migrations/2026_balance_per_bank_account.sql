-- ════════════════════════════════════════════════════════
-- Balance por cuenta bancaria
--
-- El user quiere ver: "el saldo por banco — si hay varios bancos en
-- Colombia, mostrarme el saldo de cada banco e ingresos a cada banco".
--
-- Estrategia:
--   1. Agregar columna `bank_account_id` a transactions (la app móvil
--      la llena cuando el usuario elige a qué cuenta deposita)
--   2. Vista bank_account_balances que:
--      • Si transactions.bank_account_id está seteado → match exacto
--      • Si NO está seteado, fallback por bank_name (case-insensitive)
--        comparando raw_data->>'bank_name' o raw_data->>'bank' contra
--        cuypay_bank_accounts.bank_name del mismo país/moneda
-- ════════════════════════════════════════════════════════

-- ───── 1. Columna opcional en transactions ─────
ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS bank_account_id UUID
    REFERENCES public.cuypay_bank_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_bank_account
    ON public.transactions(bank_account_id) WHERE bank_account_id IS NOT NULL;

COMMENT ON COLUMN public.transactions.bank_account_id IS
    'Cuenta bancaria de CuyPay a la que el usuario depositó (load) o desde la que se le pagó (send). Si es NULL, se intenta inferir desde raw_data.bank_name.';

-- ───── 2. Mapa de país → moneda (helper) ─────
-- (idempotente)
CREATE OR REPLACE FUNCTION public.country_to_currency(p_country TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE upper(coalesce(p_country, ''))
        WHEN 'CO' THEN 'COP'
        WHEN 'CL' THEN 'CLP'
        WHEN 'PE' THEN 'PEN'
        WHEN 'MX' THEN 'MXN'
        WHEN 'BR' THEN 'BRL'
        ELSE NULL
    END;
$$;

-- ───── 3. Vista: balance por cuenta bancaria ─────
CREATE OR REPLACE VIEW public.bank_account_balances AS
WITH matched_tx AS (
    SELECT
        ba.id AS bank_account_id,
        ba.country_code,
        ba.bank_name,
        ba.account_number,
        ba.holder,
        ba.is_active,
        public.country_to_currency(ba.country_code) AS currency,
        t.id AS tx_id,
        t.kind,
        t.status,
        COALESCE(t.amount, 0) AS amount
    FROM public.cuypay_bank_accounts ba
    LEFT JOIN public.transactions t ON (
        -- Match 1 (preferido): la TX apunta directo a esta cuenta
        t.bank_account_id = ba.id
        OR
        -- Match 2 (fallback): TX sin bank_account_id pero raw_data tiene el banco
        -- y la moneda corresponde al país de la cuenta
        (
            t.bank_account_id IS NULL
            AND t.currency = public.country_to_currency(ba.country_code)
            AND (
                LOWER(COALESCE(t.raw_data->>'bank_name', '')) = LOWER(ba.bank_name)
                OR LOWER(COALESCE(t.raw_data->>'bank', '')) = LOWER(ba.bank_name)
            )
        )
    )
)
SELECT
    bank_account_id,
    country_code,
    bank_name,
    account_number,
    holder,
    is_active,
    currency,
    -- Saldo confirmado = loads completados - sends completados
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
    COUNT(tx_id) FILTER (
        WHERE lower(COALESCE(status,'')) IN ('pending','pendiente')
    ) AS pending_count,

    COUNT(tx_id) FILTER (
        WHERE lower(COALESCE(status,'')) IN ('completed','approved','aprobada','completado','aprobado')
    ) AS completed_count
FROM matched_tx
GROUP BY bank_account_id, country_code, bank_name, account_number, holder, is_active, currency;

GRANT SELECT ON public.bank_account_balances TO authenticated;

-- ───── 4. Verificar ─────
SELECT bank_name, currency, confirmed_balance, pending_in, pending_out, pending_count
FROM public.bank_account_balances
ORDER BY country_code, bank_name;

NOTIFY pgrst, 'reload schema';
