CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_users_codigo_lincoin
  ON public.users ((COALESCE(NULLIF(raw_data->>'ownReferralCode', ''), upper(right(id::text, 6)))));
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON public.users ((raw_data->>'ownReferralCode'));
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (email);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users (role);
CREATE INDEX IF NOT EXISTS idx_users_kyc_status ON public.users (kyc_status) WHERE kyc_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_created_desc ON public.users (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_otc ON public.users ((raw_data->>'otcEnabled')) WHERE raw_data->>'otcEnabled' = 'true';

DO $trgm$
DECLARE s text;
BEGIN
  SELECT n.nspname INTO s FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm';
  IF s IS NOT NULL THEN
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_users_email_trgm ON public.users USING gin (email %I.gin_trgm_ops)', s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_users_nombre_trgm ON public.users USING gin (full_name %I.gin_trgm_ops)', s);
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'company_name') THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_users_empresa_trgm ON public.users USING gin (company_name %I.gin_trgm_ops)', s);
    END IF;
  END IF;
END
$trgm$;

CREATE INDEX IF NOT EXISTS idx_transactions_created ON public.transactions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON public.transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_status_created ON public.transactions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type_created ON public.transactions (type, created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_obligaciones()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $obl$
  SELECT COALESCE(jsonb_object_agg(s.k, s.total), '{}'::jsonb)
  FROM (
    SELECT b.key AS k,
           sum(
             CASE jsonb_typeof(b.value)
               WHEN 'number' THEN (b.value #>> '{}')::numeric
               WHEN 'string' THEN CASE WHEN (b.value #>> '{}') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' THEN btrim(b.value #>> '{}')::numeric ELSE 0 END
               ELSE 0
             END
           ) AS total
    FROM public.users u
    CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(u.balances) = 'object' THEN u.balances ELSE '{}'::jsonb END
      || CASE WHEN jsonb_typeof(u.crypto_balances) = 'object' THEN u.crypto_balances ELSE '{}'::jsonb END
    ) b
    WHERE COALESCE(u.role, '') <> 'admin'
    GROUP BY b.key
  ) s;
$obl$;

REVOKE ALL ON FUNCTION public.admin_obligaciones() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_obligaciones() FROM anon;
REVOKE ALL ON FUNCTION public.admin_obligaciones() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_obligaciones() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_contadores_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $cont$
  SELECT u.id FROM public.users u WHERE u.role = 'contador'
  UNION
  SELECT (c->>'id')::uuid
  FROM public.users b
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(b.raw_data->'contadores') = 'array' THEN b.raw_data->'contadores' ELSE '[]'::jsonb END
    || CASE WHEN jsonb_typeof(b.raw_data->'contadoresSolicitudes') = 'array' THEN b.raw_data->'contadoresSolicitudes' ELSE '[]'::jsonb END
  ) c
  WHERE b.role = 'business'
    AND jsonb_typeof(c) = 'object'
    AND (c->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$cont$;

REVOKE ALL ON FUNCTION public.admin_contadores_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_contadores_ids() FROM anon;
REVOKE ALL ON FUNCTION public.admin_contadores_ids() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_contadores_ids() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_buscar_usuarios(p_q text DEFAULT NULL, p_tipo text DEFAULT 'todos', p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $bus$
DECLARE
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
  v_pat text;
  v_tipo text := COALESCE(NULLIF(p_tipo, ''), 'todos');
  v_lim int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_off int := GREATEST(COALESCE(p_offset, 0), 0);
  v_ids uuid[];
  v_cont uuid[];
  v_total bigint;
  v_filas jsonb;
  v_conteos jsonb;
BEGIN
  IF v_q IS NOT NULL THEN
    v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  v_cont := ARRAY(SELECT DISTINCT x FROM public.admin_contadores_ids() x);

  WITH base AS (
    SELECT u.id, u.created_at, u.role, u.kyc_status
    FROM public.users u
    WHERE u.role IS DISTINCT FROM 'admin'
      AND (v_pat IS NULL
        OR u.email ILIKE v_pat
        OR u.full_name ILIKE v_pat
        OR u.company_name ILIKE v_pat
        OR u.id::text = lower(v_q)
        OR (u.raw_data->>'nit') ILIKE v_pat
        OR (u.raw_data->>'documentNumber') ILIKE v_pat
        OR (u.raw_data->>'docNumber') ILIKE v_pat
        OR COALESCE(NULLIF(u.raw_data->>'ownReferralCode', ''), upper(right(u.id::text, 6))) = upper(v_q))
  ),
  tipada AS (
    SELECT b.*,
      CASE WHEN b.role = 'business' THEN 'empresa'
           WHEN b.id = ANY (v_cont) THEN 'contador'
           ELSE 'persona' END AS tipo
    FROM base b
  )
  SELECT
    jsonb_build_object(
      'todos', count(*),
      'empresas', count(*) FILTER (WHERE tipo = 'empresa'),
      'personas', count(*) FILTER (WHERE tipo = 'persona'),
      'contadores', count(*) FILTER (WHERE tipo = 'contador'),
      'pendientes', count(*) FILTER (WHERE kyc_status IN ('pending', 'in_review')),
      'verificadas', count(*) FILTER (WHERE kyc_status IN ('verified', 'approved'))
    ),
    (array_agg(id ORDER BY created_at DESC NULLS LAST, id) FILTER (WHERE
      v_tipo = 'todos'
      OR (v_tipo = 'empresas' AND tipo = 'empresa')
      OR (v_tipo = 'personas' AND tipo = 'persona')
      OR (v_tipo = 'contadores' AND tipo = 'contador')
      OR (v_tipo = 'pendientes' AND kyc_status IN ('pending', 'in_review'))))
  INTO v_conteos, v_ids
  FROM tipada;

  v_total := COALESCE(array_length(v_ids, 1), 0);
  v_ids := v_ids[v_off + 1 : v_off + v_lim];

  SELECT COALESCE(jsonb_agg(
           (to_jsonb(u) - 'password_hash' - 'pin_hash' - 'two_factor_secret')
           || jsonb_build_object('_tipo', CASE WHEN u.role = 'business' THEN 'empresa' WHEN u.id = ANY (v_cont) THEN 'contador' ELSE 'persona' END)
           ORDER BY array_position(v_ids, u.id)), '[]'::jsonb)
  INTO v_filas
  FROM public.users u
  WHERE u.id = ANY (COALESCE(v_ids, '{}'::uuid[]));

  RETURN jsonb_build_object('total', v_total, 'conteos', v_conteos, 'usuarios', v_filas);
END
$bus$;

REVOKE ALL ON FUNCTION public.admin_buscar_usuarios(text, text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_buscar_usuarios(text, text, int, int) FROM anon;
REVOKE ALL ON FUNCTION public.admin_buscar_usuarios(text, text, int, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_buscar_usuarios(text, text, int, int) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_correos_duplicados()
RETURNS TABLE (email text, n bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $dup$
  SELECT lower(u.email), count(*)
  FROM public.users u
  WHERE COALESCE(u.email, '') <> ''
  GROUP BY lower(u.email)
  HAVING count(*) > 1
  ORDER BY 2 DESC, 1
  LIMIT 500;
$dup$;

REVOKE ALL ON FUNCTION public.admin_correos_duplicados() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_correos_duplicados() FROM anon;
REVOKE ALL ON FUNCTION public.admin_correos_duplicados() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_correos_duplicados() TO service_role;

ANALYZE public.users;
ANALYZE public.transactions;

NOTIFY pgrst, 'reload schema';
