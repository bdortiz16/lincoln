-- ════════════════════════════════════════════════════════
-- Tesorería: billetera de utilidades + movimiento "profit"
--
-- Permite mandar la utilidad (margen) a una billetera dedicada.
-- Se guarda en USDT por defecto, pero puede convertirse desde cualquier
-- cuenta. El movimiento 'profit' debita la cuenta operativa y acredita
-- la billetera de utilidades.
-- ════════════════════════════════════════════════════════

-- Permitir el tipo 'profit'
ALTER TABLE public.treasury_movements DROP CONSTRAINT IF EXISTS treasury_movements_kind_check;
ALTER TABLE public.treasury_movements ADD CONSTRAINT treasury_movements_kind_check
    CHECK (kind IN (
        'internal_transfer','fx_buy_usdt','fx_sell_usdt',
        'client_load','client_payout','adjustment','expense','profit'
    ));

-- Marca de billetera de utilidades
ALTER TABLE public.treasury_accounts ADD COLUMN IF NOT EXISTS is_profit BOOLEAN DEFAULT false;

-- Crear la billetera de utilidades en USDT si no existe
INSERT INTO public.treasury_accounts (name, type, currency, exchange, is_profit)
SELECT 'Utilidades USDT', 'crypto', 'USDT', 'Utilidades', true
WHERE NOT EXISTS (SELECT 1 FROM public.treasury_accounts WHERE is_profit = true);

NOTIFY pgrst, 'reload schema';

SELECT name, type, currency, is_profit, balance FROM public.treasury_accounts ORDER BY is_profit DESC, type, currency;
