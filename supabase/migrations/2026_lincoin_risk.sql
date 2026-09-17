-- ============================================================================
-- LINCOIN RISK — el padron central de consultas de antecedentes
-- ============================================================================
--
-- Cada consulta a TusDatos cuesta 1.400 COP. Hoy el veredicto se guarda dentro
-- de raw_data del usuario que lo pidio, asi que si INVERSIONES SAS consulta a
-- Juan Perez y manana MEXITECH SAS inscribe al mismo Juan Perez, se paga otra
-- vez por exactamente el mismo dato.
--
-- Esta tabla es el padron: UNA fila por documento, compartida por todas las
-- cuentas. Antes de gastar un credito se mira aca.
--
-- POR DOCUMENTO, NUNCA POR NOMBRE. Dos personas se llaman igual y una misma
-- persona se escribe de cinco formas; el documento es lo unico que identifica.
--
-- QUE GUARDA Y QUE NO:
--   · SI: los antecedentes de la persona (categoria, hallazgos, vigencia del
--     documento, el nombre REAL segun la Registraduria). Eso es de la persona
--     y no cambia segun quien pregunte.
--   · NO: si el nombre que escribio el cliente coincide. Eso es de CADA
--     inscripcion — INVERSIONES pudo escribirlo bien y MEXITECH mal — y se
--     sigue calculando por beneficiario contra el nombre real de aca.
--
-- MONITOREO: TusDatos avisa cuando alguien que estaba limpio aparece en una
-- lista. Esa alerta actualiza ESTA fila, y desde aca baja a todas las cuentas
-- que tengan a esa persona inscrita. Antes cada cuenta se enteraba por su lado
-- (o no se enteraba).
--
-- Solo la escribe el servidor (service_role). El panel la lee por la edge
-- function, nunca directo.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.risk_registry (
  doc_type            text        NOT NULL DEFAULT 'CC',
  doc_number          text        NOT NULL,

  -- Identidad segun la fuente oficial
  nombre_real         text,
  documento_vigente   boolean,
  estado_documento    text,

  -- Veredicto
  categoria           text,        -- alto | medio | bajo | ninguno | informativo | sin_validar
  operable            boolean,     -- NULL = sin veredicto (no es lo mismo que "no")
  estado              text,        -- finalizado | procesando | sin_autorizacion | ...
  altos               integer      DEFAULT 0,
  medios              integer      DEFAULT 0,
  bajos               integer      DEFAULT 0,
  hallazgos           jsonb        DEFAULT '[]'::jsonb,
  codigos             jsonb        DEFAULT '[]'::jsonb,
  fuentes_con_error   jsonb        DEFAULT '[]'::jsonb,

  -- Trazabilidad de la consulta que produjo esto
  report_id           text,
  job_id              text,
  consultado_at       timestamptz  DEFAULT now(),   -- cuando se PAGO la consulta
  actualizado_at      timestamptz  DEFAULT now(),   -- ultimo cambio (incluye monitoreo)
  fuente              text         DEFAULT 'tusdatos',  -- tusdatos | monitoreo | manual

  -- Uso y ahorro. `empresas` lleva quien ha usado esta ficha: hace falta para
  -- un reporte a la UIAF, donde hay que poder nombrar al reportante aunque la
  -- consulta se haya reutilizado.
  veces_consultado    integer      DEFAULT 1,       -- creditos gastados en este documento
  veces_reutilizado   integer      DEFAULT 0,       -- creditos AHORRADOS
  empresas            jsonb        DEFAULT '[]'::jsonb,

  PRIMARY KEY (doc_type, doc_number)
);

-- Busquedas del panel: por documento (ya es la llave) y por fecha.
CREATE INDEX IF NOT EXISTS risk_registry_actualizado_idx ON public.risk_registry (actualizado_at DESC);
CREATE INDEX IF NOT EXISTS risk_registry_categoria_idx   ON public.risk_registry (categoria);

-- Deny-all: esta tabla tiene antecedentes judiciales de personas reales. Solo
-- el service_role (las edge functions) la toca; el panel pasa por ellas.
ALTER TABLE public.risk_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.risk_registry FROM anon, authenticated;

-- Y EL PERMISO PARA EL SERVIDOR, QUE HAY QUE DARLO EXPLICITAMENTE.
--
-- El service_role se salta la RLS, pero NO se salta los permisos de tabla. Y
-- las edge functions no hablan con Postgres directo: pasan por PostgREST, que
-- arma su cache de esquema solo con las tablas que algun rol puede tocar. Sin
-- este grant la tabla queda fuera de la cache y la respuesta no es "no tienes
-- permiso" sino "Could not find the table public.risk_registry in the schema
-- cache" -- que se lee como si la migracion no se hubiera corrido, cuando la
-- tabla esta ahi.
GRANT ALL ON public.risk_registry TO service_role;

DO $limpia_pol$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'risk_registry' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.risk_registry', p.policyname);
  END LOOP;
END;
$limpia_pol$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- La comprobacion esta en 2026_zz_verificacion.sql y se corre APARTE. Pegada
-- aca abajo seria peligrosa: el editor de Supabase corre todo el script en una
-- sola transaccion, asi que un error en la consulta de comprobacion revierte
-- tambien el DDL que si habia funcionado.
-- ============================================================================
