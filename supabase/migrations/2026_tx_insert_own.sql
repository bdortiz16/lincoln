-- ════════════════════════════════════════════════════════
-- "No hay movimientos": la migración de seguridad dejó transactions con
-- INSERT solo-admin (tx_insert_admin), así que los movimientos de los
-- clientes (depósitos, envíos, recargas) fallaban EN SILENCIO y nunca
-- llegaban a la base.
--
-- Arreglo: cada usuario autenticado puede INSERTAR únicamente filas
-- propias (user_id = su uid). UPDATE y DELETE siguen siendo solo-admin,
-- y el SELECT propio ya existía. Los saldos siguen protegidos por el
-- guard de users — registrar una transacción no mueve dinero.
-- ════════════════════════════════════════════════════════

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='transactions') THEN
    EXECUTE 'DROP POLICY IF EXISTS tx_insert_admin ON public.transactions';
    EXECUTE 'DROP POLICY IF EXISTS tx_insert_own_or_admin ON public.transactions';
    EXECUTE $p$CREATE POLICY tx_insert_own_or_admin ON public.transactions
      FOR INSERT TO authenticated
      WITH CHECK ((user_id IS NOT NULL AND user_id::text = auth.uid()::text) OR public.is_any_admin())$p$;
  END IF;
END $$;
