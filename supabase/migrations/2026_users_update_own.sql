-- ════════════════════════════════════════════════════════
-- Los contactos se borraban al recargar: a public.users le faltaba la
-- política RLS de UPDATE de la propia fila. El guardado del cliente
-- (raw_data.finityContacts) se descartaba en silencio.
--
-- Este script es ADITIVO e idempotente: solo agrega las políticas que
-- falten, no toca las existentes. El candado guard_users_sensitive_cols
-- (ya instalado) sigue impidiendo que un usuario cambie su rol, saldos
-- o KYC — aquí solo se le permite editar su propia fila dentro de esas
-- reglas.
-- ════════════════════════════════════════════════════════

DO $$ BEGIN
  EXECUTE 'ALTER TABLE public.users ENABLE ROW LEVEL SECURITY';

  -- UPDATE de la propia fila (o admin)
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='users'
                   AND policyname='users_update_own_or_admin') THEN
    EXECUTE $p$CREATE POLICY users_update_own_or_admin ON public.users
      FOR UPDATE TO authenticated
      USING (id::text = auth.uid()::text OR public.is_any_admin())
      WITH CHECK (id::text = auth.uid()::text OR public.is_any_admin())$p$;
  END IF;

  -- SELECT de la propia fila (o admin) — por si tampoco existe
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='users'
                   AND policyname='users_select_own_or_admin') THEN
    EXECUTE $p$CREATE POLICY users_select_own_or_admin ON public.users
      FOR SELECT TO authenticated
      USING (id::text = auth.uid()::text OR public.is_any_admin())$p$;
  END IF;

  -- INSERT de la propia fila (registro de cuentas nuevas)
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='users'
                   AND policyname='users_insert_own') THEN
    EXECUTE $p$CREATE POLICY users_insert_own ON public.users
      FOR INSERT TO authenticated
      WITH CHECK (id::text = auth.uid()::text)$p$;
  END IF;
END $$;

-- Verificación: lista TODAS las políticas de users — mándame pantallazo
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'users'
ORDER BY policyname;
