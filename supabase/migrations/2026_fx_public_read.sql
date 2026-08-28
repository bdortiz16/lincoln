-- ════════════════════════════════════════════════════════
-- FX commissions: tablas + RLS para que la app Android/iOS lea
-- las tasas, fees y configuración nocturna que setea el admin.
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- ════════════════════════════════════════════════════════

-- ───── 1. Tablas (idempotente) ─────

-- Configuración global (una sola fila id=1)
CREATE TABLE IF NOT EXISTS public.fx_global_config (
    id                INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    night_enabled     BOOLEAN DEFAULT false,
    night_start_hour  INT DEFAULT 3 CHECK (night_start_hour BETWEEN 0 AND 23),
    night_end_hour    INT DEFAULT 8 CHECK (night_end_hour BETWEEN 0 AND 23),
    night_extra_pct   NUMERIC(6,3) DEFAULT 1.0,
    timezone          TEXT DEFAULT 'America/Bogota',
    updated_by        UUID REFERENCES public.users(id),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO public.fx_global_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.fx_global_config ENABLE ROW LEVEL SECURITY;

-- Configuración por par
CREATE TABLE IF NOT EXISTS public.fx_pair_config (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency   TEXT NOT NULL,
    to_currency     TEXT NOT NULL,
    base_fee_pct    NUMERIC(6,3) NOT NULL DEFAULT 0.5,
    tiers           JSONB NOT NULL DEFAULT '[
        {"from_usd": 0,      "to_usd": 1000,    "pct": 2.5},
        {"from_usd": 1000,   "to_usd": 10000,   "pct": 2.0},
        {"from_usd": 10000,  "to_usd": 100000,  "pct": 1.5},
        {"from_usd": 100000, "to_usd": null,    "pct": 1.0}
    ]',
    is_active       BOOLEAN DEFAULT true,
    updated_by      UUID REFERENCES public.users(id),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(from_currency, to_currency)
);
-- Si la tabla ya existía sin la columna, agregarla
ALTER TABLE public.fx_pair_config ADD COLUMN IF NOT EXISTS base_fee_pct NUMERIC(6,3) NOT NULL DEFAULT 0.5;
ALTER TABLE public.fx_pair_config ENABLE ROW LEVEL SECURITY;

