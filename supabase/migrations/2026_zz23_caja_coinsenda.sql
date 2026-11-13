-- ════════════════════════════════════════════════════════
--  Caja de Lincoin: las dos bolsas de Coinsenda.
--
--  La caja (2026_zz20 y 2026_zz21) solo aceptaba 'Mouv' y 'Finity'. Desde el
--  1 nov Coinsenda respalda dos saldos de los clientes, cada uno con su
--  propia cuenta y billetera allá:
--    · 'Coinsenda'   → Cuenta 3, "Saldo Cuenta 3" (COP_C3)
--    · 'Coinsenda 2' → Cuenta 4, "Saldo Cuenta 4" (COP_C4)
--  Sin esto la caja de Coinsenda no se puede abrir (el CHECK rechaza la
--  apertura), no entra en la foto diaria y no se le pueden registrar
--  retiros ni movimientos. Mouv y Finity no cambian.
--
--  Idempotente: borra el CHECK de `proveedor` (se llame como se llame) y lo
--  vuelve a crear con las cuatro bolsas. Si caja_movimientos todavía no
--  existe (falta 2026_zz21), la salta.
-- ════════════════════════════════════════════════════════

DO $caja_coinsenda$
DECLARE t text; r record;
BEGIN
  FOREACH t IN ARRAY ARRAY['caja_apertura', 'caja_cierres', 'caja_movimientos'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    FOR r IN
      SELECT c.conname FROM pg_constraint c
      WHERE c.contype = 'c' AND c.conrelid = to_regclass('public.' || t)
        AND pg_get_constraintdef(c.oid) ILIKE '%proveedor%'
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, r.conname);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (proveedor IN (%L, %L, %L, %L))',
      t, t || '_proveedor_check', 'Mouv', 'Finity', 'Coinsenda', 'Coinsenda 2');
  END LOOP;
END $caja_coinsenda$;
