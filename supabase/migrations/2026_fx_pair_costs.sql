-- ============================================================
-- fx_pair_costs — costo operativo POR PAR de monedas FX
--
-- Contexto: CuyPay cobra comisión al cliente (3-4-2-1%) pero al
-- ejecutar el intercambio Colombia↔Brasil tiene un costo operativo
-- propio: gas onchain, wire fee del banco, spread del partner FX.
-- Esto es plata REAL que sale antes de calcular utilidad.
--
-- Estructura:
--   cost_usd: monto fijo en USD por TX del par (ej. $2 wire SWIFT)
--   cost_pct: % adicional sobre la COMISIÓN cobrada (ej. 5% partner)
--
-- Cómo se usa en AccountingSection:
--   effective_cost = cost_usd + (cost_pct/100 × comisión_cliente)
--   comisión_neta_para_split = comisión_cliente − effective_cost
--   luego 50/50 + IVA solo al emisor.
--
-- Ejemplo COP→BRL, fee=$100, cost_usd=$2, cost_pct=5:
--   effective_cost = 2 + 5 = $7
--   neta_split = $93 → $46.50 a Colombia / $46.50 a Brasil
--   IVA CO 19% = $8.835 → Colombia neto $37.665
--   Empresa neta = $84.165 (de $100 brutos)
--
-- Aplicar en AMBOS proyectos Supabase (Empresas + Personas).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.fx_pair_costs (
  from_currency TEXT NOT NULL,
  to_currency   TEXT NOT NULL,
  cost_usd      NUMERIC(12,4) NOT NULL DEFAULT 0,
  cost_pct      NUMERIC(8,4)  NOT NULL DEFAULT 0,
  notes         TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,
  PRIMARY KEY (from_currency, to_currency),
  CHECK (cost_usd >= 0 AND cost_pct >= 0 AND cost_pct <= 100)
);

-- Auto-update del updated_at en cada UPDATE.
CREATE OR REPLACE FUNCTION public.tg_fx_pair_costs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fx_pair_costs_touch ON public.fx_pair_costs;
CREATE TRIGGER fx_pair_costs_touch
  BEFORE INSERT OR UPDATE ON public.fx_pair_costs
  FOR EACH ROW EXECUTE FUNCTION public.tg_fx_pair_costs_updated_at();

-- ============================================================
-- RLS: lectura para cualquier admin; escritura solo
-- super_admin y treasury (la cifra impacta utilidad).
-- ============================================================

ALTER TABLE public.fx_pair_costs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
           WHERE tablename = 'fx_pair_costs' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.fx_pair_costs', r.policyname);
  END LOOP;
END $$;

-- Si is_any_admin / is_admin_with_role no existen todavía en este proyecto
-- (la migración 2026_security_hardening_rls.sql las crea), las policies
-- van a fallar al evaluarse. Definimos un fallback acá para no bloquear
-- el deploy en orden distinto.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_any_admin') THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.is_any_admin() RETURNS BOOLEAN
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $b$
        SELECT EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid()
            AND (u.role = 'admin' OR COALESCE(to_jsonb(u)->>'admin_role','') <> '')
        );
      $b$
    $f$;
    GRANT EXECUTE ON FUNCTION public.is_any_admin() TO authenticated, anon;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_admin_with_role') THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.is_admin_with_role(VARIADIC roles text[]) RETURNS BOOLEAN
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $b$
        SELECT EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid()
            AND ((to_jsonb(u)->>'admin_role') = ANY(roles)
                 OR (u.role = 'admin' AND 'super_admin' = ANY(roles)))
        );
      $b$
    $f$;
    GRANT EXECUTE ON FUNCTION public.is_admin_with_role(text[]) TO authenticated, anon;
  END IF;
END $$;

CREATE POLICY fx_pair_costs_select ON public.fx_pair_costs FOR SELECT TO authenticated
  USING (public.is_any_admin());

CREATE POLICY fx_pair_costs_insert ON public.fx_pair_costs FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_with_role('super_admin', 'treasury'));

CREATE POLICY fx_pair_costs_update ON public.fx_pair_costs FOR UPDATE TO authenticated
  USING (public.is_admin_with_role('super_admin', 'treasury'))
  WITH CHECK (public.is_admin_with_role('super_admin', 'treasury'));

CREATE POLICY fx_pair_costs_delete ON public.fx_pair_costs FOR DELETE TO authenticated
  USING (public.is_admin_with_role('super_admin', 'treasury'));

-- ============================================================
-- Smoke check
-- ============================================================

DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_policies WHERE tablename = 'fx_pair_costs' AND schemaname='public';
  RAISE NOTICE 'fx_pair_costs: policies=%, rls enabled', n;
END $$;
