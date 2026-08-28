-- ════════════════════════════════════════════════════════
-- Los contactos inscritos (raw_data.finityContacts) desaparecían al
-- recargar: el candado users_sensitive_cols_guard bloqueaba TODA
-- escritura de raw_data para usuarios no-admin, así que el guardado
-- fallaba en silencio (la app lo mostraba en memoria y la base nunca
-- lo recibía).
--
-- raw_data guarda datos que el PROPIO usuario debe poder escribir
-- (contactos, preferencias). Lo verdaderamente sensible que vivía ahí
-- (tatumAddresses, tatumHdIndex, tatumCredited) lo escriben las edge
-- functions con service role, que no pasan por este candado.
--
-- Este script re-crea el candado SIN raw_data en la lista sensible.
-- Las columnas críticas (role, balances, kyc_status, etc.) siguen
-- protegidas igual.
-- ════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.guard_users_sensitive_cols()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  sensitive TEXT[] := ARRAY[
    'role',
    'admin_role',
    'kyc_status',
    'kyc_verified_at',
    'balances',
    'crypto_balances',
    'is_blocked',
    'assigned_currency',
    'didit_session_id'
  ];
  col TEXT;
  old_val TEXT;
  new_val TEXT;
BEGIN
  -- Service role / sin sesión: dejamos pasar (edge functions ya validan).
  IF caller IS NULL THEN
    RETURN NEW;
  END IF;
  -- Admin: dejamos pasar.
  IF public.is_any_admin() THEN
    RETURN NEW;
  END IF;
  -- Usuario común: chequear cada col sensible.
  FOREACH col IN ARRAY sensitive LOOP
    old_val := to_jsonb(OLD) ->> col;
    new_val := to_jsonb(NEW) ->> col;
    IF old_val IS DISTINCT FROM new_val THEN
      RAISE EXCEPTION 'Cannot change column "%" (sensitive, admin-only)', col
        USING HINT = 'Use edge function or contact compliance';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS users_sensitive_cols_guard ON public.users;
CREATE TRIGGER users_sensitive_cols_guard
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_users_sensitive_cols();
