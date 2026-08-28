-- ════════════════════════════════════════════════════════
-- app_settings: tabla de configuración global de la app
--
-- El Claude del proyecto Android creó esta tabla para el sistema de
-- referidos (key='referral_rate'). Esta migración es idempotente:
--   • crea la tabla si no existe (no la rompe si ya está)
--   • asegura las RLS policies para que:
--      - todos los `authenticated` puedan LEER (la app móvil necesita)
--      - solo `super_admin` puede ESCRIBIR (desde el admin web)
-- ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.app_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_by  UUID REFERENCES public.users(id)
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- ───── SELECT: cualquier authenticated lee (app móvil necesita el rate) ─────
DROP POLICY IF EXISTS "app_settings_read_authenticated" ON public.app_settings;
CREATE POLICY "app_settings_read_authenticated"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (true);

-- ───── INSERT/UPDATE/DELETE: solo super_admin desde el admin web ─────
DROP POLICY IF EXISTS "app_settings_write_super_admin" ON public.app_settings;
CREATE POLICY "app_settings_write_super_admin"
  ON public.app_settings FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND admin_role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND admin_role = 'super_admin'
    )
  );

-- ───── Default: referral_rate = 0.01 (1 %) si no existe la fila ─────
INSERT INTO public.app_settings (key, value, description) VALUES
    ('referral_rate', '0.01'::jsonb, 'Porcentaje de la comisión cobrada que se reparte al usuario que refirió')
ON CONFLICT (key) DO NOTHING;

-- ───── Forzar reload del schema cache de PostgREST ─────
NOTIFY pgrst, 'reload schema';

-- ───── Verificación ─────
SELECT key, value, description, updated_at FROM public.app_settings;
