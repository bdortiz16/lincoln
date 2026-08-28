-- ════════════════════════════════════════════════════════
-- TESORERÍA CONTABLE — cuentas internas + libro de movimientos
--
-- Modela la tesorería real de CuyPay como un libro contable:
--   • treasury_accounts: cada "bolsa" de dinero (cuentas bancarias por
--     país + wallets USDT por exchange). Cada una tiene su saldo.
--   • treasury_movements: el LIBRO. Cada movimiento debita una cuenta y
--     acredita otra (doble entrada), con tasa, comisión e impuesto.
--   • treasury_apply_movement(): función atómica que inserta el movimiento
--     y actualiza los saldos en una sola transacción.
--
-- Flujo FX en 2 pasos (BRL → COP vía USDT):
--   1. fx_buy_usdt:  cuenta BRL  → wallet USDT   (gastás BRL, recibís USDT)
--   2. fx_sell_usdt: wallet USDT → cuenta COP    (gastás USDT, recibís COP)
--   Podés dejar fondos parados en USDT entre los dos pasos.
-- ════════════════════════════════════════════════════════

-- ───── 1. Cuentas de tesorería ─────
CREATE TABLE IF NOT EXISTS public.treasury_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,                 -- "Bancolombia COP", "USDT Binance"
    type            TEXT NOT NULL CHECK (type IN ('bank','crypto')),
    currency        TEXT NOT NULL,                 -- COP, BRL, CLP, PEN, MXN, USDT
    country_code    TEXT,                          -- CO, BR... (null para crypto)
    exchange        TEXT,                          -- Binance, Bitso... (para crypto)
    bank_account_id UUID REFERENCES public.cuypay_bank_accounts(id) ON DELETE SET NULL,
    balance         NUMERIC(20,2) NOT NULL DEFAULT 0,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.treasury_accounts ENABLE ROW LEVEL SECURITY;

