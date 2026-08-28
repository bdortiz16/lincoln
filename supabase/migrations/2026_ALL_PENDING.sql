-- ════════════════════════════════════════════════════════════════════
-- CUYPAY · MIGRACIÓN TODO-EN-UNO (pendientes mayo 2026)
--
-- Pegá TODO este archivo en el SQL Editor de Supabase (proyecto
-- CuyPayANDROID) y dale RUN. Es idempotente: se puede correr varias
-- veces sin romper nada. Activa de una sola vez:
--   • Cuentas bancarias (CRUD desde el admin)
--   • Tesorería delegada por moneda + saldos por moneda y por banco
--   • FX (tasas, fees, ventana nocturna) legible por la app
--   • Referidos (app_settings.referral_rate)
--   • Bloqueo de usuarios por compliance
--   • RLS de transacciones para el admin
--   • Libro contable de tesorería (cuentas internas + movimientos + USDT)
-- ════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. CUENTAS BANCARIAS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cuypay_bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    country_code TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    account_type TEXT,
    account_number TEXT NOT NULL,
    holder TEXT,
    tax_id TEXT,
    tax_id_label TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.cuypay_bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone_select_active_bank_accounts" ON public.cuypay_bank_accounts;
CREATE POLICY "anyone_select_active_bank_accounts" ON public.cuypay_bank_accounts
  FOR SELECT TO authenticated USING (is_active = true);

DROP POLICY IF EXISTS "admin_select_all_bank_accounts" ON public.cuypay_bank_accounts;
CREATE POLICY "admin_select_all_bank_accounts" ON public.cuypay_bank_accounts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL));

DROP POLICY IF EXISTS "treasury_manage_bank_accounts" ON public.cuypay_bank_accounts;
CREATE POLICY "treasury_manage_bank_accounts" ON public.cuypay_bank_accounts
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')));

-- ─────────────────────────────────────────────
-- 2. COLUMNAS EN USERS (moneda asignada + bloqueo)
-- ─────────────────────────────────────────────
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS assigned_currency TEXT
        CHECK (assigned_currency IS NULL OR assigned_currency IN ('COP','CLP','PEN','MXN','BRL')),
    ADD COLUMN IF NOT EXISTS is_blocked     BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS blocked_reason TEXT,
    ADD COLUMN IF NOT EXISTS blocked_at     TIMESTAMPTZ;

-- ─────────────────────────────────────────────
-- 3. TRANSACTIONS: bank_account_id + RLS para admin
-- ─────────────────────────────────────────────
ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS bank_account_id UUID
    REFERENCES public.cuypay_bank_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_bank_account
    ON public.transactions(bank_account_id) WHERE bank_account_id IS NOT NULL;

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_select_all_transactions" ON public.transactions;
CREATE POLICY "admin_select_all_transactions" ON public.transactions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL));

DROP POLICY IF EXISTS "admin_update_transactions" ON public.transactions;
CREATE POLICY "admin_update_transactions" ON public.transactions
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')))
  WITH CHECK (true);

