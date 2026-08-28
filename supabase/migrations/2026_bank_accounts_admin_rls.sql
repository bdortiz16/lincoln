-- ════════════════════════════════════════════════════════
-- RLS: permitir al admin de Personas crear / editar / eliminar
-- cuentas bancarias desde el panel.
--
-- Asume que public.users tiene la columna admin_role.
-- Ajusta a tu esquema si la tabla `cuypay_bank_accounts` tiene
-- columnas diferentes.
-- ════════════════════════════════════════════════════════

-- Si la tabla aún no existe (algunos proyectos solo tienen "bank_accounts"),
-- la creamos con el esquema completo.
CREATE TABLE IF NOT EXISTS public.cuypay_bank_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    country_code    TEXT NOT NULL,
    bank_name       TEXT NOT NULL,
    account_type    TEXT,
    account_number  TEXT NOT NULL,
    holder          TEXT,
    tax_id          TEXT,
    tax_id_label    TEXT,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.cuypay_bank_accounts ENABLE ROW LEVEL SECURITY;

-- ───── SELECT: cualquier usuario autenticado puede leer cuentas ACTIVAS ─────
--      (la app Android las muestra al cargar saldo)
DROP POLICY IF EXISTS "anyone_select_active_bank_accounts" ON public.cuypay_bank_accounts;
CREATE POLICY "anyone_select_active_bank_accounts"
  ON public.cuypay_bank_accounts FOR SELECT
  TO authenticated
  USING (is_active = true);

-- ───── SELECT: admin ve TODAS, incluso inactivas ─────
DROP POLICY IF EXISTS "admin_select_all_bank_accounts" ON public.cuypay_bank_accounts;
CREATE POLICY "admin_select_all_bank_accounts"
  ON public.cuypay_bank_accounts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND admin_role IS NOT NULL
    )
  );

-- ───── INSERT / UPDATE / DELETE: super_admin y treasury ─────
DROP POLICY IF EXISTS "treasury_manage_bank_accounts" ON public.cuypay_bank_accounts;
CREATE POLICY "treasury_manage_bank_accounts"
  ON public.cuypay_bank_accounts FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND admin_role IN ('super_admin','treasury')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND admin_role IN ('super_admin','treasury')
    )
  );

-- ───── Trigger para auto-updatear updated_at ─────
CREATE OR REPLACE FUNCTION public.touch_cuypay_bank_accounts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cuypay_bank_accounts_updated_at ON public.cuypay_bank_accounts;
CREATE TRIGGER trg_cuypay_bank_accounts_updated_at
    BEFORE UPDATE ON public.cuypay_bank_accounts
    FOR EACH ROW EXECUTE FUNCTION public.touch_cuypay_bank_accounts_updated_at();

-- ───── Verificación ─────
SELECT COUNT(*) AS total_bank_accounts FROM public.cuypay_bank_accounts;
SELECT id, country_code, bank_name, account_number, is_active
FROM public.cuypay_bank_accounts
ORDER BY country_code;
