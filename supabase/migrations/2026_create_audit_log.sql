-- ════════════════════════════════════════════════════════════════════
-- 2026_create_audit_log.sql
--
-- LA TABLA audit_log NUNCA EXISTIÓ. Seis edge functions le escriben
-- (admin-data, gasfree, mouv-proxy, user-login, admin-login, delete-self)
-- y todas envuelven el insert en un try/catch que se traga el error "para
-- no romper la operación real". El efecto: cada escritura fallaba en
-- silencio y NO había registro de nada.
--
-- Lo que estaba roto por esto, sin que se notara:
--
--   • El registro de auditoría del panel salía vacío — no porque no
--     pasara nada, sino porque no había dónde guardarlo.
--   • El bloqueo automático de IPs CONTABA los intentos fallidos leyendo
--     esta tabla. Sin tabla, la cuenta siempre daba 0 y jamás bloqueaba.
--   • El freno de fuerza bruta de user-login / admin-login: igual, 0.
--   • El historial de accesos, los incidentes y la rotación de llaves.
--   • La investigación de "quién cambió la wallet del proveedor" no podía
--     dar con nada: no había registro que consultar.
--
-- Crear la tabla enciende todo eso de golpe. No hay que tocar el código.
--
-- Pegar en el SQL Editor. Idempotente.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- SIN clave foránea a users a propósito: aquí también se registra el
  -- borrado de una cuenta, y el rastro tiene que sobrevivir a la fila que
  -- lo originó. Un FK haría fallar el borrado o se llevaría el registro.
  user_id     uuid,
  action      text NOT NULL,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Las consultas del panel son "lo más reciente" y "por tipo de acción".
CREATE INDEX IF NOT EXISTS audit_log_created_idx        ON public.audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_created_idx ON public.audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_user_idx           ON public.audit_log (user_id);
-- El conteo de intentos fallidos filtra por metadata->>'ip'.
CREATE INDEX IF NOT EXISTS audit_log_ip_idx             ON public.audit_log ((metadata ->> 'ip'));

-- RLS ENCENDIDA Y SIN POLÍTICAS: nadie llega directo desde el navegador.
-- El service_role (las edge functions) se salta la RLS, y el panel lee a
-- través de admin-data, que ya exige sesión de admin. Un registro de
-- auditoría legible por los clientes sería una fuga: lleva correos, IPs y
-- ubicaciones de todo el mundo.
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.audit_log FROM anon;
REVOKE ALL ON public.audit_log FROM authenticated;
GRANT ALL ON public.audit_log TO service_role;

NOTIFY pgrst, 'reload schema';

-- Comprobación: debe devolver la tabla con rowsecurity = true.
SELECT c.relname AS tabla, c.relrowsecurity AS rls_encendida
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'audit_log';
