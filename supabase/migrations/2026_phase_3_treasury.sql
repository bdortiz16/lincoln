-- ════════════════════════════════════════════════════════
-- F3: TREASURY AVANZADO
-- - FX rates (tasas de cambio)
-- - Partners (proveedores/contrapartes)
-- - Bank reconciliation (conciliación bancaria)
-- ════════════════════════════════════════════════════════

-- ───── 1. FX RATES ─────
CREATE TABLE IF NOT EXISTS public.fx_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    rate NUMERIC(18,6) NOT NULL,
    spread_pct NUMERIC(6,3) DEFAULT 0,        -- % de markup sobre la tasa
    effective_from TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(from_currency, to_currency, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_fx_rates_pair ON public.fx_rates(from_currency, to_currency) WHERE is_active = true;
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;

-- ───── 2. PARTNERS ─────
CREATE TABLE IF NOT EXISTS public.partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT CHECK (type IN ('bank','liquidity','kyc','payment','custodian','other')),
    country_code TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    api_endpoint TEXT,
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;

-- ───── 3. BANK RECONCILIATION ─────
CREATE TABLE IF NOT EXISTS public.bank_statements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_account_id UUID REFERENCES public.cuypay_bank_accounts(id),
    statement_date DATE NOT NULL,
    opening_balance NUMERIC(18,2),
    closing_balance NUMERIC(18,2),
    uploaded_by UUID REFERENCES public.users(id),
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bank_statement_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    statement_id UUID REFERENCES public.bank_statements(id) ON DELETE CASCADE,
    posted_at TIMESTAMPTZ,
    description TEXT,
    amount NUMERIC(18,2) NOT NULL,
    is_credit BOOLEAN NOT NULL,   -- true = entrada, false = salida
    matched_transaction_id UUID REFERENCES public.transactions(id),
    match_status TEXT DEFAULT 'unmatched' CHECK (match_status IN ('unmatched','matched','manual_match','ignored')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_statement_lines_statement ON public.bank_statement_lines(statement_id);
CREATE INDEX IF NOT EXISTS idx_statement_lines_match ON public.bank_statement_lines(match_status);

ALTER TABLE public.bank_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;

-- ───── 4. RLS ─────
CREATE POLICY "treasury_read_fx" ON public.fx_rates
  FOR SELECT USING (public.is_admin_with_role('super_admin','treasury','audit'));
CREATE POLICY "treasury_manage_fx" ON public.fx_rates
  FOR ALL USING (public.is_admin_with_role('super_admin','treasury'));

CREATE POLICY "treasury_read_partners" ON public.partners
  FOR SELECT USING (public.is_admin_with_role('super_admin','treasury','audit'));
CREATE POLICY "treasury_manage_partners" ON public.partners
  FOR ALL USING (public.is_admin_with_role('super_admin','treasury'));

CREATE POLICY "treasury_read_statements" ON public.bank_statements
  FOR SELECT USING (public.is_admin_with_role('super_admin','treasury','audit'));
CREATE POLICY "treasury_manage_statements" ON public.bank_statements
  FOR ALL USING (public.is_admin_with_role('super_admin','treasury'));

CREATE POLICY "treasury_read_lines" ON public.bank_statement_lines
  FOR SELECT USING (public.is_admin_with_role('super_admin','treasury','audit'));
CREATE POLICY "treasury_manage_lines" ON public.bank_statement_lines
  FOR ALL USING (public.is_admin_with_role('super_admin','treasury'));

-- ───── 5. Seed FX rates iniciales ─────
INSERT INTO public.fx_rates (from_currency, to_currency, rate, spread_pct, is_active) VALUES
    ('USD','COP', 4000.00, 0.5, true),
    ('USD','PEN', 3.75,    0.5, true),
    ('USD','CLP', 950.00,  0.5, true),
    ('USD','MXN', 17.50,   0.5, true),
    ('COP','USD', 0.00025, 0.5, true),
    ('PEN','USD', 0.266,   0.5, true)
ON CONFLICT DO NOTHING;
