-- ════════════════════════════════════════════════════════
-- F6: ESCALA
-- - Vista materializada para stats del Overview
-- - Índices GIN para búsqueda de usuarios
-- - Índices BTREE para queries comunes
-- ════════════════════════════════════════════════════════

-- ───── 1. Vista materializada de stats globales ─────
DROP MATERIALIZED VIEW IF EXISTS public.admin_overview_stats CASCADE;
CREATE MATERIALIZED VIEW public.admin_overview_stats AS
SELECT
    (SELECT COUNT(*) FROM public.users)                                       AS total_users,
    (SELECT COUNT(*) FROM public.users WHERE kyc_status = 'pending')          AS pending_kyc,
    (SELECT COUNT(*) FROM public.users WHERE kyc_status = 'verified')         AS verified_users,
    (SELECT COUNT(*) FROM public.transactions WHERE status = 'pending')       AS pending_tx,
    (SELECT COUNT(*) FROM public.transactions WHERE status = 'completed')     AS completed_tx,
    (SELECT COALESCE(SUM(from_amount), 0) FROM public.transactions WHERE status = 'completed')  AS total_volume,
    (SELECT COUNT(*) FROM public.compliance_alerts WHERE status = 'open')     AS open_alerts,
    NOW()                                                                     AS computed_at;

CREATE UNIQUE INDEX ON public.admin_overview_stats ((1));  -- una sola fila

-- ───── 2. Función para refrescar la vista ─────
CREATE OR REPLACE FUNCTION public.refresh_admin_overview_stats()
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_overview_stats;
$$;

-- Permite que los admins llamen el refresh (vía RPC)
GRANT EXECUTE ON FUNCTION public.refresh_admin_overview_stats() TO authenticated;

-- ───── 3. Índices para queries del admin ─────
-- Búsqueda full-text en usuarios (GIN)
CREATE INDEX IF NOT EXISTS idx_users_search ON public.users
    USING GIN (to_tsvector('simple',
        COALESCE(full_name, '') || ' ' ||
        COALESCE(email, '') || ' ' ||
        COALESCE(cuypay_id, '')
    ));

-- Filtros frecuentes
CREATE INDEX IF NOT EXISTS idx_users_created_desc ON public.users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_kyc_status ON public.users(kyc_status) WHERE kyc_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_admin_role ON public.users(admin_role) WHERE admin_role IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_status_created ON public.transactions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON public.transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_currency ON public.transactions(from_currency, created_at DESC) WHERE status IN ('approved', 'completed');

-- ───── 4. Refresh inicial ─────
REFRESH MATERIALIZED VIEW public.admin_overview_stats;

-- ───── 5. Función helper de búsqueda paginada ─────
CREATE OR REPLACE FUNCTION public.search_users_paginated(
    p_search TEXT DEFAULT NULL,
    p_kyc_status TEXT DEFAULT NULL,
    p_limit INT DEFAULT 50,
    p_offset INT DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    email TEXT,
    full_name TEXT,
    cuypay_id TEXT,
    country TEXT,
    flag TEXT,
    kyc_status TEXT,
    created_at TIMESTAMPTZ,
    total_count BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    WITH filtered AS (
        SELECT u.*
        FROM public.users u
        WHERE (p_search IS NULL OR p_search = '' OR
            to_tsvector('simple',
                COALESCE(u.full_name, '') || ' ' ||
                COALESCE(u.email, '') || ' ' ||
                COALESCE(u.cuypay_id, '')
            ) @@ plainto_tsquery('simple', p_search))
          AND (p_kyc_status IS NULL OR u.kyc_status = p_kyc_status)
          AND public.is_any_admin()
    ),
    total AS (SELECT COUNT(*) AS c FROM filtered)
    SELECT
        f.id, f.email, f.full_name, f.cuypay_id, f.country, f.flag,
        f.kyc_status, f.created_at, total.c
    FROM filtered f, total
    ORDER BY f.created_at DESC
    LIMIT p_limit OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION public.search_users_paginated TO authenticated;
