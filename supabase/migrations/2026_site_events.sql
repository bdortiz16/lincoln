-- ───────────────────────────────────────────────────────
-- 2026_site_events.sql
--
-- Analítica liviana del sitio: la landing y las páginas estáticas
-- insertan un evento por vista (page, referrer) y actualizan
-- duration_seconds al salir (visibilitychange/unmount). El admin lo
-- ve en Soporte → Analíticas del sitio.
-- ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.site_events (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    page             text NOT NULL,
    referrer         text,
    duration_seconds integer,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_events_created_idx ON public.site_events (created_at DESC);
CREATE INDEX IF NOT EXISTS site_events_page_idx    ON public.site_events (page, created_at DESC);

ALTER TABLE public.site_events ENABLE ROW LEVEL SECURITY;

-- Visitantes (anónimos) pueden registrar su vista y actualizar la duración
DROP POLICY IF EXISTS site_events_insert ON public.site_events;
CREATE POLICY site_events_insert ON public.site_events
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS site_events_update ON public.site_events;
CREATE POLICY site_events_update ON public.site_events
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Solo usuarios autenticados (el admin) pueden LEER las métricas
DROP POLICY IF EXISTS site_events_read ON public.site_events;
CREATE POLICY site_events_read ON public.site_events
    FOR SELECT TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';
