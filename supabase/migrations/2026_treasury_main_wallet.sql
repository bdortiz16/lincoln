-- ════════════════════════════════════════════════════════
-- Tesorería: billetera principal en USDT (reserva)
--
-- Aparte de las wallets operativas (Binance, Bybit, etc.) y la billetera de
-- utilidades, se crea una billetera "Tesorería" en USDT — el cofre principal
-- donde se concentra la reserva. is_treasury la marca como tal.
-- ════════════════════════════════════════════════════════

ALTER TABLE public.treasury_accounts ADD COLUMN IF NOT EXISTS is_treasury BOOLEAN DEFAULT false;

INSERT INTO public.treasury_accounts (name, type, currency, exchange, is_treasury)
SELECT 'Tesorería USDT', 'crypto', 'USDT', 'Tesorería', true
WHERE NOT EXISTS (SELECT 1 FROM public.treasury_accounts WHERE is_treasury = true);

NOTIFY pgrst, 'reload schema';

SELECT name, type, currency, exchange, is_treasury, is_profit, balance
FROM public.treasury_accounts
ORDER BY is_treasury DESC, is_profit DESC, type, currency;