-- ─────────────────────────────────────────────
-- 4. HELPER país → moneda
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.country_to_currency(p_country TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE upper(coalesce(p_country, ''))
        WHEN 'CO' THEN 'COP' WHEN 'CL' THEN 'CLP' WHEN 'PE' THEN 'PEN'
        WHEN 'MX' THEN 'MXN' WHEN 'BR' THEN 'BRL' ELSE NULL END;
$$;

-- ─────────────────────────────────────────────
-- 5. FX: config global, por par, snapshots + RLS legible por app
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fx_global_config (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    night_enabled BOOLEAN DEFAULT false,
    night_start_hour INT DEFAULT 3, night_end_hour INT DEFAULT 8,
    night_extra_pct NUMERIC(6,3) DEFAULT 1.0,
    timezone TEXT DEFAULT 'America/Bogota',
    updated_by UUID REFERENCES public.users(id), updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO public.fx_global_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.fx_global_config ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.fx_pair_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency TEXT NOT NULL, to_currency TEXT NOT NULL,
    base_fee_pct NUMERIC(6,3) NOT NULL DEFAULT 0.5,
    tiers JSONB NOT NULL DEFAULT '[{"from_usd":0,"to_usd":1000,"pct":2.5},{"from_usd":1000,"to_usd":10000,"pct":2.0},{"from_usd":10000,"to_usd":100000,"pct":1.5},{"from_usd":100000,"to_usd":null,"pct":1.0}]',
    is_active BOOLEAN DEFAULT true,
    updated_by UUID REFERENCES public.users(id), updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(from_currency, to_currency)
);
ALTER TABLE public.fx_pair_config ADD COLUMN IF NOT EXISTS base_fee_pct NUMERIC(6,3) NOT NULL DEFAULT 0.5;
ALTER TABLE public.fx_pair_config ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.fx_rate_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency TEXT NOT NULL, to_currency TEXT NOT NULL,
    rate NUMERIC(18,8) NOT NULL, source TEXT DEFAULT 'fawaz', captured_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.fx_rate_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fx_global_read_authenticated" ON public.fx_global_config;
CREATE POLICY "fx_global_read_authenticated" ON public.fx_global_config FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "fx_global_write_treasury" ON public.fx_global_config;
CREATE POLICY "fx_global_write_treasury" ON public.fx_global_config FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')));

DROP POLICY IF EXISTS "fx_pair_read_authenticated" ON public.fx_pair_config;
CREATE POLICY "fx_pair_read_authenticated" ON public.fx_pair_config FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "fx_pair_write_treasury" ON public.fx_pair_config;
CREATE POLICY "fx_pair_write_treasury" ON public.fx_pair_config FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')));

DROP POLICY IF EXISTS "fx_snapshots_read_authenticated" ON public.fx_rate_snapshots;
CREATE POLICY "fx_snapshots_read_authenticated" ON public.fx_rate_snapshots FOR SELECT TO authenticated USING (true);

INSERT INTO public.fx_pair_config (from_currency, to_currency, base_fee_pct) VALUES
    ('COP','CLP',0.8),('COP','PEN',0.8),('COP','MXN',0.8),('COP','BRL',0.8),
    ('CLP','COP',0.8),('CLP','PEN',0.8),('CLP','MXN',0.8),('CLP','BRL',0.8),
    ('PEN','COP',0.8),('PEN','CLP',0.8),('PEN','MXN',0.8),('PEN','BRL',0.8),
    ('MXN','COP',0.8),('MXN','CLP',0.8),('MXN','PEN',0.8),('MXN','BRL',0.8),
    ('BRL','COP',0.8),('BRL','CLP',0.8),('BRL','PEN',0.8),('BRL','MXN',0.8)
ON CONFLICT (from_currency, to_currency) DO NOTHING;

-- ─────────────────────────────────────────────
-- 6. VISTAS DE BALANCE (por moneda y por banco)
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW public.currency_balances AS
WITH tx AS (SELECT COALESCE(currency,'UNKNOWN') AS currency, kind, status, COALESCE(amount,0) AS amount
            FROM public.transactions WHERE COALESCE(currency,'') <> '')
SELECT currency,
  COALESCE(SUM(amount) FILTER (WHERE kind='load'  AND lower(COALESCE(status,'')) IN ('completed','approved','aprobada','completado','aprobado')),0)
- COALESCE(SUM(amount) FILTER (WHERE kind='send'  AND lower(COALESCE(status,'')) IN ('completed','approved','aprobada','completado','aprobado')),0) AS confirmed_balance,
  COALESCE(SUM(amount) FILTER (WHERE kind='load'  AND lower(COALESCE(status,'')) IN ('pending','pendiente')),0) AS pending_in,
  COALESCE(SUM(amount) FILTER (WHERE kind='send'  AND lower(COALESCE(status,'')) IN ('pending','pendiente')),0) AS pending_out,
  COUNT(*) FILTER (WHERE lower(COALESCE(status,'')) IN ('pending','pendiente')) AS pending_count,
  COUNT(*) AS total_tx
FROM tx GROUP BY currency;
GRANT SELECT ON public.currency_balances TO authenticated;

-- Nota: el match es por bank_account_id (la app debe setearlo en cada TX).
-- No usamos raw_data porque la tabla transactions de CuyPayANDROID no tiene
-- esa columna. Hasta que la app guarde bank_account_id, el balance por banco
-- queda en 0 (el balance por moneda en currency_balances sí funciona).
CREATE OR REPLACE VIEW public.bank_account_balances AS
WITH matched_tx AS (
    SELECT ba.id AS bank_account_id, ba.country_code, ba.bank_name, ba.account_number, ba.holder, ba.is_active,
           public.country_to_currency(ba.country_code) AS currency,
           t.id AS tx_id, t.kind, t.status, COALESCE(t.amount,0) AS amount
    FROM public.cuypay_bank_accounts ba
    LEFT JOIN public.transactions t ON t.bank_account_id = ba.id
)
SELECT bank_account_id, country_code, bank_name, account_number, holder, is_active, currency,
  COALESCE(SUM(amount) FILTER (WHERE kind='load' AND lower(COALESCE(status,'')) IN ('completed','approved','aprobada','completado','aprobado')),0)
- COALESCE(SUM(amount) FILTER (WHERE kind='send' AND lower(COALESCE(status,'')) IN ('completed','approved','aprobada','completado','aprobado')),0) AS confirmed_balance,
  COALESCE(SUM(amount) FILTER (WHERE kind='load' AND lower(COALESCE(status,'')) IN ('pending','pendiente')),0) AS pending_in,
  COALESCE(SUM(amount) FILTER (WHERE kind='send' AND lower(COALESCE(status,'')) IN ('pending','pendiente')),0) AS pending_out,
  COUNT(tx_id) FILTER (WHERE lower(COALESCE(status,'')) IN ('pending','pendiente')) AS pending_count,
  COUNT(tx_id) FILTER (WHERE lower(COALESCE(status,'')) IN ('completed','approved','aprobada','completado','aprobado')) AS completed_count
FROM matched_tx
GROUP BY bank_account_id, country_code, bank_name, account_number, holder, is_active, currency;
GRANT SELECT ON public.bank_account_balances TO authenticated;

-- ─────────────────────────────────────────────
-- 7. APP_SETTINGS (referidos)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY, value JSONB NOT NULL, description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(), updated_by UUID REFERENCES public.users(id)
);
-- Si la tabla ya existía (la creó el Android para referidos) puede no tener
-- estas columnas. Las agregamos de forma idempotente.
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app_settings_read_authenticated" ON public.app_settings;
CREATE POLICY "app_settings_read_authenticated" ON public.app_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "app_settings_write_super_admin" ON public.app_settings;
CREATE POLICY "app_settings_write_super_admin" ON public.app_settings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role = 'super_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role = 'super_admin'));
INSERT INTO public.app_settings (key, value, description) VALUES
    ('referral_rate', '0.01'::jsonb, 'Porcentaje de la comisión que se reparte al referidor')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────
