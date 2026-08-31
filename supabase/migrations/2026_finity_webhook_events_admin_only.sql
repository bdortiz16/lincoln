-- ───────────────────────────────────────────────────────
-- 2026_finity_webhook_events_admin_only.sql
--
-- SEGURIDAD (auditoría de divulgación · M1): la tabla de auditoría de
-- webhooks de Finity guarda payloads y headers completos (datos de
-- cuentas, montos, PII). La policy anterior permitía LECTURA a `anon` y
-- `authenticated` (`USING (true)`), de modo que cualquiera con la anon
-- key podía leer TODOS los eventos. Nadie en el cliente consulta esta
-- tabla directamente; solo es un registro para operaciones internas.
--
-- Se restringe la lectura a administradores (`is_any_admin()`). La
-- escritura sigue siendo exclusiva del service role (la edge
-- finity-webhook), sin policy de INSERT para anon/authenticated.
--
-- Pegar en el SQL Editor del proyecto de EMPRESAS. Idempotente.
-- ───────────────────────────────────────────────────────

ALTER TABLE public.finity_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finity_webhook_events_read ON public.finity_webhook_events;
CREATE POLICY finity_webhook_events_read ON public.finity_webhook_events
    FOR SELECT TO authenticated USING (public.is_any_admin());

NOTIFY pgrst, 'reload schema';
