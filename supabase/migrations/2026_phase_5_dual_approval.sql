-- ════════════════════════════════════════════════════════
-- F5: 2FA + DOBLE APROBACIÓN
-- - Workflow de aprobación con segundo aprobador para TX altas
-- - Umbral configurable por moneda
-- ════════════════════════════════════════════════════════

-- ───── 1. Umbrales de doble aprobación ─────
CREATE TABLE IF NOT EXISTS public.dual_approval_thresholds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    currency TEXT NOT NULL UNIQUE,
    amount_threshold NUMERIC(18,2) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    updated_by UUID REFERENCES public.users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.dual_approval_thresholds ENABLE ROW LEVEL SECURITY;

-- ───── 2. Workflow de aprobaciones ─────
CREATE TABLE IF NOT EXISTS public.tx_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
    approver_id UUID NOT NULL REFERENCES public.users(id),
    approver_email TEXT,
    approver_role TEXT,
    decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(transaction_id, approver_id)
);
CREATE INDEX IF NOT EXISTS idx_tx_approvals_tx ON public.tx_approvals(transaction_id);
ALTER TABLE public.tx_approvals ENABLE ROW LEVEL SECURITY;

-- ───── 3. RLS ─────
CREATE POLICY "thresholds_read" ON public.dual_approval_thresholds
  FOR SELECT USING (public.is_any_admin());
CREATE POLICY "thresholds_manage" ON public.dual_approval_thresholds
  FOR ALL USING (public.is_admin_with_role('super_admin', 'treasury'));

CREATE POLICY "approvals_read" ON public.tx_approvals
  FOR SELECT USING (public.is_any_admin());
CREATE POLICY "approvals_write" ON public.tx_approvals
  FOR INSERT WITH CHECK (
    public.is_admin_with_role('super_admin', 'treasury') AND approver_id = auth.uid()
  );

-- ───── 4. Helper: ¿necesita doble aprobación? ─────
CREATE OR REPLACE FUNCTION public.tx_needs_dual_approval(p_tx_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.transactions t
    JOIN public.dual_approval_thresholds d
      ON d.currency = t.from_currency AND d.is_active = true
    WHERE t.id = p_tx_id
      AND COALESCE(t.from_amount, 0) >= d.amount_threshold
  );
$$;

-- ───── 5. Helper: ¿ya tiene 2 aprobaciones distintas? ─────
CREATE OR REPLACE FUNCTION public.tx_has_dual_approval(p_tx_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT (
    SELECT COUNT(DISTINCT approver_id)
    FROM public.tx_approvals
    WHERE transaction_id = p_tx_id AND decision = 'approve'
  ) >= 2;
$$;

-- ───── 6. Seeds: umbrales iniciales ─────
INSERT INTO public.dual_approval_thresholds (currency, amount_threshold, is_active) VALUES
    ('COP', 10000000,  true),    -- 10 millones COP
    ('USD', 2500,      true),    -- 2,500 USD
    ('PEN', 10000,     true),    -- 10,000 PEN
    ('CLP', 2500000,   true),    -- 2.5 millones CLP
    ('MXN', 50000,     true)     -- 50,000 MXN
ON CONFLICT (currency) DO NOTHING;
