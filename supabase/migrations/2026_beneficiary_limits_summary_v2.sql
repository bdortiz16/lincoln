-- ───────────────────────────────────────────────────────
-- 2026_beneficiary_limits_summary_v2.sql
--
-- get_beneficiary_limits_summary(p_beneficiary_id) v2 — contrato que
-- consume la app iOS para las barras de cupo dentro de cada Contacto:
--
--   daily_limit / monthly_limit / daily_used / monthly_used  (numeric)
--
-- Además devuelve daily_max / monthly_max (alias que ya usa el panel
-- admin), currency, *_pct, is_custom_* y owner_user_id — un solo RPC
-- para ambos frontends.
--
-- Lógica:
--   • used = ENVÍOS completados hacia ese beneficiario (se excluye
--     kind='load'), día calendario actual y mes calendario actual,
--     cada monto convertido a la moneda del tope vía to_currency().
--   • máximos = topes custom del contacto (beneficiaries) si existen;
--     si no, app_settings 'operational_limits'; si no, 800/6000 USD.
--   • La columna que enlaza transactions→beneficiario varía por
--     entorno: se detecta (beneficiary_id / receiver_beneficiary_id /
--     to_beneficiary_id / contact_id). Si no hay ninguna, used=0 pero
--     los topes SÍ se devuelven (la barra sale vacía, no rota).
-- ───────────────────────────────────────────────────────

-- Topes custom en beneficiaries (por si faltan en este entorno)
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS custom_daily_limit   numeric;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS custom_monthly_limit numeric;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS limits_currency      text;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS is_custom_daily      boolean DEFAULT false;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS is_custom_monthly    boolean DEFAULT false;

-- DROP previo por si la versión deployada tiene otro tipo de retorno (42P13)
DROP FUNCTION IF EXISTS public.get_beneficiary_limits_summary(uuid);

CREATE FUNCTION public.get_beneficiary_limits_summary(p_beneficiary_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_custom_d numeric; v_custom_m numeric; v_ben_curr text; v_global jsonb;
    v_flag_d boolean; v_flag_m boolean;
    v_eff_daily numeric; v_eff_monthly numeric; v_eff_currency text;
    v_used_d numeric := 0; v_used_m numeric := 0;
    v_caller_role text; v_owner_id uuid; v_ben_col text;
BEGIN
    IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error','not_authenticated'); END IF;

    SELECT admin_role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    SELECT owner_user_id INTO v_owner_id FROM public.beneficiaries WHERE id = p_beneficiary_id;
    IF v_owner_id IS NULL THEN RETURN jsonb_build_object('error','beneficiary_not_found'); END IF;
    IF auth.uid() <> v_owner_id
       AND COALESCE(v_caller_role,'') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error','forbidden');
    END IF;

    SELECT custom_daily_limit, custom_monthly_limit, limits_currency,
           COALESCE(is_custom_daily, false), COALESCE(is_custom_monthly, false)
    INTO v_custom_d, v_custom_m, v_ben_curr, v_flag_d, v_flag_m
    FROM public.beneficiaries WHERE id = p_beneficiary_id;

    v_flag_d := v_flag_d OR (v_custom_d IS NOT NULL);
    v_flag_m := v_flag_m OR (v_custom_m IS NOT NULL);

    SELECT value INTO v_global FROM public.app_settings WHERE key = 'operational_limits';

    v_eff_daily    := CASE WHEN v_flag_d AND v_custom_d IS NOT NULL THEN v_custom_d
                           ELSE COALESCE((v_global->>'daily')::numeric,   800) END;
    v_eff_monthly  := CASE WHEN v_flag_m AND v_custom_m IS NOT NULL THEN v_custom_m
                           ELSE COALESCE((v_global->>'monthly')::numeric, 6000) END;
    v_eff_currency := COALESCE(v_ben_curr, v_global->>'currency', 'USD');

    -- Detectar cómo se llama la columna de beneficiario en transactions
    SELECT column_name INTO v_ben_col
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions'
      AND column_name IN ('beneficiary_id','receiver_beneficiary_id','to_beneficiary_id','contact_id')
    ORDER BY array_position(ARRAY['beneficiary_id','receiver_beneficiary_id','to_beneficiary_id','contact_id'], column_name)
    LIMIT 1;

    -- ENVÍOS completados hacia el contacto (excluye cargas), día y mes
    -- calendario actuales, convertidos a la moneda del tope.
    IF v_ben_col IS NOT NULL THEN
        BEGIN
            EXECUTE format(
                'SELECT
                    COALESCE(SUM(CASE WHEN created_at >= date_trunc(''day'', now())
                        THEN public.to_currency(COALESCE(amount,0), COALESCE(currency, $2), $2) ELSE 0 END), 0),
                    COALESCE(SUM(public.to_currency(COALESCE(amount,0), COALESCE(currency, $2), $2)), 0)
                 FROM public.transactions
                 WHERE %I = $1
                   AND created_at >= date_trunc(''month'', now())
                   AND COALESCE(kind, '''') <> ''load''
                   AND status IN (''completed'',''approved'',''sent'',''success'')',
                v_ben_col)
            INTO v_used_d, v_used_m
            USING p_beneficiary_id, v_eff_currency;
        EXCEPTION WHEN OTHERS THEN
            v_used_d := 0; v_used_m := 0;
        END;
    END IF;

    RETURN jsonb_build_object(
        -- Contrato iOS
        'daily_limit',       v_eff_daily,
        'monthly_limit',     v_eff_monthly,
        'daily_used',        ROUND(v_used_d::numeric, 2),
        'monthly_used',      ROUND(v_used_m::numeric, 2),
        -- Alias que ya consume el panel admin
        'daily_max',         v_eff_daily,
        'monthly_max',       v_eff_monthly,
        'currency',          v_eff_currency,
        'daily_pct',         CASE WHEN v_eff_daily   > 0 THEN ROUND((v_used_d / v_eff_daily   * 100)::numeric, 2) ELSE 0 END,
        'monthly_pct',       CASE WHEN v_eff_monthly > 0 THEN ROUND((v_used_m / v_eff_monthly * 100)::numeric, 2) ELSE 0 END,
        'is_custom_daily',   v_flag_d,
        'is_custom_monthly', v_flag_m,
        'owner_user_id',     v_owner_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_beneficiary_limits_summary(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
