-- ───────────────────────────────────────────────────────
-- 2026_finity_webhook_events.sql — Auditoría de webhooks de Finity.
-- Pegar en el SQL Editor del proyecto de EMPRESAS.
-- ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.finity_webhook_events (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type  text NOT NULL DEFAULT 'unknown',
    verified    boolean NOT NULL DEFAULT false,
    payload     jsonb NOT NULL DEFAULT '{}',
    headers     jsonb NOT NULL DEFAULT '{}',
    received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finity_webhook_events_time_idx
    ON public.finity_webhook_events (received_at DESC);

ALTER TABLE public.finity_webhook_events ENABLE ROW LEVEL SECURITY;

-- Lectura para el panel admin (la app usa anon key con auth propia).
DROP POLICY IF EXISTS finity_webhook_events_read ON public.finity_webhook_events;
CREATE POLICY finity_webhook_events_read ON public.finity_webhook_events
    FOR SELECT TO anon, authenticated USING (true);

-- Escribe solo el service role (la edge finity-webhook) — sin policy de
-- INSERT para anon/authenticated.

NOTIFY pgrst, 'reload schema';
