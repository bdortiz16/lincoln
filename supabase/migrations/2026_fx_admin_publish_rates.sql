-- ════════════════════════════════════════════════════════
-- Permitir que el admin PUBLIQUE tasas en fx_rate_snapshots
--
-- Las apps (iOS + Android) leen la tasa base de fx_rate_snapshots
-- (fila más reciente por par). El panel admin necesita poder INSERT ahí
-- cuando el admin setea/cambia una tasa. Hasta ahora solo el Edge Function
-- (service_role) insertaba; con esto super_admin/treasury también pueden.
--
-- Idempotente.
-- ════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "fx_snapshots_insert_treasury" ON public.fx_rate_snapshots;
CREATE POLICY "fx_snapshots_insert_treasury"
  ON public.fx_rate_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND admin_role IN ('super_admin','treasury')
    )
  );

NOTIFY pgrst, 'reload schema';
