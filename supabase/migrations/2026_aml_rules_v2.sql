-- ───────────────────────────────────────────────────────
-- 2026_aml_rules_v2.sql
--
-- Catálogo extendido de reglas AML — cobertura de oficial de
-- cumplimiento. Nuevos tipos de regla + parámetros + acción al
-- disparar.
--
-- Tipos: high_amount, daily_volume, cross_border, round_amounts,
--        velocity, frequent_low, pass_through, odd_hours,
--        new_account_volume, dormant_reactivation,
--        many_beneficiaries, high_risk_country, shared_device
--
-- Acciones: alert (solo alerta) / alert_hold (+ compliance hold) /
--           alert_block (+ bloqueo temporal automático)
--
-- El motor de evaluación (cron/edge de Antigravity) debe respetar:
--   • exempt_custom_limits=true → saltear usuarios con
--     custom_daily_limit / custom_monthly_limit NOT NULL
--   • currencies=[] → todas; sino solo TXs en esas monedas
--   • countries → según el tipo (cross_border/high_risk_country)
--   • cooldown_hours → no re-alertar al mismo usuario en la ventana
--   • rule_action → alert_hold activa compliance hold;
--     alert_block setea users.is_active=false + block_type='temporary'
--
-- Idempotente.
-- ───────────────────────────────────────────────────────

-- 1) Ampliar el CHECK de rule_type con los tipos nuevos
ALTER TABLE public.aml_rules
    DROP CONSTRAINT IF EXISTS aml_rules_rule_type_check;

ALTER TABLE public.aml_rules
    ADD CONSTRAINT aml_rules_rule_type_check
    CHECK (rule_type IN (
        'high_amount','daily_volume','cross_border','round_amounts',
        'velocity','frequent_low','pass_through','odd_hours',
        'new_account_volume','dormant_reactivation',
        'many_beneficiaries','high_risk_country','shared_device'
    ));

-- 2) Parámetros nuevos
ALTER TABLE public.aml_rules
    ADD COLUMN IF NOT EXISTS account_age_days integer,
    ADD COLUMN IF NOT EXISTS hour_from        integer CHECK (hour_from BETWEEN 0 AND 23),
    ADD COLUMN IF NOT EXISTS hour_to          integer CHECK (hour_to   BETWEEN 0 AND 23),
    ADD COLUMN IF NOT EXISTS countries        jsonb   NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS currencies       jsonb   NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS rule_action      text    NOT NULL DEFAULT 'alert'
        CHECK (rule_action IN ('alert','alert_hold','alert_block')),
    ADD COLUMN IF NOT EXISTS cooldown_hours   integer;

-- (Las columnas applies_to / exempt_custom_limits / tx_count vienen de
--  2026_aml_rules_scope.sql — se re-declaran por si esa no corrió.)
ALTER TABLE public.aml_rules
    ADD COLUMN IF NOT EXISTS applies_to           text    NOT NULL DEFAULT 'all',
    ADD COLUMN IF NOT EXISTS exempt_custom_limits boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS tx_count             integer;
