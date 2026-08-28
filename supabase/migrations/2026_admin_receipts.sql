-- ════════════════════════════════════════════════════════
-- Comprobante de respaldo del pago al cliente (interno)
--
-- Cuando el admin paga a un cliente (send) y marca completado, puede
-- subir el soporte del pago. Este comprobante es SOLO interno — la app
-- del cliente NO lo muestra. Se guarda en un bucket privado.
-- ════════════════════════════════════════════════════════

-- ───── 1. Bucket privado para comprobantes internos ─────
INSERT INTO storage.buckets (id, name, public)
VALUES ('admin-receipts', 'admin-receipts', false)
ON CONFLICT (id) DO NOTHING;

-- Policies de storage: solo admins suben y leen
DROP POLICY IF EXISTS "admin_upload_admin_receipts" ON storage.objects;
CREATE POLICY "admin_upload_admin_receipts" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'admin-receipts'
    AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL)
  );

DROP POLICY IF EXISTS "admin_read_admin_receipts" ON storage.objects;
CREATE POLICY "admin_read_admin_receipts" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'admin-receipts'
    AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL)
  );

DROP POLICY IF EXISTS "admin_delete_admin_receipts" ON storage.objects;
CREATE POLICY "admin_delete_admin_receipts" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'admin-receipts'
    AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury'))
  );

-- ───── 2. Tabla que registra los comprobantes internos por TX ─────
CREATE TABLE IF NOT EXISTS public.tx_admin_receipts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  TEXT NOT NULL,
    file_path       TEXT NOT NULL,           -- path dentro del bucket admin-receipts
    note            TEXT,
    uploaded_by     UUID REFERENCES public.users(id),
    uploaded_email  TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tx_admin_receipts_tx ON public.tx_admin_receipts(transaction_id, created_at DESC);
ALTER TABLE public.tx_admin_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_tx_receipts" ON public.tx_admin_receipts;
CREATE POLICY "admin_read_tx_receipts" ON public.tx_admin_receipts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL));

DROP POLICY IF EXISTS "admin_write_tx_receipts" ON public.tx_admin_receipts;
CREATE POLICY "admin_write_tx_receipts" ON public.tx_admin_receipts
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL));

NOTIFY pgrst, 'reload schema';