-- ───── 2. Libro de movimientos ─────
CREATE TABLE IF NOT EXISTS public.treasury_movements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind            TEXT NOT NULL CHECK (kind IN (
                        'internal_transfer',  -- mismo país/moneda (Bancolombia → Davivienda)
                        'fx_buy_usdt',        -- moneda local → USDT
                        'fx_sell_usdt',       -- USDT → moneda local
                        'client_load',        -- ingreso por cargue de cliente
                        'client_payout',      -- egreso por pago a cliente
                        'adjustment'          -- ajuste manual / corrección
                    )),
    from_account_id UUID REFERENCES public.treasury_accounts(id),
    to_account_id   UUID REFERENCES public.treasury_accounts(id),
    from_amount     NUMERIC(20,2) NOT NULL DEFAULT 0,  -- lo que SALE de from (incluye fee/tax si se descuentan al origen)
    to_amount       NUMERIC(20,2) NOT NULL DEFAULT 0,  -- lo que ENTRA a to (neto)
    from_currency   TEXT,
    to_currency     TEXT,
    exchange_rate   NUMERIC(20,8),                     -- to_amount / from_amount (para FX)
    fee_amount      NUMERIC(20,2) DEFAULT 0,
    fee_currency    TEXT,
    tax_amount      NUMERIC(20,2) DEFAULT 0,
    tax_currency    TEXT,
    notes           TEXT,
    created_by      UUID REFERENCES public.users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_treasury_mov_from ON public.treasury_movements(from_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_treasury_mov_to   ON public.treasury_movements(to_account_id, created_at DESC);
ALTER TABLE public.treasury_movements ENABLE ROW LEVEL SECURITY;

-- ───── 3. Función atómica: registrar movimiento + actualizar saldos ─────
CREATE OR REPLACE FUNCTION public.treasury_apply_movement(
    p_kind          TEXT,
    p_from_account  UUID,
    p_to_account    UUID,
    p_from_amount   NUMERIC,
    p_to_amount     NUMERIC,
    p_exchange_rate NUMERIC DEFAULT NULL,
    p_fee_amount    NUMERIC DEFAULT 0,
    p_fee_currency  TEXT DEFAULT NULL,
    p_tax_amount    NUMERIC DEFAULT 0,
    p_tax_currency  TEXT DEFAULT NULL,
    p_notes         TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_from     RECORD;
    v_to       RECORD;
    v_mov_id   UUID;
    v_caller   UUID := auth.uid();
    v_is_admin BOOLEAN;
BEGIN
    -- Solo super_admin / treasury pueden mover plata de tesorería
    SELECT (admin_role IN ('super_admin','treasury')) INTO v_is_admin
    FROM public.users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
        RAISE EXCEPTION 'No autorizado: solo super_admin o treasury pueden registrar movimientos';
    END IF;

    -- Validar cuentas
    IF p_from_account IS NOT NULL THEN
        SELECT * INTO v_from FROM public.treasury_accounts WHERE id = p_from_account FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta origen no existe'; END IF;
    END IF;
    IF p_to_account IS NOT NULL THEN
        SELECT * INTO v_to FROM public.treasury_accounts WHERE id = p_to_account FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta destino no existe'; END IF;
    END IF;

    -- Insertar movimiento
    INSERT INTO public.treasury_movements (
        kind, from_account_id, to_account_id, from_amount, to_amount,
        from_currency, to_currency, exchange_rate,
        fee_amount, fee_currency, tax_amount, tax_currency, notes, created_by
    ) VALUES (
        p_kind, p_from_account, p_to_account, COALESCE(p_from_amount,0), COALESCE(p_to_amount,0),
        v_from.currency, v_to.currency, p_exchange_rate,
        COALESCE(p_fee_amount,0), p_fee_currency, COALESCE(p_tax_amount,0), p_tax_currency, p_notes, v_caller
    ) RETURNING id INTO v_mov_id;

    -- Actualizar saldos
    IF p_from_account IS NOT NULL THEN
        UPDATE public.treasury_accounts
        SET balance = balance - COALESCE(p_from_amount,0), updated_at = NOW()
        WHERE id = p_from_account;
    END IF;
    IF p_to_account IS NOT NULL THEN
        UPDATE public.treasury_accounts
        SET balance = balance + COALESCE(p_to_amount,0), updated_at = NOW()
        WHERE id = p_to_account;
    END IF;

    RETURN v_mov_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.treasury_apply_movement TO authenticated;

-- ───── 4. RLS ─────
DROP POLICY IF EXISTS "treasury_accounts_read" ON public.treasury_accounts;
CREATE POLICY "treasury_accounts_read" ON public.treasury_accounts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL));

DROP POLICY IF EXISTS "treasury_accounts_write" ON public.treasury_accounts;
CREATE POLICY "treasury_accounts_write" ON public.treasury_accounts
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')));

DROP POLICY IF EXISTS "treasury_movements_read" ON public.treasury_movements;
CREATE POLICY "treasury_movements_read" ON public.treasury_movements
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL));
-- Los inserts van por la función treasury_apply_movement (SECURITY DEFINER)

-- ───── 5. Seed: crear cuentas de tesorería desde los bancos configurados ─────
INSERT INTO public.treasury_accounts (name, type, currency, country_code, bank_account_id)
SELECT
    ba.bank_name || ' ' || public.country_to_currency(ba.country_code),
    'bank',
    public.country_to_currency(ba.country_code),
    ba.country_code,
    ba.id
FROM public.cuypay_bank_accounts ba
WHERE NOT EXISTS (
    SELECT 1 FROM public.treasury_accounts ta WHERE ta.bank_account_id = ba.id
);

-- Wallets USDT por exchange (las que uses)
INSERT INTO public.treasury_accounts (name, type, currency, exchange) VALUES
    ('USDT Binance', 'crypto', 'USDT', 'Binance'),
    ('USDT Bitso',   'crypto', 'USDT', 'Bitso')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ───── 6. Verificar ─────
SELECT name, type, currency, country_code, exchange, balance FROM public.treasury_accounts ORDER BY type, currency;
