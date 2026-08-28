-- ════════════════════════════════════════════════════════
-- RLS: permitir al admin de Personas leer/aprobar transacciones
--
-- Síntoma corregido: en el SQL Editor (role postgres) las filas
-- de public.transactions se ven, pero el panel admin recibe 0 filas
-- porque RLS está habilitado y no había una policy de SELECT que
-- aplicara al rol authenticated cuando el usuario es admin.
--
-- Esta migración asume que public.users tiene la columna admin_role
-- (creada en feat/admin-personas-multi-role).
-- ════════════════════════════════════════════════════════

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- ───── SELECT: cualquier admin (cualquier rol) puede ver todas las TX ─────
DROP POLICY IF EXISTS "admin_select_all_transactions" ON public.transactions;
CREATE POLICY "admin_select_all_transactions"
  ON public.transactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND admin_role IS NOT NULL
    )
  );

-- ───── SELECT: el dueño también ve sus propias TX (app móvil) ─────
DROP POLICY IF EXISTS "owner_select_own_transactions" ON public.transactions;
CREATE POLICY "owner_select_own_transactions"
  ON public.transactions FOR SELECT
  TO authenticated
  USING (
    -- soporta ambos esquemas
    auth.uid() = COALESCE(owner_user_id, user_id::uuid)
  );

-- ───── UPDATE: super_admin y treasury pueden aprobar / rechazar ─────
DROP POLICY IF EXISTS "admin_update_transactions" ON public.transactions;
CREATE POLICY "admin_update_transactions"
  ON public.transactions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND admin_role IN ('super_admin','treasury')
    )
  )
  WITH CHECK (true);

-- ───── Realtime: que el panel admin se entere de inserts/updates ─────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'transactions'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
    END IF;
END $$;

-- ───── Verificar: cuántas TX debería ver un admin ─────
-- Ejecuta después del CREATE POLICY:
SELECT COUNT(*) AS total_transactions FROM public.transactions;
SELECT id, owner_user_id, kind, status, amount, currency, created_at
FROM public.transactions
ORDER BY created_at DESC
LIMIT 10;
