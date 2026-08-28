-- ───────────────────────────────────────────────────────
-- 2026_admin_list_user_transactions.sql
--
-- RPC para que el admin liste los movimientos recientes de un
-- usuario (combobox de "Transacción asociada" en Compliance →
-- Documentación). SECURITY DEFINER así no depende de la RLS de
-- transactions ni de que el cliente adivine el nombre de la
-- columna del dueño.
--
-- Ajustá 'user_id' en el WHERE si tu schema usa otra columna
-- (owner_user_id / sender_id).
-- ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_list_user_transactions(p_user_id uuid, p_limit int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role text;
    v_out  jsonb;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;
    SELECT admin_role INTO v_role FROM public.users WHERE id = auth.uid();
    IF COALESCE(v_role, '') NOT IN ('super_admin', 'compliance', 'treasury', 'support', 'audit') THEN
        RETURN jsonb_build_object('error', 'forbidden');
    END IF;

    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) INTO v_out
    FROM (
        SELECT id, kind, amount, currency, status, created_at
        FROM public.transactions
        WHERE user_id = p_user_id
        ORDER BY created_at DESC
        LIMIT LEAST(GREATEST(p_limit, 1), 100)
    ) t;

    RETURN jsonb_build_object('ok', true, 'transactions', v_out);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_user_transactions(uuid, int) TO authenticated;
