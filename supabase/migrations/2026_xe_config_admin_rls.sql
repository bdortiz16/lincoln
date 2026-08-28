-- ════════════════════════════════════════════════════════
-- xe_config: dar permiso de escritura a super_admin / treasury
-- y crear el RPC fx_set_preferred_source como fallback.
--
-- Contexto del bug:
--   El admin web (/admin-personas → Tesorería → Tasas FX) elige una
--   "Fuente preferida" (CURRENCYFREAKS o MANUAL) y al recargar la página
--   el dropdown vuelve al valor anterior. El UI ya no falla silenciosamente:
--   el toast mostraba "new row violates row-level security policy for
--   table xe_config" + "Could not find the function
--   public.fx_set_preferred_source(source) in the schema cache".
--
-- Esta migración:
--   1) Agrega una policy permisiva para super_admin/treasury (no toca las
--      policies existentes — RLS las une con OR, así que la cron de
--      Antigravity sigue funcionando con su rol/service_role).
--   2) Crea el RPC fx_set_preferred_source(source) como SECURITY DEFINER
--      para el fallback del frontend (corre con permisos del owner y
--      verifica admin_role internamente).
--
-- NO toca el schema de la tabla — Antigravity es el dueño. NO inserta
-- la fila id=1 porque no conocemos todas las columnas NOT NULL; el RPC
-- la creará si no existe en el primer save.
-- ════════════════════════════════════════════════════════

-- ───── Drop firmas previas de fx_set_preferred_source ─────
-- Antigravity (o una versión anterior) ya creó la función con otra firma
-- (probablemente p_source / RETURNS BOOLEAN). CREATE OR REPLACE no puede
-- cambiar tipo de retorno, hay que dropearla primero.
DROP FUNCTION IF EXISTS public.fx_set_preferred_source(TEXT);
DROP FUNCTION IF EXISTS public.fx_set_preferred_source(VARCHAR);
DROP FUNCTION IF EXISTS public.fx_set_preferred_source();

-- ───── INSERT/UPDATE/DELETE para super_admin / treasury ─────
DROP POLICY IF EXISTS "xe_config_write_admin" ON public.xe_config;
CREATE POLICY "xe_config_write_admin"
  ON public.xe_config FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND admin_role IN ('super_admin','treasury')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND admin_role IN ('super_admin','treasury')
    )
  );

-- ───── RPC fallback usado por el admin cuando el UPSERT directo no llega ─────
CREATE OR REPLACE FUNCTION public.fx_set_preferred_source(source TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND admin_role IN ('super_admin','treasury')
  ) THEN
    RAISE EXCEPTION 'No autorizado: se requiere admin_role super_admin o treasury';
  END IF;

  UPDATE public.xe_config
     SET preferred_source = upper(source)
   WHERE id = 1;

  IF NOT FOUND THEN
    INSERT INTO public.xe_config (id, preferred_source)
    VALUES (1, upper(source));
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fx_set_preferred_source(TEXT) TO authenticated;

-- ───── Forzar reload del schema cache de PostgREST ─────
NOTIFY pgrst, 'reload schema';

-- ───── Verificación ─────
SELECT id, preferred_source FROM public.xe_config WHERE id = 1;
