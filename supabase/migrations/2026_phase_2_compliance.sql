-- ════════════════════════════════════════════════════════
-- F2: COMPLIANCE AVANZADO
-- - AML rules configurables
-- - Compliance alerts (con trigger automático)
-- - Sanctions list (OFAC/PEP simplificada)
-- ════════════════════════════════════════════════════════

-- ───── 1. AML RULES ─────
-- Reglas configurables que disparan alertas en TX
CREATE TABLE IF NOT EXISTS public.aml_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    rule_type TEXT NOT NULL CHECK (rule_type IN (
        'high_amount',        -- monto único alto
        'frequent_low',       -- muchas TX pequeñas seguidas
        'cross_border',       -- envío internacional
        'velocity'            -- alta velocidad de TX en periodo
    )),
    transaction_type TEXT,  -- 'load', 'send', 'convert', null = todas
    currency TEXT,           -- null = todas
    country_code TEXT,       -- null = todas
    amount_threshold NUMERIC(18,2),
    time_window_hours INT,
    severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.aml_rules ENABLE ROW LEVEL SECURITY;

-- ───── 2. COMPLIANCE ALERTS ─────
CREATE TABLE IF NOT EXISTS public.compliance_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID REFERENCES public.aml_rules(id),
    rule_name TEXT,
    severity TEXT NOT NULL,
    user_id UUID REFERENCES public.users(id),
    transaction_id UUID REFERENCES public.transactions(id),
    description TEXT,
    metadata JSONB,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','closed','escalated')),
    reviewed_by UUID REFERENCES public.users(id),
    reviewed_at TIMESTAMPTZ,
    resolution TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_status ON public.compliance_alerts(status);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_severity ON public.compliance_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_created ON public.compliance_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_user ON public.compliance_alerts(user_id);
ALTER TABLE public.compliance_alerts ENABLE ROW LEVEL SECURITY;

-- ───── 3. SANCTIONS LIST (simplificada) ─────
CREATE TABLE IF NOT EXISTS public.sanctions_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_type TEXT NOT NULL CHECK (list_type IN ('OFAC','UN','EU','PEP','INTERNAL')),
    full_name TEXT NOT NULL,
    aliases TEXT[],
    country_code TEXT,
    date_of_birth DATE,
    notes TEXT,
    source TEXT,
    added_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sanctions_name ON public.sanctions_list USING GIN (to_tsvector('simple', full_name));
CREATE INDEX IF NOT EXISTS idx_sanctions_list_type ON public.sanctions_list(list_type);
ALTER TABLE public.sanctions_list ENABLE ROW LEVEL SECURITY;

-- ───── 4. RLS para las nuevas tablas ─────
CREATE POLICY "compliance_read_aml_rules" ON public.aml_rules
  FOR SELECT USING (public.is_admin_with_role('super_admin','compliance','audit'));
CREATE POLICY "compliance_manage_aml_rules" ON public.aml_rules
  FOR ALL USING (public.is_admin_with_role('super_admin','compliance'));

CREATE POLICY "compliance_read_alerts" ON public.compliance_alerts
  FOR SELECT USING (public.is_admin_with_role('super_admin','compliance','audit'));
CREATE POLICY "compliance_update_alerts" ON public.compliance_alerts
  FOR UPDATE USING (public.is_admin_with_role('super_admin','compliance'));
CREATE POLICY "compliance_insert_alerts" ON public.compliance_alerts
  FOR INSERT WITH CHECK (true);  -- triggers internos pueden insertar

CREATE POLICY "compliance_read_sanctions" ON public.sanctions_list
  FOR SELECT USING (public.is_admin_with_role('super_admin','compliance','audit'));
CREATE POLICY "compliance_manage_sanctions" ON public.sanctions_list
  FOR ALL USING (public.is_admin_with_role('super_admin','compliance'));

-- ───── 5. TRIGGER — evalúa reglas AML cuando se inserta una TX ─────
CREATE OR REPLACE FUNCTION public.evaluate_aml_rules()
RETURNS TRIGGER AS $$
DECLARE
    rule RECORD;
    user_record RECORD;
    velocity_count INT;
    description TEXT;
BEGIN
    -- Saltamos si no hay usuario
    IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

    -- Traer país del usuario
    SELECT country INTO user_record FROM public.users WHERE id = NEW.user_id;

    -- Iterar todas las reglas activas
    FOR rule IN
        SELECT * FROM public.aml_rules WHERE is_active = true
    LOOP
        -- Filtros básicos
        IF rule.transaction_type IS NOT NULL AND rule.transaction_type <> NEW.type THEN CONTINUE; END IF;
        IF rule.currency IS NOT NULL AND rule.currency <> COALESCE(NEW.from_currency, '') THEN CONTINUE; END IF;

        IF rule.rule_type = 'high_amount' THEN
            IF rule.amount_threshold IS NOT NULL AND COALESCE(NEW.from_amount, 0) >= rule.amount_threshold THEN
                description := format('Transacción de %s %s supera umbral de %s',
                    NEW.from_currency, NEW.from_amount, rule.amount_threshold);
                INSERT INTO public.compliance_alerts (rule_id, rule_name, severity, user_id, transaction_id, description, metadata)
                VALUES (rule.id, rule.name, rule.severity, NEW.user_id, NEW.id, description,
                    jsonb_build_object('amount', NEW.from_amount, 'currency', NEW.from_currency, 'type', NEW.type));
            END IF;

        ELSIF rule.rule_type = 'velocity' THEN
            SELECT COUNT(*) INTO velocity_count
            FROM public.transactions
            WHERE user_id = NEW.user_id
              AND created_at >= NOW() - (rule.time_window_hours || ' hours')::interval;
            IF velocity_count >= 5 THEN  -- regla simple: 5+ TX en ventana
                description := format('Usuario realizó %s transacciones en %s horas',
                    velocity_count, rule.time_window_hours);
                INSERT INTO public.compliance_alerts (rule_id, rule_name, severity, user_id, transaction_id, description, metadata)
                VALUES (rule.id, rule.name, rule.severity, NEW.user_id, NEW.id, description,
                    jsonb_build_object('tx_count', velocity_count, 'window_hours', rule.time_window_hours));
            END IF;
        END IF;
    END LOOP;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Nunca rompemos la TX original si falla la evaluación
    RAISE WARNING 'AML evaluation failed: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_transaction_aml_check ON public.transactions;
CREATE TRIGGER on_transaction_aml_check
    AFTER INSERT ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.evaluate_aml_rules();

-- ───── 6. Seed de reglas iniciales ─────
INSERT INTO public.aml_rules (name, description, rule_type, amount_threshold, severity)
VALUES
    ('Transacción alto valor (5M)', 'Alerta cuando una transacción supera 5,000,000', 'high_amount', 5000000, 'high'),
    ('Transacción muy alto valor (20M)', 'Alerta crítica para TX > 20M', 'high_amount', 20000000, 'critical'),
    ('Alta velocidad de TX', 'Más de 5 TX en 1 hora', 'velocity', NULL, 'medium')
ON CONFLICT DO NOTHING;

UPDATE public.aml_rules SET time_window_hours = 1 WHERE rule_type = 'velocity' AND time_window_hours IS NULL;