-- 8. LIBRO CONTABLE DE TESORERÍA
-- ─────────────────────────────────────────────
-- Si ya existe una versión previa de estas tablas (creada por otra query
-- con id bigint), la recreamos con el esquema correcto (id uuid). Estas
-- tablas no tienen movimientos reales todavía, así que es seguro.
DROP TABLE IF EXISTS public.treasury_movements CASCADE;
DROP TABLE IF EXISTS public.treasury_accounts CASCADE;

CREATE TABLE public.treasury_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('bank','crypto')),
    currency TEXT NOT NULL, country_code TEXT, exchange TEXT,
    bank_account_id UUID REFERENCES public.cuypay_bank_accounts(id) ON DELETE SET NULL,
    balance NUMERIC(20,2) NOT NULL DEFAULT 0, is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.treasury_accounts ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.treasury_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL CHECK (kind IN ('internal_transfer','fx_buy_usdt','fx_sell_usdt','client_load','client_payout','adjustment')),
    from_account_id UUID REFERENCES public.treasury_accounts(id),
    to_account_id UUID REFERENCES public.treasury_accounts(id),
    from_amount NUMERIC(20,2) NOT NULL DEFAULT 0, to_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
    from_currency TEXT, to_currency TEXT, exchange_rate NUMERIC(20,8),
    fee_amount NUMERIC(20,2) DEFAULT 0, fee_currency TEXT,
    tax_amount NUMERIC(20,2) DEFAULT 0, tax_currency TEXT,
    notes TEXT, created_by UUID REFERENCES public.users(id), created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.treasury_movements ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.treasury_apply_movement(
    p_kind TEXT, p_from_account UUID, p_to_account UUID, p_from_amount NUMERIC, p_to_amount NUMERIC,
    p_exchange_rate NUMERIC DEFAULT NULL, p_fee_amount NUMERIC DEFAULT 0, p_fee_currency TEXT DEFAULT NULL,
    p_tax_amount NUMERIC DEFAULT 0, p_tax_currency TEXT DEFAULT NULL, p_notes TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from RECORD; v_to RECORD; v_mov_id UUID; v_caller UUID := auth.uid(); v_is_admin BOOLEAN;
BEGIN
    SELECT (admin_role IN ('super_admin','treasury')) INTO v_is_admin FROM public.users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin,false) THEN RAISE EXCEPTION 'No autorizado'; END IF;
    IF p_from_account IS NOT NULL THEN SELECT * INTO v_from FROM public.treasury_accounts WHERE id = p_from_account FOR UPDATE; END IF;
    IF p_to_account IS NOT NULL THEN SELECT * INTO v_to FROM public.treasury_accounts WHERE id = p_to_account FOR UPDATE; END IF;
    INSERT INTO public.treasury_movements (kind, from_account_id, to_account_id, from_amount, to_amount, from_currency, to_currency, exchange_rate, fee_amount, fee_currency, tax_amount, tax_currency, notes, created_by)
    VALUES (p_kind, p_from_account, p_to_account, COALESCE(p_from_amount,0), COALESCE(p_to_amount,0), v_from.currency, v_to.currency, p_exchange_rate, COALESCE(p_fee_amount,0), p_fee_currency, COALESCE(p_tax_amount,0), p_tax_currency, p_notes, v_caller)
    RETURNING id INTO v_mov_id;
    IF p_from_account IS NOT NULL THEN UPDATE public.treasury_accounts SET balance = balance - COALESCE(p_from_amount,0), updated_at = NOW() WHERE id = p_from_account; END IF;
    IF p_to_account IS NOT NULL THEN UPDATE public.treasury_accounts SET balance = balance + COALESCE(p_to_amount,0), updated_at = NOW() WHERE id = p_to_account; END IF;
    RETURN v_mov_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.treasury_apply_movement TO authenticated;

