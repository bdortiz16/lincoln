-- ════════════════════════════════════════════════════════
--  admin_miembros — el equipo, de verdad.
--
--  LO QUE HABIA ANTES
--    Una pestaña "Gestión de Equipo" que guardaba nombres en un JSON de
--    configuración. No creaba un acceso, no restringía nada, y el rol
--    ("Soporte L1") era una etiqueta sin efecto. Se veía como control de
--    accesos y no lo era — que es peor que no tener nada, porque alguien
--    puede creer que le quitó el acceso a una persona.
--
--  COMO FUNCIONA AHORA
--    Cada miembro entra con SU PROPIA cuenta (Supabase Auth + users.role =
--    'admin'). Esta tabla dice, para esa cuenta, QUE puede hacer y SOBRE QUE
--    PAISES. El servidor lo exige en cada llamada; el navegador solo lo
--    refleja.
--
--  EL DUEÑO NO SE PUEDE QUEDAR AFUERA
--    Si una cuenta admin no tiene fila acá y su correo es el de ADMIN_EMAIL,
--    el servidor la trata como dueño con todos los países. Sin esa salvedad,
--    aplicar esta migración dejaría a todo el mundo sin acceso a nada — el
--    primer arranque no puede depender de una fila que todavía no existe.
-- ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.admin_miembros (
  -- Mismo id que la cuenta de Supabase Auth: no es un usuario aparte, es el
  -- permiso de una cuenta que ya existe.
  id            uuid PRIMARY KEY,
  email         text NOT NULL,
  nombre        text,

  -- 'dueno'        — todo, todos los países. Es el único que toca equipo,
  --                  configuración y seguridad.
  -- 'operaciones'  — cargues, OTC, tesorería, movimientos, fallos, tasas.
  -- 'cumplimiento' — KYC, riesgo, monitoreo, auditoría. Ve la plata, no la mueve.
  -- 'lectura'      — mira y no escribe nada, en ningún lado.
  rol           text NOT NULL CHECK (rol IN ('dueno', 'operaciones', 'cumplimiento', 'lectura')),

  -- Códigos ISO: 'CO', 'BR', 'MX', 'US'. Vacío = ningún país = no ve datos.
  -- Al dueño no se le miran: ve todos.
  paises        text[] NOT NULL DEFAULT '{}',

  -- Quitar el acceso sin borrar la fila, para que el historial no se pierda.
  activo        boolean NOT NULL DEFAULT true,

  creado_at     timestamptz NOT NULL DEFAULT now(),
  creado_por    uuid,
  actualizado_at timestamptz,
  ultimo_acceso_at timestamptz
);

-- Los correos no distinguen mayúsculas: sin esto, "Ana@" y "ana@" serían dos
-- miembros distintos y uno de los dos tendría permisos que nadie recuerda.
CREATE UNIQUE INDEX IF NOT EXISTS admin_miembros_email_idx
  ON public.admin_miembros (lower(email));

ALTER TABLE public.admin_miembros ENABLE ROW LEVEL SECURITY;

-- Quién puede ver qué país y con qué rol es justamente lo que no debe poder
-- leerse ni tocarse desde el navegador. Solo el backend.
REVOKE ALL ON public.admin_miembros FROM anon, authenticated, PUBLIC;

-- service_role saltea RLS pero NO los GRANT de tabla: sin esto, PostgREST ni
-- siquiera la muestra.
GRANT ALL ON public.admin_miembros TO service_role;
