-- ============================================================================
-- KYT — direcciones monitoreadas y alertas
-- ============================================================================
--
-- Una consulta puntual sirve para el momento en que se hace. El riesgo de una
-- direccion CAMBIA: la que hoy esta limpia manana aparece con exposicion a un
-- mixer. Por eso hace falta guardar las direcciones que le importan a cada
-- empresa y volver a consultarlas.
--
-- DOS TABLAS, a proposito:
--
--   kyt_watchlist  · que direcciones vigila CADA empresa, con su alias. Es por
--                    empresa porque el alias y el interes son suyos: la misma
--                    direccion puede ser "Proveedor Shenzhen" para una y
--                    "Cliente mayorista" para otra.
--
--   kyt_alerts     · el historial de CAMBIOS de banda de riesgo. Va aparte y no
--                    como un campo de la fila: un historial que se sobreescribe
--                    no es un historial. Hace falta poder decir cuando subio,
--                    de cuanto a cuanto y si se aviso -- eso es lo que se mira
--                    despues, cuando hay que explicar por que se opero con una
--                    direccion que ya estaba senalada.
--
-- El VEREDICTO sigue viviendo en kyt_registry, compartido entre empresas: el
-- riesgo es de la direccion, no de quien la vigila. Estas dos tablas solo
-- dicen quien vigila que, y que cambio.
--
-- Solo las escribe el servidor (service_role). Con GRANT explicito: el
-- service_role se salta la RLS pero NO los permisos de tabla, y sin el grant
-- PostgREST deja la tabla fuera de su cache y responde "no existe".
-- ============================================================================

-- ── Columnas nuevas del padron ──────────────────────────────────────────────
-- Actividad y exposicion vienen de OTROS endpoints del proveedor
-- (address_overview y address_action), no del de riesgo. Se guardan junto al
-- veredicto para no volver a pagarlos en cada vista.
ALTER TABLE public.kyt_registry ADD COLUMN IF NOT EXISTS actividad  jsonb;
ALTER TABLE public.kyt_registry ADD COLUMN IF NOT EXISTS exposicion jsonb;
-- perfil: plataformas con las que interactuo y eventos maliciosos (address_trace).
-- hacking_event: el incidente de seguridad asociado, que lo devuelve el propio
-- endpoint de riesgo y no se estaba leyendo.
ALTER TABLE public.kyt_registry ADD COLUMN IF NOT EXISTS perfil        jsonb;
ALTER TABLE public.kyt_registry ADD COLUMN IF NOT EXISTS hacking_event text;


-- ── Direcciones que vigila cada empresa ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kyt_watchlist (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL,
  coin            text        NOT NULL,
  address_lower   text        NOT NULL,
  address         text        NOT NULL,
  alias           text,

  -- Como estaba CUANDO SE GUARDO. Es la referencia contra la que se compara:
  -- sin esto no se puede decir "subio de 34 a 61", solo "hoy esta en 61".
  score_inicial   integer,
  nivel_inicial   text,
  banda_inicial   text,                       -- alto | medio | bajo | sin_dato

  -- Ultima revision.
  score_actual    integer,
  nivel_actual    text,
  banda_actual    text,
  revisado_at     timestamptz,

  -- Cambio de banda pendiente de que el dueno lo vea.
  subio           boolean     DEFAULT false,
  subio_at        timestamptz,
  motivo_cambio   text,
  aviso_enviado   boolean     DEFAULT false,

  activo          boolean     DEFAULT true,   -- false = dejo de monitorear
  created_at      timestamptz DEFAULT now(),

  -- Una empresa no vigila dos veces la misma direccion en la misma red.
  UNIQUE (user_id, coin, address_lower)
);

CREATE INDEX IF NOT EXISTS kyt_watchlist_user_idx     ON public.kyt_watchlist (user_id) WHERE activo;
-- El trabajo de las rondas es "las que llevan mas tiempo sin revisar primero".
CREATE INDEX IF NOT EXISTS kyt_watchlist_revisado_idx ON public.kyt_watchlist (revisado_at NULLS FIRST) WHERE activo;

ALTER TABLE public.kyt_watchlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kyt_watchlist FROM anon, authenticated;
GRANT ALL ON public.kyt_watchlist TO service_role;


-- ── Historial de cambios de riesgo ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kyt_alerts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL,
  watchlist_id  uuid,
  coin          text        NOT NULL,
  address       text        NOT NULL,
  alias         text,

  score_antes   integer,
  score_despues integer,
  banda_antes   text,
  banda_despues text,
  motivo        text,
  -- true = la banda EMPEORO. Se guarda calculado y no se deduce al leer:
  -- la escala del proveedor puede cambiar, y un historial tiene que seguir
  -- diciendo lo que se entendio EN SU MOMENTO.
  empeoro       boolean     DEFAULT true,

  aviso_enviado boolean     DEFAULT false,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kyt_alerts_user_idx ON public.kyt_alerts (user_id, created_at DESC);

ALTER TABLE public.kyt_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kyt_alerts FROM anon, authenticated;
GRANT ALL ON public.kyt_alerts TO service_role;


DO $limpia_pol_kyt2$
DECLARE p record;
BEGIN
  FOR p IN SELECT tablename, policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename IN ('kyt_watchlist', 'kyt_alerts') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END;
$limpia_pol_kyt2$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Comprobacion APARTE, en otra pestana (pegada aca, un error revierte el DDL):
--
--   SELECT
--     EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='kyt_watchlist') AS watchlist,
--     EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='kyt_alerts')    AS alerts,
--     EXISTS (SELECT 1 FROM information_schema.columns
--             WHERE table_schema='public' AND table_name='kyt_registry' AND column_name='actividad') AS col_actividad,
--     NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
--                 WHERE table_schema='public' AND table_name IN ('kyt_watchlist','kyt_alerts')
--                   AND grantee IN ('anon','authenticated','PUBLIC')) AS cerradas_al_cliente;
-- ============================================================================
