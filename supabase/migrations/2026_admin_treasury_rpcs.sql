-- ───────────────────────────────────────────────────────
-- 2026_admin_treasury_rpcs.sql
--
-- Aprobación/rechazo de cargas y retiros desde el ADMIN de empresas.
-- El panel lo hacía con updates directos desde el navegador y RLS los
-- bloqueaba EN SILENCIO (el toast decía "aprobado" pero nada persistía).
-- Estos RPCs SECURITY DEFINER hacen la operación completa (saldo + estado)
-- validando que quien llama sea un admin real (users.role='admin' o
-- admin_role asignado).
--
-- Pegar completo en el SQL Editor del proyecto.
-- ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_ok boolean := false;
BEGIN
    IF auth.uid() IS NULL THEN RETURN false; END IF;
    BEGIN
        SELECT (role = 'admin' OR admin_role IS NOT NULL) INTO v_ok
        FROM public.users WHERE id = auth.uid();
    EXCEPTION WHEN undefined_column THEN
        BEGIN
            SELECT (role = 'admin') INTO v_ok FROM public.users WHERE id = auth.uid();
        EXCEPTION WHEN undefined_column THEN v_ok := false;
        END;
    END;
    RETURN COALESCE(v_ok, false);
END;
$$;

-- Suma un monto a la key de moneda dentro del jsonb de balances correcto
-- (crypto va a crypto_balances; fiat a balances — mismo split del front).
CREATE OR REPLACE FUNCTION public._credit_user_balance(p_user_id uuid, p_currency text, p_amount numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_is_crypto boolean := p_currency ~ '^(USDT|USDC|BTC|ETH|SOL|MATIC|BNB|TRX)';
BEGIN
    IF v_is_crypto THEN
        UPDATE public.users
        SET crypto_balances = jsonb_set(
            COALESCE(crypto_balances, '{}'::jsonb),
            ARRAY[p_currency],
            to_jsonb(COALESCE((crypto_balances->>p_currency)::numeric, 0) + p_amount)
        )
        WHERE id = p_user_id;
    ELSE
        UPDATE public.users
        SET balances = jsonb_set(
            COALESCE(balances, '{}'::jsonb),
            ARRAY[p_currency],
            to_jsonb(COALESCE((balances->>p_currency)::numeric, 0) + p_amount)
        )
        WHERE id = p_user_id;
    END IF;
END;
$$;

-- ═══ Aprobar carga: acredita saldo + marca Completado ═══
CREATE OR REPLACE FUNCTION public.admin_approve_deposit(p_tx_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tx record;
BEGIN
    IF NOT public.is_app_admin() THEN RETURN jsonb_build_object('error','forbidden'); END IF;

    SELECT * INTO v_tx FROM public.transactions WHERE id = p_tx_id FOR UPDATE;
    IF v_tx IS NULL THEN RETURN jsonb_build_object('error','tx_not_found'); END IF;
    IF v_tx.status = 'Completado' THEN RETURN jsonb_build_object('error','already_completed'); END IF;

    PERFORM public._credit_user_balance(v_tx.user_id, v_tx.currency, v_tx.amount::numeric);
    UPDATE public.transactions SET status = 'Completado' WHERE id = p_tx_id;

    RETURN jsonb_build_object('ok', true);
END;
$$;

-- ═══ Rechazar carga: solo estado ═══
CREATE OR REPLACE FUNCTION public.admin_reject_deposit(p_tx_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NOT public.is_app_admin() THEN RETURN jsonb_build_object('error','forbidden'); END IF;
    UPDATE public.transactions SET status = 'Rechazado' WHERE id = p_tx_id;
    RETURN jsonb_build_object('ok', true);
END;
$$;

-- ═══ Completar retiro: solo estado (el saldo se debitó al solicitar) ═══
CREATE OR REPLACE FUNCTION public.admin_complete_withdrawal(p_tx_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NOT public.is_app_admin() THEN RETURN jsonb_build_object('error','forbidden'); END IF;
    UPDATE public.transactions SET status = 'Completado' WHERE id = p_tx_id;
    RETURN jsonb_build_object('ok', true);
END;
$$;

-- ═══ Rechazar retiro: devuelve los fondos + estado ═══
CREATE OR REPLACE FUNCTION public.admin_reject_withdrawal(p_tx_id bigint, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_tx record;
BEGIN
    IF NOT public.is_app_admin() THEN RETURN jsonb_build_object('error','forbidden'); END IF;

    SELECT * INTO v_tx FROM public.transactions WHERE id = p_tx_id FOR UPDATE;
    IF v_tx IS NULL THEN RETURN jsonb_build_object('error','tx_not_found'); END IF;
    IF v_tx.status = 'Rechazado' THEN RETURN jsonb_build_object('error','already_rejected'); END IF;

    -- devolver lo debitado al solicitar el retiro
    PERFORM public._credit_user_balance(v_tx.user_id, v_tx.currency, v_tx.amount::numeric);
    UPDATE public.transactions
    SET status = 'Rechazado',
        raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object('rejectReason', COALESCE(p_reason, 'Rechazado por administración'))
    WHERE id = p_tx_id;

    RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_approve_deposit(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_reject_deposit(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_complete_withdrawal(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_reject_withdrawal(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_deposit(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_deposit(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_complete_withdrawal(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_withdrawal(bigint, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
