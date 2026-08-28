-- ════════════════════════════════════════════════════════
-- Tesorería: agregar tipo de movimiento "expense" (gastos)
--
-- Permite registrar gastos que reducen el saldo de una cuenta:
-- comisiones, impuestos, cuota de manejo, comisión bancaria, etc.
-- ════════════════════════════════════════════════════════

ALTER TABLE public.treasury_movements DROP CONSTRAINT IF EXISTS treasury_movements_kind_check;
ALTER TABLE public.treasury_movements ADD CONSTRAINT treasury_movements_kind_check
    CHECK (kind IN (
        'internal_transfer','fx_buy_usdt','fx_sell_usdt',
        'client_load','client_payout','adjustment','expense'
    ));

NOTIFY pgrst, 'reload schema';
