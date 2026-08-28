-- ════════════════════════════════════════════════════════
-- FX: persistir el modo Manual / API por par
--
-- El toggle del admin necesita un flag persistido para sobrevivir al cron
-- de XE (que escribe filas más recientes y "ganaría" la última snapshot).
-- Con manual_mode=true el admin declara: "este par lo manejo yo, no escribas
-- XE encima". Antigravity DEBE filtrar esta columna en su edge function.
-- ════════════════════════════════════════════════════════

ALTER TABLE public.fx_pair_config ADD COLUMN IF NOT EXISTS manual_mode BOOLEAN DEFAULT false;

NOTIFY pgrst, 'reload schema';

SELECT from_currency, to_currency, manual_mode FROM public.fx_pair_config
WHERE manual_mode = true ORDER BY from_currency, to_currency;