DROP POLICY IF EXISTS "treasury_accounts_read" ON public.treasury_accounts;
CREATE POLICY "treasury_accounts_read" ON public.treasury_accounts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL));
DROP POLICY IF EXISTS "treasury_accounts_write" ON public.treasury_accounts;
CREATE POLICY "treasury_accounts_write" ON public.treasury_accounts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')));
DROP POLICY IF EXISTS "treasury_movements_read" ON public.treasury_movements;
CREATE POLICY "treasury_movements_read" ON public.treasury_movements FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL));

-- Seed cuentas de tesorería desde los bancos + wallets USDT
INSERT INTO public.treasury_accounts (name, type, currency, country_code, bank_account_id)
SELECT ba.bank_name || ' ' || public.country_to_currency(ba.country_code), 'bank',
       public.country_to_currency(ba.country_code), ba.country_code, ba.id
FROM public.cuypay_bank_accounts ba
WHERE NOT EXISTS (SELECT 1 FROM public.treasury_accounts ta WHERE ta.bank_account_id = ba.id);

INSERT INTO public.treasury_accounts (name, type, currency, exchange) VALUES
    ('USDT Binance', 'crypto', 'USDT', 'Binance'),
    ('USDT Bitso',   'crypto', 'USDT', 'Bitso')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────
-- 9. Recargar cache + verificar
-- ─────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

SELECT 'cuypay_bank_accounts' AS tabla, COUNT(*) FROM public.cuypay_bank_accounts
UNION ALL SELECT 'treasury_accounts', COUNT(*) FROM public.treasury_accounts
UNION ALL SELECT 'fx_pair_config', COUNT(*) FROM public.fx_pair_config
UNION ALL SELECT 'app_settings', COUNT(*) FROM public.app_settings;
