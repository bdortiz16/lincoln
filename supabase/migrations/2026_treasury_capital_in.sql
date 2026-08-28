-- ════════════════════════════════════════════════════════
-- Tesorería: tipo de movimiento "capital_in" (aporte propio)
--
-- Cuando el dueño / la sociedad mete plata a una cuenta (capital inicial,
-- préstamo de socio, reintegro, etc.). Es un INGRESO al libro distinto a
-- un cargue de cliente.
-- ════════════════════════════════════════════════════════

ALTER TABLE public.treasury_movements DROP CONSTRAINT IF EXISTS treasury_movements_kind_check;
ALTER TABLE public.treasury_movements ADD CONSTRAINT treasury_movements_kind_check
    CHECK (kind IN (
        'internal_transfer','fx_buy_usdt','fx_sell_usdt',
        'client_load','client_payout','adjustment','expense','profit',
        'capital_in'
    ));

NOTIFY pgrst, 'reload schema';
