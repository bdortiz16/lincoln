-- ════════════════════════════════════════════════════════════════════
-- 2026_lock_system_config.sql
--
-- BLINDA la tabla system_config para que SOLO el servidor (edge functions con
-- service_role) la pueda leer/escribir. Ahí viven cosas que el cliente jamás
-- debe tocar: el contador de índices HD, el log de wallets, la config de
-- tesorería y —desde ahora— el ALMACÉN DURABLE DEL ÍNDICE HD por usuario
-- (claves gasfree_idx_u:<id> / gasfree_idx_e:<email>).
--
-- Ese almacén durable es lo que impide que la wallet de un cliente "cambie
-- sola": aunque un write del navegador borre raw_data.gasfreeIndex, el índice
-- sobrevive aquí. Para que esa garantía sea real, la tabla NO puede ser
-- escribible desde el cliente. El service_role SALTA la RLS, así que las edge
-- functions siguen funcionando igual; anon/authenticated quedan sin acceso.
--
-- El cliente NO lee esta tabla directamente (la config pública sale por una
-- edge function desde app_config), así que activar RLS sin políticas no rompe
-- nada de la app. Idempotente.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

-- Quitar cualquier política permisiva que hubiera quedado de antes (deny-all:
-- sin políticas + RLS activa = solo service_role, que la salta, tiene acceso).
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'system_config'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.system_config', p.policyname);
  END LOOP;
END $$;

-- Revocar cualquier GRANT directo a los roles del cliente (por si el esquema
-- traía grants amplios que sortearían la RLS al no haberla).
REVOKE ALL ON public.system_config FROM anon;
REVOKE ALL ON public.system_config FROM authenticated;

NOTIFY pgrst, 'reload schema';
