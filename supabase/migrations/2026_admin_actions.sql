-- ════════════════════════════════════════════════════════
--  admin_actions — el rastro de lo que pasa con el proveedor ACH.
--
--  POR QUE FALTABA
--    finity-proxy y finity-webhook escriben acá cada evento del proveedor
--    (aprobaciones, rechazos, cambios de estado de una orden de retiro). La
--    tabla nunca se creó en el proyecto de Lincoin, y como esas escrituras son
--    best-effort —envueltas en try/catch para no tumbar la operación— el
--    error se registra en un log que caduca y nadie lo ve.
--
--    O sea: las operaciones funcionan, y no queda constancia de ninguna. El
--    día que haya que reconstruir qué dijo Finity y cuándo, no hay con qué.
--
--  NO ES LO MISMO QUE audit_log
--    audit_log guarda lo que hace un admin (quién borró una cuenta, quién
--    cambió una configuración). Esto guarda lo que dice un PROVEEDOR. Se
--    separan porque se consultan por motivos distintos: uno para responderle
--    a una persona, el otro para responderle a un banco.
-- ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.admin_actions (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- Quién. Para los webhooks del proveedor no hay persona: admin_id va NULL y
  -- admin_email lleva el nombre de la función ('finity-webhook').
  admin_id    uuid,
  admin_email text,
  admin_role  text,

  action      text NOT NULL,
  target_type text,
  target_id   text,

  -- El evento completo del proveedor. Es la prueba: si su formato cambia, el
  -- crudo sigue diciendo qué mandaron.
  metadata    jsonb
);

CREATE INDEX IF NOT EXISTS admin_actions_created_idx
  ON public.admin_actions (created_at DESC);

-- Para buscar todo lo que pasó con una orden puntual.
CREATE INDEX IF NOT EXISTS admin_actions_target_idx
  ON public.admin_actions (target_type, target_id);

ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;

-- Acá adentro hay montos, cuentas y nombres de clientes. No lo lee el navegador.
REVOKE ALL ON public.admin_actions FROM anon, authenticated, PUBLIC;
REVOKE ALL ON SEQUENCE public.admin_actions_id_seq FROM anon, authenticated, PUBLIC;

-- service_role saltea RLS pero NO los GRANT de tabla: sin esto, las edge
-- functions no la ven y el rastro se sigue perdiendo en silencio.
GRANT ALL ON public.admin_actions TO service_role;
GRANT ALL ON SEQUENCE public.admin_actions_id_seq TO service_role;