-- Snapshots de tasas (llenado por Edge Function o frontend)
CREATE TABLE IF NOT EXISTS public.fx_rate_snapshots (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency TEXT NOT NULL,
    to_currency   TEXT NOT NULL,
    rate          NUMERIC(18,8) NOT NULL,
    source        TEXT DEFAULT 'fawaz',
    captured_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fx_snapshots_pair_time
    ON public.fx_rate_snapshots(from_currency, to_currency, captured_at DESC);
ALTER TABLE public.fx_rate_snapshots ENABLE ROW LEVEL SECURITY;

-- ───── 2. RLS — la clave para que Android/iOS LEAN ─────
-- La app móvil consulta estas tablas con su user authenticated; por eso
-- abrimos SELECT a `authenticated`. Solo super_admin/treasury pueden modificar.

-- fx_global_config
DROP POLICY IF EXISTS "fx_global_read"   ON public.fx_global_config;
DROP POLICY IF EXISTS "fx_global_manage" ON public.fx_global_config;

CREATE POLICY "fx_global_read_authenticated"
  ON public.fx_global_config FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "fx_global_write_treasury"
  ON public.fx_global_config FOR ALL
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

-- fx_pair_config
DROP POLICY IF EXISTS "fx_pair_read"   ON public.fx_pair_config;
DROP POLICY IF EXISTS "fx_pair_manage" ON public.fx_pair_config;

CREATE POLICY "fx_pair_read_authenticated"
  ON public.fx_pair_config FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "fx_pair_write_treasury"
  ON public.fx_pair_config FOR ALL
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

-- fx_rate_snapshots — lectura abierta a la app móvil
DROP POLICY IF EXISTS "fx_snapshots_read" ON public.fx_rate_snapshots;

CREATE POLICY "fx_snapshots_read_authenticated"
  ON public.fx_rate_snapshots FOR SELECT
  TO authenticated
  USING (true);

-- (Los inserts en snapshots los hace el Edge Function con service_role → bypass RLS)

-- ───── 3. Función helper para calcular comisión final ─────
-- La app Android/iOS puede llamar esta función vía RPC para obtener el %
-- exacto a aplicar para un par + monto + hora actual.
CREATE OR REPLACE FUNCTION public.fx_calc_commission_pct(
    p_from_currency TEXT,
    p_to_currency   TEXT,
    p_amount        NUMERIC,
    p_from_usd_rate NUMERIC,
    p_now           TIMESTAMPTZ DEFAULT NOW()
) RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    pair_cfg   RECORD;
    global_cfg RECORD;
    amount_usd NUMERIC;
    tier       JSONB;
    pct        NUMERIC := 0;
    local_hour INT;
    in_night   BOOLEAN := false;
BEGIN
    SELECT * INTO pair_cfg FROM public.fx_pair_config
        WHERE from_currency = p_from_currency
          AND to_currency = p_to_currency
          AND is_active = true;
    IF NOT FOUND THEN RETURN 0; END IF;

    SELECT * INTO global_cfg FROM public.fx_global_config WHERE id = 1;

    amount_usd := p_amount * COALESCE(p_from_usd_rate, 1);

    -- Buscar el tier que aplique
    FOR tier IN SELECT * FROM jsonb_array_elements(pair_cfg.tiers) LOOP
        IF amount_usd >= (tier->>'from_usd')::NUMERIC
            AND (tier->'to_usd' = 'null'::jsonb OR (tier->>'to_usd') IS NULL OR amount_usd < (tier->>'to_usd')::NUMERIC)
        THEN
            pct := (tier->>'pct')::NUMERIC;
            EXIT;
        END IF;
    END LOOP;

    -- Fallback al base_fee_pct si los tiers están vacíos
    IF pct = 0 THEN pct := pair_cfg.base_fee_pct; END IF;

    -- Ventana nocturna global
    IF global_cfg.night_enabled THEN
        local_hour := EXTRACT(HOUR FROM (p_now AT TIME ZONE global_cfg.timezone))::INT;
        IF global_cfg.night_start_hour < global_cfg.night_end_hour THEN
            in_night := local_hour >= global_cfg.night_start_hour
                    AND local_hour <  global_cfg.night_end_hour;
        ELSE  -- ventana cruza medianoche (ej: 22:00 → 06:00)
            in_night := local_hour >= global_cfg.night_start_hour
                     OR local_hour <  global_cfg.night_end_hour;
        END IF;
        IF in_night THEN pct := pct + global_cfg.night_extra_pct; END IF;
    END IF;

    RETURN pct;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fx_calc_commission_pct TO authenticated;

-- ───── 4. Seed: 20 pares LATAM si no existen ─────
INSERT INTO public.fx_pair_config (from_currency, to_currency, base_fee_pct) VALUES
    ('COP','CLP', 0.8),('COP','PEN', 0.8),('COP','MXN', 0.8),('COP','BRL', 0.8),
    ('CLP','COP', 0.8),('CLP','PEN', 0.8),('CLP','MXN', 0.8),('CLP','BRL', 0.8),
    ('PEN','COP', 0.8),('PEN','CLP', 0.8),('PEN','MXN', 0.8),('PEN','BRL', 0.8),
    ('MXN','COP', 0.8),('MXN','CLP', 0.8),('MXN','PEN', 0.8),('MXN','BRL', 0.8),
    ('BRL','COP', 0.8),('BRL','CLP', 0.8),('BRL','PEN', 0.8),('BRL','MXN', 0.8)
ON CONFLICT (from_currency, to_currency) DO NOTHING;

-- ───── 5. Verificación ─────
SELECT COUNT(*) AS pairs_configured FROM public.fx_pair_config;
SELECT * FROM public.fx_global_config;
SELECT 'Authenticated puede leer fx_pair_config: ' || (
    EXISTS(SELECT 1 FROM pg_policies WHERE tablename='fx_pair_config' AND cmd='SELECT' AND roles::text LIKE '%authenticated%')
)::text AS rls_check;
