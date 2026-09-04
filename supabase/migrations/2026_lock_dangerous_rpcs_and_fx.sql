-- ============================================================
-- Cierre de huecos CRÍTICOS del pentest (RPCs SECURITY DEFINER abiertos a
-- anon + tablas FX escribibles por cualquiera). Idempotente.
--
--   C2  cuypay_save_profile: escribía role/balances/kyc de CUALQUIER usuario
--       sin verificar dueño, y estaba GRANTeada a anon → auto-crédito / admin.
--       No la usa el cliente → se ELIMINA.
--   H1  cuypay_get_all_users / cuypay_get_all_transactions: dumpeaban TODA la
--       base (incluye totpSecret, passwordHash, PII) a anon. Se REVOCAN de
--       anon/authenticated (el cliente ya lee solo SU propia fila).
--   C3  fx_rate_snapshots: cualquiera insertaba tasas falsas que alimentaban
--       apply_conversion → acuñar COP. Se bloquea el INSERT a solo admin
--       (service_role sigue insertando porque ignora RLS).
--   L3/L4  next_gasfree_index / sync_xe_rates_now / fx_*_config: se quitan de
--       anon; la config FX queda editable solo por admin.
-- ============================================================

-- is_any_admin (idempotente, por si el hardening RLS aún no corrió).
CREATE OR REPLACE FUNCTION public.is_any_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND ( u.role = 'admin'
            OR COALESCE(NULLIF(to_jsonb(u) ->> 'admin_role', ''), NULL) IS NOT NULL )
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_any_admin() TO authenticated, anon;

-- C2 — eliminar el RPC de escritura arbitraria (no lo usa el cliente).
DROP FUNCTION IF EXISTS public.cuypay_save_profile(TEXT, JSONB);

-- H1 — quitar a anon/authenticated los dumps completos (fugan 2FA/PII).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='cuypay_get_all_users') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.cuypay_get_all_users() FROM anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='cuypay_get_all_transactions') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.cuypay_get_all_transactions() FROM anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='next_gasfree_index') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.next_gasfree_index() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='sync_xe_rates_now') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.sync_xe_rates_now() FROM anon, authenticated';
  END IF;
END $$;

-- C3 — bloquear escritura anónima de tasas (feed de apply_conversion).
-- Se borran AMBOS nombres (viejo y nuevo) para que sea re-ejecutable.
DROP POLICY IF EXISTS fx_snapshots_insert ON public.fx_rate_snapshots;
DROP POLICY IF EXISTS fx_snapshots_insert_admin ON public.fx_rate_snapshots;
CREATE POLICY fx_snapshots_insert_admin ON public.fx_rate_snapshots
  FOR INSERT TO authenticated WITH CHECK (public.is_any_admin());

-- L4 — config FX editable solo por admin (lectura sigue pública para mostrar
-- tasas; los reads no filtran secretos).
DROP POLICY IF EXISTS fx_pair_config_write ON public.fx_pair_config;
DROP POLICY IF EXISTS fx_pair_config_write_admin ON public.fx_pair_config;
CREATE POLICY fx_pair_config_write_admin ON public.fx_pair_config
  FOR ALL TO authenticated USING (public.is_any_admin()) WITH CHECK (public.is_any_admin());

DROP POLICY IF EXISTS fx_global_write ON public.fx_global_config;
DROP POLICY IF EXISTS fx_global_write_admin ON public.fx_global_config;
CREATE POLICY fx_global_write_admin ON public.fx_global_config
  FOR ALL TO authenticated USING (public.is_any_admin()) WITH CHECK (public.is_any_admin());

DROP POLICY IF EXISTS xe_config_write ON public.xe_config;
DROP POLICY IF EXISTS xe_config_write_admin ON public.xe_config;
CREATE POLICY xe_config_write_admin ON public.xe_config
  FOR ALL TO authenticated USING (public.is_any_admin()) WITH CHECK (public.is_any_admin());

-- ── Segunda ronda del pentest ────────────────────────────────────────────
-- #2 cuypay_p2p_transfer: SECURITY DEFINER, GRANTeada a anon, escribía el
--    objeto `balances` COMPLETO que mandara el cliente sobre CUALQUIER uuid,
--    sin verificar dueño → acuñar/robar saldo con solo la anon key. Huérfana
--    (el cliente usa cuypay_transfer). Se ELIMINA en todas sus firmas.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig FROM pg_proc
    WHERE proname = 'cuypay_p2p_transfer' AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig::text;
  END LOOP;
END $$;

-- #5 _credit_user_balance: helper SECURITY DEFINER sin chequeo de admin. Por
--    defecto Postgres da EXECUTE a PUBLIC → cualquiera con la anon key acreditaba
--    saldo. Solo lo usan los wrappers (que corren como owner) → se revoca de
--    PUBLIC/anon/authenticated por completo.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig FROM pg_proc
    WHERE proname = '_credit_user_balance' AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || r.sig::text || ' FROM PUBLIC, anon, authenticated';
  END LOOP;
  -- treasury_apply_movement: quitar solo de anon/PUBLIC (por si un flujo admin
  -- autenticado lo usa; nunca debe estar abierto a anónimos).
  FOR r IN
    SELECT oid::regprocedure AS sig FROM pg_proc
    WHERE proname = 'treasury_apply_movement' AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION ' || r.sig::text || ' FROM PUBLIC, anon';
  END LOOP;
END $$;
