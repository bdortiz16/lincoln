-- ───────────────────────────────────────────────────────
-- 2026_fx_snapshots_empresas.sql
--
-- Infraestructura de tasas FastForex para el proyecto Supabase de
-- EMPRESAS (el feed original vive en CuyPayANDROID; con esto este
-- proyecto tiene el suyo propio).
--
--   1. Tabla fx_rate_snapshots (misma estructura que CuyPayANDROID)
--   2. RLS: lectura para usuarios autenticados y anon
--   3. (Opcional) programación del cron cada 5 min con pg_cron + pg_net
--
-- Pegar en el SQL Editor del proyecto de EMPRESAS.
-- ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fx_rate_snapshots (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    from_currency text        NOT NULL,
    to_currency   text        NOT NULL,
    rate          numeric     NOT NULL,
    source        text        NOT NULL DEFAULT 'FASTFOREX',
    captured_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fx_snapshots_pair_time_idx
    ON public.fx_rate_snapshots (from_currency, to_currency, captured_at DESC);

ALTER TABLE public.fx_rate_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fx_snapshots_read ON public.fx_rate_snapshots;
CREATE POLICY fx_snapshots_read ON public.fx_rate_snapshots
    FOR SELECT TO anon, authenticated USING (true);

-- "Publicar todas" del panel inserta tasas manuales desde la app (anon).
DROP POLICY IF EXISTS fx_snapshots_insert ON public.fx_rate_snapshots;
CREATE POLICY fx_snapshots_insert ON public.fx_rate_snapshots
    FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ═══ Configuración por par (toggles, modo Manual, tiers de comisión) ═══
CREATE TABLE IF NOT EXISTS public.fx_pair_config (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    from_currency text    NOT NULL,
    to_currency   text    NOT NULL,
    is_active     boolean NOT NULL DEFAULT true,
    manual_mode   boolean NOT NULL DEFAULT false,
    tiers         jsonb,
    base_fee_pct  numeric,   -- comisión editable (Finity USD/COP la usa; incluye IVA)
    updated_by    text,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (from_currency, to_currency)
);
-- Idempotente para proyectos donde la tabla ya existía sin la columna:
ALTER TABLE public.fx_pair_config ADD COLUMN IF NOT EXISTS base_fee_pct numeric;

ALTER TABLE public.fx_pair_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fx_pair_config_read ON public.fx_pair_config;
CREATE POLICY fx_pair_config_read ON public.fx_pair_config
    FOR SELECT TO anon, authenticated USING (true);
-- Escritura también para anon: la app de empresas usa auth PROPIA y llama
-- con la anon key (mismo modelo que el resto de tablas de la app).
DROP POLICY IF EXISTS fx_pair_config_write ON public.fx_pair_config;
CREATE POLICY fx_pair_config_write ON public.fx_pair_config
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ═══ Configuración global (ventana nocturna) ═══
CREATE TABLE IF NOT EXISTS public.fx_global_config (
    id               int PRIMARY KEY,
    night_enabled    boolean NOT NULL DEFAULT false,
    night_start_hour int     NOT NULL DEFAULT 22,
    night_end_hour   int     NOT NULL DEFAULT 6,
    night_extra_pct  numeric NOT NULL DEFAULT 0,
    timezone         text    NOT NULL DEFAULT 'America/Bogota',
    updated_by       text,
    updated_at       timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.fx_global_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.fx_global_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fx_global_read ON public.fx_global_config;
CREATE POLICY fx_global_read ON public.fx_global_config
    FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS fx_global_write ON public.fx_global_config;
CREATE POLICY fx_global_write ON public.fx_global_config
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ═══ Estado del sync (fuente preferida, salud) ═══
CREATE TABLE IF NOT EXISTS public.xe_config (
    id                   int PRIMARY KEY,
    preferred_source     text NOT NULL DEFAULT 'FASTFOREX',
    fallback_enabled     boolean NOT NULL DEFAULT true,
    last_sync_at         timestamptz,
    last_error           text,
    last_error_at        timestamptz,
    consecutive_failures int NOT NULL DEFAULT 0
);
INSERT INTO public.xe_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.xe_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS xe_config_read ON public.xe_config;
CREATE POLICY xe_config_read ON public.xe_config
    FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS xe_config_write ON public.xe_config;
CREATE POLICY xe_config_write ON public.xe_config
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ═══ Vista de salud que consume el panel ═══
CREATE OR REPLACE VIEW public.fx_health_dashboard AS
SELECT
    c.preferred_source,
    c.last_sync_at,
    c.last_error,
    c.last_error_at,
    c.consecutive_failures,
    c.fallback_enabled,
    (SELECT count(*) FROM public.fx_rate_snapshots s
      WHERE s.source = 'FASTFOREX' AND s.captured_at > now() - interval '24 hours') AS ff_snapshots_24h,
    (SELECT count(*) FROM public.fx_rate_snapshots s
      WHERE s.source = 'MANUAL' AND s.captured_at > now() - interval '24 hours') AS manual_snapshots_24h
FROM public.xe_config c
WHERE c.id = 1;

GRANT SELECT ON public.fx_health_dashboard TO anon, authenticated;

-- ═══ RPC stub de sync (el panel lo llama; acá el feed real es el cron) ═══
CREATE OR REPLACE FUNCTION public.sync_xe_rates_now()
RETURNS jsonb
LANGUAGE sql
AS $$ SELECT jsonb_build_object('success', true, 'cached', true) $$;
GRANT EXECUTE ON FUNCTION public.sync_xe_rates_now() TO anon, authenticated;

-- ═══ Programación cada 5 minutos (opción pg_cron) ═══
-- Requiere habilitar las extensiones pg_cron y pg_net:
--   Dashboard → Database → Extensions → habilitar "pg_cron" y "pg_net".
-- Luego DESCOMENTAR y ajustar <PROJECT-REF> y <CRON_SECRET>:
--
-- SELECT cron.schedule(
--     'fastforex-sync-5min',
--     '*/5 * * * *',
--     $$
--     SELECT net.http_post(
--         url := 'https://<PROJECT-REF>.supabase.co/functions/v1/fastforex-sync?key=<CRON_SECRET>',
--         headers := '{"Content-Type":"application/json"}'::jsonb,
--         body := '{}'::jsonb
--     );
--     $$
-- );
--
-- Para verificar:   SELECT * FROM cron.job;
-- Para eliminar:    SELECT cron.unschedule('fastforex-sync-5min');

NOTIFY pgrst, 'reload schema';
