-- ============================================================================
-- KYT — padron de direcciones consultadas
-- ============================================================================
--
-- Cada consulta a MistTrack se paga. Sin padron, si INVERSIONES SAS consulta
-- una direccion y manana MEXITECH SAS consulta la misma, se paga dos veces por
-- el mismo dato. Esta tabla es el padron: UNA fila por (cadena, direccion),
-- compartida por todas las cuentas. Es el mismo criterio de Lincoin Risk, pero
-- por direccion en vez de por documento.
--
-- LA LLAVE ES (coin, address_lower), NO la direccion sola:
--   · La misma cadena de caracteres puede existir en varias cadenas y no es la
--     misma direccion ni tiene el mismo riesgo.
--   · address_lower es la direccion en minusculas, y es lo que se compara. En
--     EVM el mismo address llega escrito con mayusculas distintas (checksum
--     EIP-55) y serian filas separadas para la misma direccion. Se guarda
--     TAMBIEN la forma original en `address` para mostrarla como la escribio
--     quien consulto.
--   · OJO: en Bitcoin, Tron y Solana las mayusculas SI distinguen. Bajar a
--     minusculas para comparar es correcto igual: dos formas distintas de la
--     misma direccion no existen ahi, asi que la normalizacion no junta cosas
--     que no deba.
--
-- QUE GUARDA Y QUE NO:
--   · SI: el veredicto sobre la direccion (puntaje, nivel, hallazgos,
--     etiquetas, enlace al reporte). Eso es de la direccion y no cambia segun
--     quien pregunte.
--   · NO: nada del cliente que consulto, mas alla de `empresas` -- que lleva
--     quien la consulto y cuando, porque hace falta para poder nombrar al
--     reportante si esto alimenta un reporte, aunque la consulta se haya
--     reutilizado.
--
-- SIN RESULTADO NO ES LIMPIA. `estado` distingue un veredicto real de una
-- consulta que no se pudo completar. Una fila en `sin_resultado` no vale como
-- "la direccion esta limpia" y no se reutiliza para ahorrar: se vuelve a
-- consultar. Es el mismo principio del AML de esta app.
--
-- Solo la escribe el servidor (service_role). El panel y el cliente la leen
-- por la edge function, nunca directo.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.kyt_registry (
  coin              text        NOT NULL,
  address_lower     text        NOT NULL,
  address           text        NOT NULL,

  -- Veredicto
  risk_score        integer,                    -- 3 a 100 segun MistTrack
  risk_level        text,                       -- Severe | High | Moderate | Low ...
  risk_detail       jsonb       DEFAULT '[]'::jsonb,
  detail_list       jsonb       DEFAULT '[]'::jsonb,
  labels            jsonb       DEFAULT '[]'::jsonb,
  report_url        text,
  estado            text        DEFAULT 'finalizado',  -- finalizado | sin_resultado | procesando
  respuesta_cruda   jsonb,                      -- para diagnostico: que respondio el proveedor

  -- Trazabilidad
  consultado_at     timestamptz DEFAULT now(),  -- cuando se PAGO la consulta
  actualizado_at    timestamptz DEFAULT now(),
  fuente            text        DEFAULT 'misttrack',

  -- Uso y ahorro
  veces_consultado  integer     DEFAULT 1,      -- consultas pagadas sobre esta direccion
  veces_reutilizado integer     DEFAULT 0,      -- consultas AHORRADAS
  empresas          jsonb       DEFAULT '[]'::jsonb,

  PRIMARY KEY (coin, address_lower)
);

CREATE INDEX IF NOT EXISTS kyt_registry_actualizado_idx ON public.kyt_registry (actualizado_at DESC);
CREATE INDEX IF NOT EXISTS kyt_registry_nivel_idx       ON public.kyt_registry (risk_level);

-- Deny-all para el cliente.
ALTER TABLE public.kyt_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kyt_registry FROM anon, authenticated;

-- Y EL PERMISO PARA EL SERVIDOR, EXPLICITO.
--
-- El service_role se salta la RLS pero NO los permisos de tabla, y las edge
-- functions pasan por PostgREST, que arma su cache de esquema solo con las
-- tablas que algun rol puede tocar. Sin este grant la tabla queda fuera de la
-- cache y el error no dice "no tienes permiso" sino "no existe" -- que manda a
-- correr otra vez una migracion ya corrida. Pasó con risk_registry.
GRANT ALL ON public.kyt_registry TO service_role;

DO $limpia_pol_kyt$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'kyt_registry' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.kyt_registry', p.policyname);
  END LOOP;
END;
$limpia_pol_kyt$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- La comprobacion va APARTE, en otra pestana. Pegada aca seria peligrosa: el
-- editor de Supabase corre todo el script en una sola transaccion, asi que un
-- error en la consulta de comprobacion revierte tambien el DDL que si funciono.
--
--   SELECT
--     EXISTS (SELECT 1 FROM pg_tables
--             WHERE schemaname = 'public' AND tablename = 'kyt_registry') AS tabla,
--     EXISTS (SELECT 1 FROM information_schema.role_table_grants
--             WHERE table_schema = 'public' AND table_name = 'kyt_registry'
--               AND grantee = 'service_role') AS servidor_puede,
--     NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
--                 WHERE table_schema = 'public' AND table_name = 'kyt_registry'
--                   AND grantee IN ('anon','authenticated','PUBLIC')) AS cerrada_al_cliente;
-- ============================================================================
