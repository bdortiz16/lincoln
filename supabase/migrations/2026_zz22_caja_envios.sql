-- ════════════════════════════════════════════════════════
--  Envíos de la utilidad a la empresa (Bre-B desde las bolsas).
--
--  Desde Tesorería › Lincoin, el dueño o Tesorería mandan la utilidad de
--  Lincoin por Bre-B, desde la bolsa de Mouv o de Finity, a una de las llaves
--  de Lincoin. Cada envío queda como un retiro en caja_movimientos y en
--  `envio` guarda cómo va:
--    { estado: enviando | en_proceso | enviado | por_confirmar | no_salio | devuelto,
--      llaveId, llave (enmascarada), titular, documento, ref, referencia,
--      costo, detalle, at }
--  El costo de la transferencia se registra aparte como egreso, con
--  { estado: 'costo', costoDe: <id del retiro> }.
--
--  Sin esta columna el panel sigue funcionando, pero no deja enviar.
--  Idempotente: se puede correr varias veces.
-- ════════════════════════════════════════════════════════

ALTER TABLE public.caja_movimientos ADD COLUMN IF NOT EXISTS envio jsonb;
