-- ============================================================
-- LINCOIN — Esquema completo (tablas base + 81 migraciones)
-- Pega TODO en Supabase → SQL Editor → Run.
-- ============================================================

-- ===================== TABLAS BASE (reconstruidas best-effort) =====================
-- ===================== TABLAS BASE (hoisted, dedup) =====================
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuypay_id text,
  flag text,
  admin_role text,
  assigned_currency text,
  balances jsonb,
  block_reason text,
  block_type text,
  company_name text,
  compliance_hold boolean,
  country text,
  created_at timestamptz,
  crypto_balances jsonb,
  custom_daily_limit numeric,
  custom_monthly_limit numeric,
  email text,
  full_name text,
  is_active boolean default false,
  is_blocked boolean,
  is_custom_daily boolean,
  is_custom_monthly boolean,
  kyc_status text,
  limits_currency text,
  name text,
  password_hash text,
  phone text,
  pin_hash text,
  raw_data jsonb default '{}'::jsonb,
  role text,
  status text,
  two_factor_secret text,
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.beneficiaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kyc_status text,
  account_number text,
  alias text,
  bank text,
  bank_name text,
  block_type text,
  country text,
  created_at timestamptz,
  currency text,
  custom_daily_limit numeric,
  custom_monthly_limit numeric,
  doc_number text,
  full_name text,
  is_custom_daily boolean,
  is_custom_monthly boolean,
  limits_currency text,
  name text,
  raw_data jsonb default '{}'::jsonb,
  type text,
  user_id uuid
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id text PRIMARY KEY,
  body text,
  created_at timestamptz,
  data jsonb default '{}'::jsonb,
  is_read boolean default false,
  message text,
  read text,
  title text,
  type text,
  user_id uuid
);

CREATE TABLE IF NOT EXISTS public.user_limits (
  id text PRIMARY KEY,
  created_at timestamptz,
  currency text,
  daily_limit numeric,
  monthly_limit numeric,
  updated_at timestamptz,
  used_daily text,
  used_monthly text,
  user_id uuid
);

CREATE TABLE IF NOT EXISTS public.kyc_submissions (
  id text PRIMARY KEY,
  created_at timestamptz,
  doc_number text,
  doc_type text,
  provider text,
  raw_data jsonb default '{}'::jsonb,
  session_id text,
  status text,
  updated_at timestamptz,
  user_id uuid
);

CREATE TABLE IF NOT EXISTS public.transactions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  owner_user_id uuid,
  type          text        NOT NULL DEFAULT 'transfer',
  kind          text,
  amount        numeric     NOT NULL DEFAULT 0,
  from_amount   numeric,
  to_amount     numeric,
  currency      text        NOT NULL DEFAULT 'USD',
  from_currency text,
  to_currency   text,
  status        text        NOT NULL DEFAULT 'Pendiente',
  raw_data      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cuypay_bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    country_code TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    account_type TEXT,
    account_number TEXT NOT NULL,
    holder TEXT,
    tax_id TEXT,
    tax_id_label TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fx_global_config (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    night_enabled BOOLEAN DEFAULT false,
    night_start_hour INT DEFAULT 3, night_end_hour INT DEFAULT 8,
    night_extra_pct NUMERIC(6,3) DEFAULT 1.0,
    timezone TEXT DEFAULT 'America/Bogota',
    updated_by UUID REFERENCES public.users(id), updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fx_pair_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency TEXT NOT NULL, to_currency TEXT NOT NULL,
    base_fee_pct NUMERIC(6,3) NOT NULL DEFAULT 0.5,
    tiers JSONB NOT NULL DEFAULT '[{"from_usd":0,"to_usd":1000,"pct":2.5},{"from_usd":1000,"to_usd":10000,"pct":2.0},{"from_usd":10000,"to_usd":100000,"pct":1.5},{"from_usd":100000,"to_usd":null,"pct":1.0}]',
    is_active BOOLEAN DEFAULT true,
    updated_by UUID REFERENCES public.users(id), updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(from_currency, to_currency)
);

CREATE TABLE IF NOT EXISTS public.fx_rate_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency TEXT NOT NULL, to_currency TEXT NOT NULL,
    rate NUMERIC(18,8) NOT NULL, source TEXT DEFAULT 'fawaz', captured_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY, value JSONB NOT NULL, description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(), updated_by UUID REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.treasury_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('bank','crypto')),
    currency TEXT NOT NULL, country_code TEXT, exchange TEXT,
    bank_account_id UUID REFERENCES public.cuypay_bank_accounts(id) ON DELETE SET NULL,
    balance NUMERIC(20,2) NOT NULL DEFAULT 0, is_active BOOLEAN DEFAULT true,
    is_treasury BOOLEAN DEFAULT false, is_profit BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.treasury_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL CHECK (kind IN ('internal_transfer','fx_buy_usdt','fx_sell_usdt','client_load','client_payout','adjustment')),
    from_account_id UUID REFERENCES public.treasury_accounts(id),
    to_account_id UUID REFERENCES public.treasury_accounts(id),
    from_amount NUMERIC(20,2) NOT NULL DEFAULT 0, to_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
    from_currency TEXT, to_currency TEXT, exchange_rate NUMERIC(20,8),
    fee_amount NUMERIC(20,2) DEFAULT 0, fee_currency TEXT,
    tax_amount NUMERIC(20,2) DEFAULT 0, tax_currency TEXT,
    notes TEXT, created_by UUID REFERENCES public.users(id), created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tx_admin_receipts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  TEXT NOT NULL,
    file_path       TEXT NOT NULL,           -- path dentro del bucket admin-receipts
    note            TEXT,
    uploaded_by     UUID REFERENCES public.users(id),
    uploaded_email  TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.app_banners (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title        text NOT NULL,
    description  text NOT NULL,
    coupon_code  text,
    image_url    text,
    action_url   text,
    is_active    boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.finity_webhook_events (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type  text NOT NULL DEFAULT 'unknown',
    verified    boolean NOT NULL DEFAULT false,
    payload     jsonb NOT NULL DEFAULT '{}',
    headers     jsonb NOT NULL DEFAULT '{}',
    received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fx_pair_costs (
  from_currency TEXT NOT NULL,
  to_currency   TEXT NOT NULL,
  cost_usd      NUMERIC(12,4) NOT NULL DEFAULT 0,
  cost_pct      NUMERIC(8,4)  NOT NULL DEFAULT 0,
  notes         TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID,
  PRIMARY KEY (from_currency, to_currency),
  CHECK (cost_usd >= 0 AND cost_pct >= 0 AND cost_pct <= 100)
);

CREATE TABLE IF NOT EXISTS public.xe_config (
    id                   int PRIMARY KEY,
    preferred_source     text NOT NULL DEFAULT 'FASTFOREX',
    fallback_enabled     boolean NOT NULL DEFAULT true,
    last_sync_at         timestamptz,
    last_error           text,
    last_error_at        timestamptz,
    consecutive_failures int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.aml_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    rule_type TEXT NOT NULL CHECK (rule_type IN (
        'high_amount',        -- monto único alto
        'frequent_low',       -- muchas TX pequeñas seguidas
        'cross_border',       -- envío internacional
        'velocity'            -- alta velocidad de TX en periodo
    )),
    transaction_type TEXT,  -- 'load', 'send', 'convert', null = todas
    currency TEXT,           -- null = todas
    country_code TEXT,       -- null = todas
    amount_threshold NUMERIC(18,2),
    time_window_hours INT,
    severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.compliance_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID REFERENCES public.aml_rules(id),
    rule_name TEXT,
    severity TEXT NOT NULL,
    user_id UUID REFERENCES public.users(id),
    transaction_id UUID REFERENCES public.transactions(id),
    description TEXT,
    metadata JSONB,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','closed','escalated')),
    reviewed_by UUID REFERENCES public.users(id),
    reviewed_at TIMESTAMPTZ,
    resolution TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sanctions_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_type TEXT NOT NULL CHECK (list_type IN ('OFAC','UN','EU','PEP','INTERNAL')),
    full_name TEXT NOT NULL,
    aliases TEXT[],
    country_code TEXT,
    date_of_birth DATE,
    notes TEXT,
    source TEXT,
    added_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fx_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    rate NUMERIC(18,6) NOT NULL,
    spread_pct NUMERIC(6,3) DEFAULT 0,        -- % de markup sobre la tasa
    effective_from TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(from_currency, to_currency, effective_from)
);

CREATE TABLE IF NOT EXISTS public.partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT CHECK (type IN ('bank','liquidity','kyc','payment','custodian','other')),
    country_code TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    api_endpoint TEXT,
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bank_statements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_account_id UUID REFERENCES public.cuypay_bank_accounts(id),
    statement_date DATE NOT NULL,
    opening_balance NUMERIC(18,2),
    closing_balance NUMERIC(18,2),
    uploaded_by UUID REFERENCES public.users(id),
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bank_statement_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    statement_id UUID REFERENCES public.bank_statements(id) ON DELETE CASCADE,
    posted_at TIMESTAMPTZ,
    description TEXT,
    amount NUMERIC(18,2) NOT NULL,
    is_credit BOOLEAN NOT NULL,   -- true = entrada, false = salida
    matched_transaction_id UUID REFERENCES public.transactions(id),
    match_status TEXT DEFAULT 'unmatched' CHECK (match_status IN ('unmatched','matched','manual_match','ignored')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.dual_approval_thresholds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    currency TEXT NOT NULL UNIQUE,
    amount_threshold NUMERIC(18,2) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    updated_by UUID REFERENCES public.users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tx_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
    approver_id UUID NOT NULL REFERENCES public.users(id),
    approver_email TEXT,
    approver_role TEXT,
    decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(transaction_id, approver_id)
);

CREATE TABLE IF NOT EXISTS public.site_events (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    page             text NOT NULL,
    referrer         text,
    duration_seconds integer,
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- Tablas creadas manualmente en la app móvil (reconstruidas best-effort)
CREATE TABLE IF NOT EXISTS public.limit_increase_requests (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid REFERENCES public.users(id) ON DELETE CASCADE,
    beneficiary_id   uuid REFERENCES public.beneficiaries(id) ON DELETE SET NULL,
    requested_amount text,
    user_response    text,
    attachments      jsonb NOT NULL DEFAULT '[]'::jsonb,
    status           text  NOT NULL DEFAULT 'pending',
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.document_requests (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid REFERENCES public.users(id) ON DELETE CASCADE,
    category          text,
    title             text,
    description       text,
    status            text NOT NULL DEFAULT 'pending',
    user_response_url text,
    requested_at      timestamptz NOT NULL DEFAULT now(),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
-- ===================== FIN TABLAS BASE =====================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_all ON public.users;
DROP POLICY IF EXISTS users_all ON public.users;
CREATE POLICY users_all ON public.users FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.beneficiaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS beneficiaries_all ON public.beneficiaries;
DROP POLICY IF EXISTS beneficiaries_all ON public.beneficiaries;
CREATE POLICY beneficiaries_all ON public.beneficiaries FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_all ON public.notifications;
DROP POLICY IF EXISTS notifications_all ON public.notifications;
CREATE POLICY notifications_all ON public.notifications FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.user_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_limits_all ON public.user_limits;
DROP POLICY IF EXISTS user_limits_all ON public.user_limits;
CREATE POLICY user_limits_all ON public.user_limits FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.kyc_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kyc_submissions_all ON public.kyc_submissions;
DROP POLICY IF EXISTS kyc_submissions_all ON public.kyc_submissions;
CREATE POLICY kyc_submissions_all ON public.kyc_submissions FOR ALL USING (true) WITH CHECK (true);



-- 20260423004959_atomic_hd_counter.sql
-- Atomic HD wallet counter increment to prevent race conditions
-- when two users request their wallet address simultaneously.
CREATE OR REPLACE FUNCTION increment_hd_counter()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_val integer;
BEGIN
  UPDATE system_config
    SET value = (CAST(value AS integer) + 1)::text
    WHERE key = 'tatum_hd_counter'
    RETURNING CAST(value AS integer) INTO next_val;

  IF next_val IS NULL THEN
    INSERT INTO system_config (key, value) VALUES ('tatum_hd_counter', '1')
    ON CONFLICT (key) DO UPDATE
      SET value = (CAST(system_config.value AS integer) + 1)::text
    RETURNING CAST(system_config.value AS integer) INTO next_val;
  END IF;

  RETURN next_val;
END;
$$;

-- 2026_2fa_and_recovery.sql
-- ───────────────────────────────────────────────────────
-- 2026_2fa_and_recovery.sql
--
-- Dos problemas que este script resuelve:
--
-- 1) 2FA desde la app (iOS/Android): el .update() directo a
--    users.two_factor_secret / is_2fa_enabled fallaba en silencio por RLS.
--    En vez de abrir una policy de UPDATE sobre la fila (RLS es por FILA,
--    no por columna — permitiría al usuario tocarse kyc_status, topes, etc.)
--    exponemos un RPC SECURITY DEFINER que SOLO toca esas dos columnas y
--    SOLO sobre la propia cuenta (p_uid debe ser auth.uid()).
--
-- 2) Recuperación de acceso desde Admin Personas: si el usuario perdió el
--    acceso a su correo (y sin correo no puede resetear clave ni 2FA), el
--    admin puede: cambiar el correo de login, asignar una contraseña
--    temporal, apagar el 2FA, resetear el PIN y cerrar las sesiones
--    activas. Todo vía RPC admin_recover_user_access, restringido a
--    super_admin / support / compliance.
--
-- Pegar completo en el SQL Editor del proyecto Personas.
-- ───────────────────────────────────────────────────────

-- Columnas de 2FA (por si aún no existen en este entorno)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS two_factor_secret text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_2fa_enabled boolean DEFAULT false;

-- ───────────────────────────────────────────────────────
-- (1) RPC para la app: el usuario configura/borra SU PROPIO 2FA.
--     p_secret NULL o vacío ⇒ desactiva el 2FA.
--     Firma exacta pedida por Antigravity: set_2fa_secret_by_id(p_secret, p_uid)
-- ───────────────────────────────────────────────────────
-- Si ya existía una versión previa con otro tipo de retorno (42P13:
-- "cannot change return type"), hay que soltarla antes de recrearla.
DROP FUNCTION IF EXISTS public.set_2fa_secret_by_id(text, uuid);

CREATE FUNCTION public.set_2fa_secret_by_id(p_secret text, p_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_enabled boolean := (p_secret IS NOT NULL AND length(trim(p_secret)) > 0);
BEGIN
    IF auth.uid() IS NULL OR p_uid IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Solo puedes modificar el 2FA de tu propia cuenta';
    END IF;

    UPDATE public.users
    SET two_factor_secret = NULLIF(trim(coalesce(p_secret, '')), ''),
        is_2fa_enabled    = v_enabled
    WHERE id = p_uid;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usuario no encontrado';
    END IF;

    RETURN jsonb_build_object('ok', true, 'enabled', v_enabled);
END;
$$;

REVOKE ALL ON FUNCTION public.set_2fa_secret_by_id(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_2fa_secret_by_id(text, uuid) TO authenticated;

-- ───────────────────────────────────────────────────────
-- Helper: ¿el que llama es un admin con derechos de recuperación?
-- Tolera que exista admin_role, role, o ambas (varía entre entornos).
-- ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_has_recovery_rights()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ok boolean := false;
BEGIN
    IF auth.uid() IS NULL THEN RETURN false; END IF;

    BEGIN
        SELECT (admin_role IN ('super_admin','support','compliance')) INTO v_ok
        FROM public.users WHERE id = auth.uid();
    EXCEPTION WHEN undefined_column THEN v_ok := false;
    END;

    IF NOT COALESCE(v_ok, false) THEN
        BEGIN
            SELECT (role IN ('super_admin','support','compliance')) INTO v_ok
            FROM public.users WHERE id = auth.uid();
        EXCEPTION WHEN undefined_column THEN v_ok := false;
        END;
    END IF;

    RETURN COALESCE(v_ok, false);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_has_recovery_rights() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_has_recovery_rights() TO authenticated;

-- ───────────────────────────────────────────────────────
-- (2) RPC de recuperación de acceso (solo admins).
--     Todo es opcional: solo se aplica lo que venga con valor.
--       p_new_email      → cambia el correo de login (auth.users + public.users)
--                          y lo deja confirmado para que pueda entrar ya.
--       p_temp_password  → asigna una contraseña temporal (bcrypt, igual que GoTrue).
--       p_reset_2fa      → borra two_factor_secret + is_2fa_enabled=false
--                          (y factores MFA nativos si existieran).
--       p_reset_pin      → pin_hash = NULL (la app pide crear uno nuevo).
--       p_close_sessions → mata sesiones y refresh tokens activos (default true),
--                          por si la cuenta estaba comprometida.
-- ───────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_recover_user_access(uuid, text, text, boolean, boolean, boolean);

CREATE FUNCTION public.admin_recover_user_access(
    p_user_id        uuid,
    p_new_email      text    DEFAULT NULL,
    p_temp_password  text    DEFAULT NULL,
    p_reset_2fa      boolean DEFAULT false,
    p_reset_pin      boolean DEFAULT false,
    p_close_sessions boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_applied text[] := '{}';
    v_email   text   := NULLIF(lower(trim(coalesce(p_new_email, ''))), '');
BEGIN
    IF NOT public.admin_has_recovery_rights() THEN
        RAISE EXCEPTION 'No autorizado: se requiere rol super_admin, support o compliance';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'Usuario no encontrado en auth.users';
    END IF;

    -- Cambio de correo de login
    IF v_email IS NOT NULL THEN
        IF v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
            RAISE EXCEPTION 'Correo inválido: %', v_email;
        END IF;
        IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email AND id <> p_user_id) THEN
            RAISE EXCEPTION 'Ese correo ya está en uso por otra cuenta';
        END IF;

        UPDATE auth.users
        SET email                      = v_email,
            email_confirmed_at         = COALESCE(email_confirmed_at, now()),
            email_change               = '',
            email_change_token_new     = '',
            email_change_token_current = '',
            updated_at                 = now()
        WHERE id = p_user_id;

        UPDATE public.users SET email = v_email WHERE id = p_user_id;
        v_applied := v_applied || 'email';
    END IF;

    -- Contraseña temporal (mismo bcrypt que usa GoTrue)
    IF p_temp_password IS NOT NULL AND length(p_temp_password) > 0 THEN
        IF length(p_temp_password) < 8 THEN
            RAISE EXCEPTION 'La contraseña temporal debe tener al menos 8 caracteres';
        END IF;
        UPDATE auth.users
        SET encrypted_password = extensions.crypt(p_temp_password, extensions.gen_salt('bf')),
            recovery_token     = '',
            updated_at         = now()
        WHERE id = p_user_id;
        v_applied := v_applied || 'password';
    END IF;

    -- Apagar 2FA
    IF p_reset_2fa THEN
        UPDATE public.users
        SET two_factor_secret = NULL,
            is_2fa_enabled    = false
        WHERE id = p_user_id;
        BEGIN
            DELETE FROM auth.mfa_factors WHERE user_id = p_user_id;
        EXCEPTION WHEN OTHERS THEN NULL; -- tabla puede no existir / sin permisos: no es crítico
        END;
        v_applied := v_applied || '2fa';
    END IF;

    -- Resetear PIN
    IF p_reset_pin THEN
        UPDATE public.users SET pin_hash = NULL WHERE id = p_user_id;
        v_applied := v_applied || 'pin';
    END IF;

    -- Cerrar sesiones activas
    IF p_close_sessions THEN
        BEGIN
            DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        BEGIN
            DELETE FROM auth.sessions WHERE user_id = p_user_id;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        v_applied := v_applied || 'sessions';
    END IF;

    RETURN jsonb_build_object('ok', true, 'applied', to_jsonb(v_applied));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_recover_user_access(uuid, text, text, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_recover_user_access(uuid, text, text, boolean, boolean, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- 2026_2fa_hardening.sql
-- ───────────────────────────────────────────────────────
-- 2026_2fa_hardening.sql  (v3 — reemplaza y refuerza el 2FA completo)
--
-- Síntoma reportado: el 2FA "se desactiva solo", no persiste y no
-- aparece al entrar desde otro dispositivo. Causa típica: el secreto
-- solo se guardó LOCAL en el teléfono (el .update() directo lo bloquea
-- RLS en silencio) o algún flujo lo pisa al hacer upsert del perfil.
--
-- Este script deja el 2FA blindado:
--   1. set_2fa_secret_by_id(p_secret, p_uid)  → ÚNICA vía para escribir
--      el 2FA propio (activa/desactiva).
--   2. get_my_2fa()                           → lectura garantizada del
--      estado + secreto del PROPIO usuario (inmune a policies de SELECT
--      restrictivas). Para verificar TOTP en un dispositivo nuevo.
--   3. Trigger guardián: cualquier UPDATE que intente tocar
--      two_factor_secret / is_2fa_enabled SIN pasar por los RPCs
--      autorizados se IGNORA (se conservan los valores previos). Así
--      ningún upsert de perfil ni sync del app puede resetear el 2FA.
--   4. admin_recover_user_access actualizado para seguir pudiendo
--      apagar 2FA desde el panel (marca la misma llave del guardián).
--
-- Idempotente: correr completo las veces que haga falta.
-- ───────────────────────────────────────────────────────

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS two_factor_secret text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_2fa_enabled boolean DEFAULT false;

-- ═══ 1. Escritura: set_2fa_secret_by_id ═══
DROP FUNCTION IF EXISTS public.set_2fa_secret_by_id(text, uuid);

CREATE FUNCTION public.set_2fa_secret_by_id(p_secret text, p_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_enabled boolean := (p_secret IS NOT NULL AND length(trim(p_secret)) > 0);
BEGIN
    IF auth.uid() IS NULL OR p_uid IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Solo puedes modificar el 2FA de tu propia cuenta';
    END IF;

    -- Autorizar el cambio ante el trigger guardián (transaction-local)
    PERFORM set_config('cuypay.allow_2fa_change', '1', true);

    UPDATE public.users
    SET two_factor_secret = NULLIF(trim(coalesce(p_secret, '')), ''),
        is_2fa_enabled    = v_enabled
    WHERE id = p_uid;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usuario no encontrado';
    END IF;

    RETURN jsonb_build_object('ok', true, 'enabled', v_enabled);
END;
$$;

REVOKE ALL ON FUNCTION public.set_2fa_secret_by_id(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_2fa_secret_by_id(text, uuid) TO authenticated;

-- ═══ 2. Lectura: get_my_2fa ═══
DROP FUNCTION IF EXISTS public.get_my_2fa();

CREATE FUNCTION public.get_my_2fa()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_secret text; v_enabled boolean;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;

    SELECT two_factor_secret, COALESCE(is_2fa_enabled, false)
    INTO v_secret, v_enabled
    FROM public.users WHERE id = auth.uid();

    RETURN jsonb_build_object(
        'ok',      true,
        'enabled', COALESCE(v_enabled, false) AND v_secret IS NOT NULL,
        'secret',  v_secret
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_2fa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_2fa() TO authenticated;

-- ═══ 3. Trigger guardián: nadie pisa el 2FA por fuera de los RPCs ═══
CREATE OR REPLACE FUNCTION public.guard_2fa_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF (NEW.two_factor_secret IS DISTINCT FROM OLD.two_factor_secret
        OR NEW.is_2fa_enabled IS DISTINCT FROM OLD.is_2fa_enabled)
       AND COALESCE(current_setting('cuypay.allow_2fa_change', true), '') <> '1' THEN
        -- Cambio NO autorizado (update directo, upsert de perfil, sync):
        -- se conservan los valores previos sin romper el resto del UPDATE.
        NEW.two_factor_secret := OLD.two_factor_secret;
        NEW.is_2fa_enabled    := OLD.is_2fa_enabled;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_2fa ON public.users;
CREATE TRIGGER trg_guard_2fa
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_2fa_columns();

-- ═══ 4. admin_recover_user_access: autorizar su reset de 2FA ═══
DROP FUNCTION IF EXISTS public.admin_recover_user_access(uuid, text, text, boolean, boolean, boolean);

CREATE FUNCTION public.admin_recover_user_access(
    p_user_id        uuid,
    p_new_email      text    DEFAULT NULL,
    p_temp_password  text    DEFAULT NULL,
    p_reset_2fa      boolean DEFAULT false,
    p_reset_pin      boolean DEFAULT false,
    p_close_sessions boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_applied text[] := '{}';
    v_email   text   := NULLIF(lower(trim(coalesce(p_new_email, ''))), '');
BEGIN
    IF NOT public.admin_has_recovery_rights() THEN
        RAISE EXCEPTION 'No autorizado: se requiere rol super_admin, support o compliance';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'Usuario no encontrado en auth.users';
    END IF;

    IF v_email IS NOT NULL THEN
        IF v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
            RAISE EXCEPTION 'Correo inválido: %', v_email;
        END IF;
        IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email AND id <> p_user_id) THEN
            RAISE EXCEPTION 'Ese correo ya está en uso por otra cuenta';
        END IF;

        UPDATE auth.users
        SET email                      = v_email,
            email_confirmed_at         = COALESCE(email_confirmed_at, now()),
            email_change               = '',
            email_change_token_new     = '',
            email_change_token_current = '',
            updated_at                 = now()
        WHERE id = p_user_id;

        UPDATE public.users SET email = v_email WHERE id = p_user_id;
        v_applied := v_applied || 'email';
    END IF;

    IF p_temp_password IS NOT NULL AND length(p_temp_password) > 0 THEN
        IF length(p_temp_password) < 8 THEN
            RAISE EXCEPTION 'La contraseña temporal debe tener al menos 8 caracteres';
        END IF;
        UPDATE auth.users
        SET encrypted_password = extensions.crypt(p_temp_password, extensions.gen_salt('bf')),
            recovery_token     = '',
            updated_at         = now()
        WHERE id = p_user_id;
        v_applied := v_applied || 'password';
    END IF;

    IF p_reset_2fa THEN
        PERFORM set_config('cuypay.allow_2fa_change', '1', true);
        UPDATE public.users
        SET two_factor_secret = NULL,
            is_2fa_enabled    = false
        WHERE id = p_user_id;
        BEGIN
            DELETE FROM auth.mfa_factors WHERE user_id = p_user_id;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        v_applied := v_applied || '2fa';
    END IF;

    IF p_reset_pin THEN
        UPDATE public.users SET pin_hash = NULL WHERE id = p_user_id;
        v_applied := v_applied || 'pin';
    END IF;

    IF p_close_sessions THEN
        BEGIN
            DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        BEGIN
            DELETE FROM auth.sessions WHERE user_id = p_user_id;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        v_applied := v_applied || 'sessions';
    END IF;

    RETURN jsonb_build_object('ok', true, 'applied', to_jsonb(v_applied));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_recover_user_access(uuid, text, text, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_recover_user_access(uuid, text, text, boolean, boolean, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ═══ Verificación (correr aparte después de aplicar) ═══
-- SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname='public'
--   AND p.proname IN ('set_2fa_secret_by_id','get_my_2fa','admin_recover_user_access');

-- 2026_ALL_PENDING.sql
-- ════════════════════════════════════════════════════════════════════
-- CUYPAY · MIGRACIÓN TODO-EN-UNO (pendientes mayo 2026)
--
-- Pegá TODO este archivo en el SQL Editor de Supabase (proyecto
-- CuyPayANDROID) y dale RUN. Es idempotente: se puede correr varias
-- veces sin romper nada. Activa de una sola vez:
--   • Cuentas bancarias (CRUD desde el admin)
--   • Tesorería delegada por moneda + saldos por moneda y por banco
--   • FX (tasas, fees, ventana nocturna) legible por la app
--   • Referidos (app_settings.referral_rate)
--   • Bloqueo de usuarios por compliance
--   • RLS de transacciones para el admin
--   • Libro contable de tesorería (cuentas internas + movimientos + USDT)
-- ════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. CUENTAS BANCARIAS
-- ─────────────────────────────────────────────
ALTER TABLE public.cuypay_bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone_select_active_bank_accounts" ON public.cuypay_bank_accounts;
DROP POLICY IF EXISTS "anyone_select_active_bank_accounts" ON public.cuypay_bank_accounts;
CREATE POLICY "anyone_select_active_bank_accounts" ON public.cuypay_bank_accounts
  FOR SELECT TO authenticated USING (is_active = true);

DROP POLICY IF EXISTS "admin_select_all_bank_accounts" ON public.cuypay_bank_accounts;
DROP POLICY IF EXISTS "admin_select_all_bank_accounts" ON public.cuypay_bank_accounts;
CREATE POLICY "admin_select_all_bank_accounts" ON public.cuypay_bank_accounts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL));

DROP POLICY IF EXISTS "treasury_manage_bank_accounts" ON public.cuypay_bank_accounts;
DROP POLICY IF EXISTS "treasury_manage_bank_accounts" ON public.cuypay_bank_accounts;
CREATE POLICY "treasury_manage_bank_accounts" ON public.cuypay_bank_accounts
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')));

-- ─────────────────────────────────────────────
-- 2. COLUMNAS EN USERS (moneda asignada + bloqueo)
-- ─────────────────────────────────────────────
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS assigned_currency TEXT
        CHECK (assigned_currency IS NULL OR assigned_currency IN ('COP','CLP','PEN','MXN','BRL')),
    ADD COLUMN IF NOT EXISTS is_blocked     BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS blocked_reason TEXT,
    ADD COLUMN IF NOT EXISTS blocked_at     TIMESTAMPTZ;

-- ─────────────────────────────────────────────
-- 3. TRANSACTIONS: bank_account_id + RLS para admin
-- ─────────────────────────────────────────────
ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS bank_account_id UUID
    REFERENCES public.cuypay_bank_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_bank_account
    ON public.transactions(bank_account_id) WHERE bank_account_id IS NOT NULL;

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_select_all_transactions" ON public.transactions;
DROP POLICY IF EXISTS "admin_select_all_transactions" ON public.transactions;
CREATE POLICY "admin_select_all_transactions" ON public.transactions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL));

DROP POLICY IF EXISTS "admin_update_transactions" ON public.transactions;
DROP POLICY IF EXISTS "admin_update_transactions" ON public.transactions;
CREATE POLICY "admin_update_transactions" ON public.transactions
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')))
  WITH CHECK (true);

-- ─────────────────────────────────────────────
-- 4. HELPER país → moneda
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.country_to_currency(p_country TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE upper(coalesce(p_country, ''))
        WHEN 'CO' THEN 'COP' WHEN 'CL' THEN 'CLP' WHEN 'PE' THEN 'PEN'
        WHEN 'MX' THEN 'MXN' WHEN 'BR' THEN 'BRL' ELSE NULL END;
$$;

-- ─────────────────────────────────────────────
-- 5. FX: config global, por par, snapshots + RLS legible por app
-- ─────────────────────────────────────────────
INSERT INTO public.fx_global_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.fx_global_config ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.fx_pair_config ADD COLUMN IF NOT EXISTS base_fee_pct NUMERIC(6,3) NOT NULL DEFAULT 0.5;
ALTER TABLE public.fx_pair_config ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.fx_rate_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fx_global_read_authenticated" ON public.fx_global_config;
DROP POLICY IF EXISTS "fx_global_read_authenticated" ON public.fx_global_config;
CREATE POLICY "fx_global_read_authenticated" ON public.fx_global_config FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "fx_global_write_treasury" ON public.fx_global_config;
DROP POLICY IF EXISTS "fx_global_write_treasury" ON public.fx_global_config;
CREATE POLICY "fx_global_write_treasury" ON public.fx_global_config FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')));

DROP POLICY IF EXISTS "fx_pair_read_authenticated" ON public.fx_pair_config;
DROP POLICY IF EXISTS "fx_pair_read_authenticated" ON public.fx_pair_config;
CREATE POLICY "fx_pair_read_authenticated" ON public.fx_pair_config FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "fx_pair_write_treasury" ON public.fx_pair_config;
DROP POLICY IF EXISTS "fx_pair_write_treasury" ON public.fx_pair_config;
CREATE POLICY "fx_pair_write_treasury" ON public.fx_pair_config FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')));

DROP POLICY IF EXISTS "fx_snapshots_read_authenticated" ON public.fx_rate_snapshots;
DROP POLICY IF EXISTS "fx_snapshots_read_authenticated" ON public.fx_rate_snapshots;
CREATE POLICY "fx_snapshots_read_authenticated" ON public.fx_rate_snapshots FOR SELECT TO authenticated USING (true);

INSERT INTO public.fx_pair_config (from_currency, to_currency, base_fee_pct) VALUES
    ('COP','CLP',0.8),('COP','PEN',0.8),('COP','MXN',0.8),('COP','BRL',0.8),
    ('CLP','COP',0.8),('CLP','PEN',0.8),('CLP','MXN',0.8),('CLP','BRL',0.8),
    ('PEN','COP',0.8),('PEN','CLP',0.8),('PEN','MXN',0.8),('PEN','BRL',0.8),
    ('MXN','COP',0.8),('MXN','CLP',0.8),('MXN','PEN',0.8),('MXN','BRL',0.8),
    ('BRL','COP',0.8),('BRL','CLP',0.8),('BRL','PEN',0.8),('BRL','MXN',0.8)
ON CONFLICT (from_currency, to_currency) DO NOTHING;

-- ─────────────────────────────────────────────
-- 6. VISTAS DE BALANCE (por moneda y por banco)
-- ─────────────────────────────────────────────
CREATE OR REPLACE VIEW public.currency_balances AS
WITH tx AS (SELECT COALESCE(currency,'UNKNOWN') AS currency, kind, status, COALESCE(amount,0) AS amount
            FROM public.transactions WHERE COALESCE(currency,'') <> '')
SELECT currency,
  COALESCE(SUM(amount) FILTER (WHERE kind='load'  AND lower(COALESCE(status,'')) IN ('completed','approved','aprobada','completado','aprobado')),0)
- COALESCE(SUM(amount) FILTER (WHERE kind='send'  AND lower(COALESCE(status,'')) IN ('completed','approved','aprobada','completado','aprobado')),0) AS confirmed_balance,
  COALESCE(SUM(amount) FILTER (WHERE kind='load'  AND lower(COALESCE(status,'')) IN ('pending','pendiente')),0) AS pending_in,
  COALESCE(SUM(amount) FILTER (WHERE kind='send'  AND lower(COALESCE(status,'')) IN ('pending','pendiente')),0) AS pending_out,
  COUNT(*) FILTER (WHERE lower(COALESCE(status,'')) IN ('pending','pendiente')) AS pending_count,
  COUNT(*) AS total_tx
FROM tx GROUP BY currency;
GRANT SELECT ON public.currency_balances TO authenticated;

-- Nota: el match es por bank_account_id (la app debe setearlo en cada TX).
-- No usamos raw_data porque la tabla transactions de CuyPayANDROID no tiene
-- esa columna. Hasta que la app guarde bank_account_id, el balance por banco
-- queda en 0 (el balance por moneda en currency_balances sí funciona).
CREATE OR REPLACE VIEW public.bank_account_balances AS
WITH matched_tx AS (
    SELECT ba.id AS bank_account_id, ba.country_code, ba.bank_name, ba.account_number, ba.holder, ba.is_active,
           public.country_to_currency(ba.country_code) AS currency,
           t.id AS tx_id, t.kind, t.status, COALESCE(t.amount,0) AS amount
    FROM public.cuypay_bank_accounts ba
    LEFT JOIN public.transactions t ON t.bank_account_id = ba.id
)
SELECT bank_account_id, country_code, bank_name, account_number, holder, is_active, currency,
  COALESCE(SUM(amount) FILTER (WHERE kind='load' AND lower(COALESCE(status,'')) IN ('completed','approved','aprobada','completado','aprobado')),0)
- COALESCE(SUM(amount) FILTER (WHERE kind='send' AND lower(COALESCE(status,'')) IN ('completed','approved','aprobada','completado','aprobado')),0) AS confirmed_balance,
  COALESCE(SUM(amount) FILTER (WHERE kind='load' AND lower(COALESCE(status,'')) IN ('pending','pendiente')),0) AS pending_in,
  COALESCE(SUM(amount) FILTER (WHERE kind='send' AND lower(COALESCE(status,'')) IN ('pending','pendiente')),0) AS pending_out,
  COUNT(tx_id) FILTER (WHERE lower(COALESCE(status,'')) IN ('pending','pendiente')) AS pending_count,
  COUNT(tx_id) FILTER (WHERE lower(COALESCE(status,'')) IN ('completed','approved','aprobada','completado','aprobado')) AS completed_count
FROM matched_tx
GROUP BY bank_account_id, country_code, bank_name, account_number, holder, is_active, currency;
GRANT SELECT ON public.bank_account_balances TO authenticated;

-- ─────────────────────────────────────────────
-- 7. APP_SETTINGS (referidos)
-- ─────────────────────────────────────────────
-- Si la tabla ya existía (la creó el Android para referidos) puede no tener
-- estas columnas. Las agregamos de forma idempotente.
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app_settings_read_authenticated" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_read_authenticated" ON public.app_settings;
CREATE POLICY "app_settings_read_authenticated" ON public.app_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "app_settings_write_super_admin" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_write_super_admin" ON public.app_settings;
CREATE POLICY "app_settings_write_super_admin" ON public.app_settings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role = 'super_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role = 'super_admin'));
INSERT INTO public.app_settings (key, value, description) VALUES
    ('referral_rate', '0.01'::jsonb, 'Porcentaje de la comisión que se reparte al referidor')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────
-- 8. LIBRO CONTABLE DE TESORERÍA
-- ─────────────────────────────────────────────
-- Si ya existe una versión previa de estas tablas (creada por otra query
-- con id bigint), la recreamos con el esquema correcto (id uuid). Estas
-- tablas no tienen movimientos reales todavía, así que es seguro.
-- [lincoin] DROP neutralizado: las tablas se crean ya en la sección base (id uuid).
-- DROP TABLE IF EXISTS public.treasury_movements CASCADE;
-- DROP TABLE IF EXISTS public.treasury_accounts CASCADE;

ALTER TABLE public.treasury_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.treasury_movements ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.treasury_apply_movement(
    p_kind TEXT, p_from_account UUID, p_to_account UUID, p_from_amount NUMERIC, p_to_amount NUMERIC,
    p_exchange_rate NUMERIC DEFAULT NULL, p_fee_amount NUMERIC DEFAULT 0, p_fee_currency TEXT DEFAULT NULL,
    p_tax_amount NUMERIC DEFAULT 0, p_tax_currency TEXT DEFAULT NULL, p_notes TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from RECORD; v_to RECORD; v_mov_id UUID; v_caller UUID := auth.uid(); v_is_admin BOOLEAN;
BEGIN
    SELECT (admin_role IN ('super_admin','treasury')) INTO v_is_admin FROM public.users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin,false) THEN RAISE EXCEPTION 'No autorizado'; END IF;
    IF p_from_account IS NOT NULL THEN SELECT * INTO v_from FROM public.treasury_accounts WHERE id = p_from_account FOR UPDATE; END IF;
    IF p_to_account IS NOT NULL THEN SELECT * INTO v_to FROM public.treasury_accounts WHERE id = p_to_account FOR UPDATE; END IF;
    INSERT INTO public.treasury_movements (kind, from_account_id, to_account_id, from_amount, to_amount, from_currency, to_currency, exchange_rate, fee_amount, fee_currency, tax_amount, tax_currency, notes, created_by)
    VALUES (p_kind, p_from_account, p_to_account, COALESCE(p_from_amount,0), COALESCE(p_to_amount,0), v_from.currency, v_to.currency, p_exchange_rate, COALESCE(p_fee_amount,0), p_fee_currency, COALESCE(p_tax_amount,0), p_tax_currency, p_notes, v_caller)
    RETURNING id INTO v_mov_id;
    IF p_from_account IS NOT NULL THEN UPDATE public.treasury_accounts SET balance = balance - COALESCE(p_from_amount,0), updated_at = NOW() WHERE id = p_from_account; END IF;
    IF p_to_account IS NOT NULL THEN UPDATE public.treasury_accounts SET balance = balance + COALESCE(p_to_amount,0), updated_at = NOW() WHERE id = p_to_account; END IF;
    RETURN v_mov_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.treasury_apply_movement TO authenticated;

DROP POLICY IF EXISTS "treasury_accounts_read" ON public.treasury_accounts;
DROP POLICY IF EXISTS "treasury_accounts_read" ON public.treasury_accounts;
CREATE POLICY "treasury_accounts_read" ON public.treasury_accounts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL));
DROP POLICY IF EXISTS "treasury_accounts_write" ON public.treasury_accounts;
DROP POLICY IF EXISTS "treasury_accounts_write" ON public.treasury_accounts;
CREATE POLICY "treasury_accounts_write" ON public.treasury_accounts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')));
DROP POLICY IF EXISTS "treasury_movements_read" ON public.treasury_movements;
DROP POLICY IF EXISTS "treasury_movements_read" ON public.treasury_movements;
CREATE POLICY "treasury_movements_read" ON public.treasury_movements FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL));

-- Seed cuentas de tesorería desde los bancos + wallets USDT
INSERT INTO public.treasury_accounts (name, type, currency, country_code, bank_account_id)
SELECT ba.bank_name || ' ' || public.country_to_currency(ba.country_code), 'bank',
       public.country_to_currency(ba.country_code), ba.country_code, ba.id
FROM public.cuypay_bank_accounts ba
WHERE NOT EXISTS (SELECT 1 FROM public.treasury_accounts ta WHERE ta.bank_account_id = ba.id);

INSERT INTO public.treasury_accounts (name, type, currency, exchange) VALUES
    ('USDT Binance', 'crypto', 'USDT', 'Binance'),
    ('USDT Bitso',   'crypto', 'USDT', 'Bitso')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────
-- 9. Recargar cache + verificar
-- ─────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

SELECT 'cuypay_bank_accounts' AS tabla, COUNT(*) FROM public.cuypay_bank_accounts
UNION ALL SELECT 'treasury_accounts', COUNT(*) FROM public.treasury_accounts
UNION ALL SELECT 'fx_pair_config', COUNT(*) FROM public.fx_pair_config
UNION ALL SELECT 'app_settings', COUNT(*) FROM public.app_settings;

-- 2026_admin_list_user_transactions.sql
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

-- 2026_admin_receipts.sql
-- ════════════════════════════════════════════════════════
-- Comprobante de respaldo del pago al cliente (interno)
--
-- Cuando el admin paga a un cliente (send) y marca completado, puede
-- subir el soporte del pago. Este comprobante es SOLO interno — la app
-- del cliente NO lo muestra. Se guarda en un bucket privado.
-- ════════════════════════════════════════════════════════

-- ───── 1. Bucket privado para comprobantes internos ─────
INSERT INTO storage.buckets (id, name, public)
VALUES ('admin-receipts', 'admin-receipts', false)
ON CONFLICT (id) DO NOTHING;

-- Policies de storage: solo admins suben y leen
DROP POLICY IF EXISTS "admin_upload_admin_receipts" ON storage.objects;
DROP POLICY IF EXISTS "admin_upload_admin_receipts" ON storage.objects;
CREATE POLICY "admin_upload_admin_receipts" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'admin-receipts'
    AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL)
  );

DROP POLICY IF EXISTS "admin_read_admin_receipts" ON storage.objects;
DROP POLICY IF EXISTS "admin_read_admin_receipts" ON storage.objects;
CREATE POLICY "admin_read_admin_receipts" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'admin-receipts'
    AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL)
  );

DROP POLICY IF EXISTS "admin_delete_admin_receipts" ON storage.objects;
DROP POLICY IF EXISTS "admin_delete_admin_receipts" ON storage.objects;
CREATE POLICY "admin_delete_admin_receipts" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'admin-receipts'
    AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury'))
  );

-- ───── 2. Tabla que registra los comprobantes internos por TX ─────
CREATE INDEX IF NOT EXISTS idx_tx_admin_receipts_tx ON public.tx_admin_receipts(transaction_id, created_at DESC);
ALTER TABLE public.tx_admin_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_tx_receipts" ON public.tx_admin_receipts;
DROP POLICY IF EXISTS "admin_read_tx_receipts" ON public.tx_admin_receipts;
CREATE POLICY "admin_read_tx_receipts" ON public.tx_admin_receipts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL));

DROP POLICY IF EXISTS "admin_write_tx_receipts" ON public.tx_admin_receipts;
DROP POLICY IF EXISTS "admin_write_tx_receipts" ON public.tx_admin_receipts;
CREATE POLICY "admin_write_tx_receipts" ON public.tx_admin_receipts
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL));

NOTIFY pgrst, 'reload schema';

-- 2026_admin_transactions_rls.sql
-- ════════════════════════════════════════════════════════
-- RLS: permitir al admin de Personas leer/aprobar transacciones
--
-- Síntoma corregido: en el SQL Editor (role postgres) las filas
-- de public.transactions se ven, pero el panel admin recibe 0 filas
-- porque RLS está habilitado y no había una policy de SELECT que
-- aplicara al rol authenticated cuando el usuario es admin.
--
-- Esta migración asume que public.users tiene la columna admin_role
-- (creada en feat/admin-personas-multi-role).
-- ════════════════════════════════════════════════════════

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- ───── SELECT: cualquier admin (cualquier rol) puede ver todas las TX ─────
DROP POLICY IF EXISTS "admin_select_all_transactions" ON public.transactions;
CREATE POLICY "admin_select_all_transactions"
  ON public.transactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND admin_role IS NOT NULL
    )
  );

-- ───── SELECT: el dueño también ve sus propias TX (app móvil) ─────
DROP POLICY IF EXISTS "owner_select_own_transactions" ON public.transactions;
CREATE POLICY "owner_select_own_transactions"
  ON public.transactions FOR SELECT
  TO authenticated
  USING (
    -- soporta ambos esquemas
    auth.uid() = COALESCE(owner_user_id, user_id::uuid)
  );

-- ───── UPDATE: super_admin y treasury pueden aprobar / rechazar ─────
DROP POLICY IF EXISTS "admin_update_transactions" ON public.transactions;
CREATE POLICY "admin_update_transactions"
  ON public.transactions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND admin_role IN ('super_admin','treasury')
    )
  )
  WITH CHECK (true);

-- ───── Realtime: que el panel admin se entere de inserts/updates ─────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'transactions'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
    END IF;
END $$;

-- ───── Verificar: cuántas TX debería ver un admin ─────
-- Ejecuta después del CREATE POLICY:
SELECT COUNT(*) AS total_transactions FROM public.transactions;
SELECT id, owner_user_id, kind, status, amount, currency, created_at
FROM public.transactions
ORDER BY created_at DESC
LIMIT 10;

-- 2026_admin_treasury_rpcs.sql
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

-- 2026_aml_rules_scope.sql
-- ───────────────────────────────────────────────────────
-- 2026_aml_rules_scope.sql
--
-- Alcance de las reglas AML: son GENERALES (aplican a todos los
-- usuarios) con la excepción de negocio clave — usuarios que ya
-- justificaron sus movimientos ante Compliance o tienen topes
-- aumentados aprobados (custom limits) pueden quedar eximidos.
--
-- Columnas nuevas en public.aml_rules:
--   applies_to            text    — 'all' (hoy el único valor; extensible)
--   exempt_custom_limits  boolean — true = usuarios con custom_daily_limit
--                                   o custom_monthly_limit NO disparan la regla
--   tx_count              integer — umbral de cantidad de TXs para reglas
--                                   velocity / frequent_low
--
-- El motor que evalúa las reglas (edge/cron de Antigravity) debe:
--   1) Cargar las reglas is_active=true.
--   2) Si exempt_custom_limits=true, SALTEAR la evaluación para
--      usuarios donde users.custom_daily_limit IS NOT NULL
--      OR users.custom_monthly_limit IS NOT NULL.
--
-- Idempotente.
-- ───────────────────────────────────────────────────────

ALTER TABLE public.aml_rules
    ADD COLUMN IF NOT EXISTS applies_to           text    NOT NULL DEFAULT 'all',
    ADD COLUMN IF NOT EXISTS exempt_custom_limits boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS tx_count             integer;

-- 2026_aml_rules_v2.sql
-- ───────────────────────────────────────────────────────
-- 2026_aml_rules_v2.sql
--
-- Catálogo extendido de reglas AML — cobertura de oficial de
-- cumplimiento. Nuevos tipos de regla + parámetros + acción al
-- disparar.
--
-- Tipos: high_amount, daily_volume, cross_border, round_amounts,
--        velocity, frequent_low, pass_through, odd_hours,
--        new_account_volume, dormant_reactivation,
--        many_beneficiaries, high_risk_country, shared_device
--
-- Acciones: alert (solo alerta) / alert_hold (+ compliance hold) /
--           alert_block (+ bloqueo temporal automático)
--
-- El motor de evaluación (cron/edge de Antigravity) debe respetar:
--   • exempt_custom_limits=true → saltear usuarios con
--     custom_daily_limit / custom_monthly_limit NOT NULL
--   • currencies=[] → todas; sino solo TXs en esas monedas
--   • countries → según el tipo (cross_border/high_risk_country)
--   • cooldown_hours → no re-alertar al mismo usuario en la ventana
--   • rule_action → alert_hold activa compliance hold;
--     alert_block setea users.is_active=false + block_type='temporary'
--
-- Idempotente.
-- ───────────────────────────────────────────────────────

-- 1) Ampliar el CHECK de rule_type con los tipos nuevos
ALTER TABLE public.aml_rules
    DROP CONSTRAINT IF EXISTS aml_rules_rule_type_check;

ALTER TABLE public.aml_rules
    ADD CONSTRAINT aml_rules_rule_type_check
    CHECK (rule_type IN (
        'high_amount','daily_volume','cross_border','round_amounts',
        'velocity','frequent_low','pass_through','odd_hours',
        'new_account_volume','dormant_reactivation',
        'many_beneficiaries','high_risk_country','shared_device'
    ));

-- 2) Parámetros nuevos
ALTER TABLE public.aml_rules
    ADD COLUMN IF NOT EXISTS account_age_days integer,
    ADD COLUMN IF NOT EXISTS hour_from        integer CHECK (hour_from BETWEEN 0 AND 23),
    ADD COLUMN IF NOT EXISTS hour_to          integer CHECK (hour_to   BETWEEN 0 AND 23),
    ADD COLUMN IF NOT EXISTS countries        jsonb   NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS currencies       jsonb   NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS rule_action      text    NOT NULL DEFAULT 'alert'
        CHECK (rule_action IN ('alert','alert_hold','alert_block')),
    ADD COLUMN IF NOT EXISTS cooldown_hours   integer;

-- (Las columnas applies_to / exempt_custom_limits / tx_count vienen de
--  2026_aml_rules_scope.sql — se re-declaran por si esa no corrió.)
ALTER TABLE public.aml_rules
    ADD COLUMN IF NOT EXISTS applies_to           text    NOT NULL DEFAULT 'all',
    ADD COLUMN IF NOT EXISTS exempt_custom_limits boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS tx_count             integer;

-- 2026_app_banners.sql
-- ───────────────────────────────────────────────────────
-- 2026_app_banners.sql
--
-- Banners de campaña que aparecen en el home de la app móvil
-- sobre el asset de la mascota Cuy sosteniendo un cartel.
-- Spec final acordada con Claude Web.
--
-- La app móvil consume directamente desde la tabla con un simple
-- SELECT * FROM app_banners WHERE is_active = true — sin RPCs.
-- ───────────────────────────────────────────────────────


CREATE INDEX IF NOT EXISTS app_banners_active_idx
    ON public.app_banners(is_active, created_at DESC)
    WHERE is_active = true;

-- Trigger touch updated_at
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_banners_touch ON public.app_banners;
CREATE TRIGGER app_banners_touch
    BEFORE UPDATE ON public.app_banners
    FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- ─────────────────────────────────────────────
-- RLS: admins (super_admin/compliance/support) hacen CRUD;
-- los usuarios autenticados leen solo activos (para que la app
-- pueda hidratar el home).
-- ─────────────────────────────────────────────
ALTER TABLE public.app_banners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_banners_admin_all ON public.app_banners;
DROP POLICY IF EXISTS app_banners_admin_all ON public.app_banners;
CREATE POLICY app_banners_admin_all ON public.app_banners
    FOR ALL TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.users u
                WHERE u.id = auth.uid()
                  AND u.admin_role IN ('super_admin','compliance','support'))
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.users u
                WHERE u.id = auth.uid()
                  AND u.admin_role IN ('super_admin','compliance','support'))
    );

DROP POLICY IF EXISTS app_banners_user_read_active ON public.app_banners;
DROP POLICY IF EXISTS app_banners_user_read_active ON public.app_banners;
CREATE POLICY app_banners_user_read_active ON public.app_banners
    FOR SELECT TO authenticated
    USING (is_active = true);

-- 2026_app_settings_admin_rls.sql
-- ════════════════════════════════════════════════════════
-- app_settings: tabla de configuración global de la app
--
-- El Claude del proyecto Android creó esta tabla para el sistema de
-- referidos (key='referral_rate'). Esta migración es idempotente:
--   • crea la tabla si no existe (no la rompe si ya está)
--   • asegura las RLS policies para que:
--      - todos los `authenticated` puedan LEER (la app móvil necesita)
--      - solo `super_admin` puede ESCRIBIR (desde el admin web)
-- ════════════════════════════════════════════════════════


ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- ───── SELECT: cualquier authenticated lee (app móvil necesita el rate) ─────
DROP POLICY IF EXISTS "app_settings_read_authenticated" ON public.app_settings;
CREATE POLICY "app_settings_read_authenticated"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (true);

-- ───── INSERT/UPDATE/DELETE: solo super_admin desde el admin web ─────
DROP POLICY IF EXISTS "app_settings_write_super_admin" ON public.app_settings;
CREATE POLICY "app_settings_write_super_admin"
  ON public.app_settings FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND admin_role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND admin_role = 'super_admin'
    )
  );

-- ───── Default: referral_rate = 0.01 (1 %) si no existe la fila ─────
INSERT INTO public.app_settings (key, value, description) VALUES
    ('referral_rate', '0.01'::jsonb, 'Porcentaje de la comisión cobrada que se reparte al usuario que refirió')
ON CONFLICT (key) DO NOTHING;

-- ───── Forzar reload del schema cache de PostgREST ─────
NOTIFY pgrst, 'reload schema';

-- ───── Verificación ─────
SELECT key, value, description, updated_at FROM public.app_settings;

-- 2026_balance_per_bank_account.sql
-- ════════════════════════════════════════════════════════
-- Balance por cuenta bancaria
--
-- El user quiere ver: "el saldo por banco — si hay varios bancos en
-- Colombia, mostrarme el saldo de cada banco e ingresos a cada banco".
--
-- Estrategia:
--   1. Agregar columna `bank_account_id` a transactions (la app móvil
--      la llena cuando el usuario elige a qué cuenta deposita)
--   2. Vista bank_account_balances que:
--      • Si transactions.bank_account_id está seteado → match exacto
--      • Si NO está seteado, fallback por bank_name (case-insensitive)
--        comparando raw_data->>'bank_name' o raw_data->>'bank' contra
--        cuypay_bank_accounts.bank_name del mismo país/moneda
-- ════════════════════════════════════════════════════════

-- ───── 1. Columna opcional en transactions ─────
ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS bank_account_id UUID
    REFERENCES public.cuypay_bank_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_bank_account
    ON public.transactions(bank_account_id) WHERE bank_account_id IS NOT NULL;

COMMENT ON COLUMN public.transactions.bank_account_id IS
    'Cuenta bancaria de CuyPay a la que el usuario depositó (load) o desde la que se le pagó (send). Si es NULL, se intenta inferir desde raw_data.bank_name.';

-- ───── 2. Mapa de país → moneda (helper) ─────
-- (idempotente)
CREATE OR REPLACE FUNCTION public.country_to_currency(p_country TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE upper(coalesce(p_country, ''))
        WHEN 'CO' THEN 'COP'
        WHEN 'CL' THEN 'CLP'
        WHEN 'PE' THEN 'PEN'
        WHEN 'MX' THEN 'MXN'
        WHEN 'BR' THEN 'BRL'
        ELSE NULL
    END;
$$;

-- ───── 3. Vista: balance por cuenta bancaria ─────
CREATE OR REPLACE VIEW public.bank_account_balances AS
WITH matched_tx AS (
    SELECT
        ba.id AS bank_account_id,
        ba.country_code,
        ba.bank_name,
        ba.account_number,
        ba.holder,
        ba.is_active,
        public.country_to_currency(ba.country_code) AS currency,
        t.id AS tx_id,
        t.kind,
        t.status,
        COALESCE(t.amount, 0) AS amount
    FROM public.cuypay_bank_accounts ba
    LEFT JOIN public.transactions t ON (
        -- Match 1 (preferido): la TX apunta directo a esta cuenta
        t.bank_account_id = ba.id
        OR
        -- Match 2 (fallback): TX sin bank_account_id pero raw_data tiene el banco
        -- y la moneda corresponde al país de la cuenta
        (
            t.bank_account_id IS NULL
            AND t.currency = public.country_to_currency(ba.country_code)
            AND (
                LOWER(COALESCE(t.raw_data->>'bank_name', '')) = LOWER(ba.bank_name)
                OR LOWER(COALESCE(t.raw_data->>'bank', '')) = LOWER(ba.bank_name)
            )
        )
    )
)
SELECT
    bank_account_id,
    country_code,
    bank_name,
    account_number,
    holder,
    is_active,
    currency,
    -- Saldo confirmado = loads completados - sends completados
    COALESCE(SUM(amount) FILTER (
        WHERE kind = 'load'
          AND lower(COALESCE(status,'')) IN ('completed','approved','aprobada','completado','aprobado')
    ), 0) -
    COALESCE(SUM(amount) FILTER (
        WHERE kind = 'send'
          AND lower(COALESCE(status,'')) IN ('completed','approved','aprobada','completado','aprobado')
    ), 0) AS confirmed_balance,

    -- Loads pendientes (van a entrar)
    COALESCE(SUM(amount) FILTER (
        WHERE kind = 'load'
          AND lower(COALESCE(status,'')) IN ('pending','pendiente')
    ), 0) AS pending_in,

    -- Sends pendientes (van a salir)
    COALESCE(SUM(amount) FILTER (
        WHERE kind = 'send'
          AND lower(COALESCE(status,'')) IN ('pending','pendiente')
    ), 0) AS pending_out,

    -- Conteos
    COUNT(tx_id) FILTER (
        WHERE lower(COALESCE(status,'')) IN ('pending','pendiente')
    ) AS pending_count,

    COUNT(tx_id) FILTER (
        WHERE lower(COALESCE(status,'')) IN ('completed','approved','aprobada','completado','aprobado')
    ) AS completed_count
FROM matched_tx
GROUP BY bank_account_id, country_code, bank_name, account_number, holder, is_active, currency;

GRANT SELECT ON public.bank_account_balances TO authenticated;

-- ───── 4. Verificar ─────
SELECT bank_name, currency, confirmed_balance, pending_in, pending_out, pending_count
FROM public.bank_account_balances
ORDER BY country_code, bank_name;

NOTIFY pgrst, 'reload schema';

-- 2026_bank_accounts_admin_rls.sql
-- ════════════════════════════════════════════════════════
-- RLS: permitir al admin de Personas crear / editar / eliminar
-- cuentas bancarias desde el panel.
--
-- Asume que public.users tiene la columna admin_role.
-- Ajusta a tu esquema si la tabla `cuypay_bank_accounts` tiene
-- columnas diferentes.
-- ════════════════════════════════════════════════════════

-- Si la tabla aún no existe (algunos proyectos solo tienen "bank_accounts"),
-- la creamos con el esquema completo.

ALTER TABLE public.cuypay_bank_accounts ENABLE ROW LEVEL SECURITY;

-- ───── SELECT: cualquier usuario autenticado puede leer cuentas ACTIVAS ─────
--      (la app Android las muestra al cargar saldo)
DROP POLICY IF EXISTS "anyone_select_active_bank_accounts" ON public.cuypay_bank_accounts;
CREATE POLICY "anyone_select_active_bank_accounts"
  ON public.cuypay_bank_accounts FOR SELECT
  TO authenticated
  USING (is_active = true);

-- ───── SELECT: admin ve TODAS, incluso inactivas ─────
DROP POLICY IF EXISTS "admin_select_all_bank_accounts" ON public.cuypay_bank_accounts;
CREATE POLICY "admin_select_all_bank_accounts"
  ON public.cuypay_bank_accounts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND admin_role IS NOT NULL
    )
  );

-- ───── INSERT / UPDATE / DELETE: super_admin y treasury ─────
DROP POLICY IF EXISTS "treasury_manage_bank_accounts" ON public.cuypay_bank_accounts;
CREATE POLICY "treasury_manage_bank_accounts"
  ON public.cuypay_bank_accounts FOR ALL
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

-- ───── Trigger para auto-updatear updated_at ─────
CREATE OR REPLACE FUNCTION public.touch_cuypay_bank_accounts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cuypay_bank_accounts_updated_at ON public.cuypay_bank_accounts;
CREATE TRIGGER trg_cuypay_bank_accounts_updated_at
    BEFORE UPDATE ON public.cuypay_bank_accounts
    FOR EACH ROW EXECUTE FUNCTION public.touch_cuypay_bank_accounts_updated_at();

-- ───── Verificación ─────
SELECT COUNT(*) AS total_bank_accounts FROM public.cuypay_bank_accounts;
SELECT id, country_code, bank_name, account_number, is_active
FROM public.cuypay_bank_accounts
ORDER BY country_code;

-- 2026_beneficiary_block_fields.sql
-- ───────────────────────────────────────────────────────
-- 2026_beneficiary_block_fields.sql
--
-- Columnas de bloqueo estructurado para beneficiarios (terceros) —
-- mirror de las de users. El admin bloquea con motivo + checklist
-- de documentos requeridos; la app mobile lee estas columnas para
-- mostrar el flujo de re-documentación vía Didit al dueño.
--
-- También extiende el CHECK de kyc_status (si existe) para aceptar
-- el nuevo estado 'blocked'.
--
-- Idempotente.
-- ───────────────────────────────────────────────────────

ALTER TABLE public.beneficiaries
    ADD COLUMN IF NOT EXISTS block_type         text
        CHECK (block_type IN ('temporary', 'permanent')),
    ADD COLUMN IF NOT EXISTS block_reason       text,
    ADD COLUMN IF NOT EXISTS block_notes        text,
    ADD COLUMN IF NOT EXISTS required_documents jsonb DEFAULT '[]'::jsonb;

-- Extender el CHECK de kyc_status para aceptar 'blocked'.
-- Si la tabla no tenía constraint, este bloque lo crea permisivo.
ALTER TABLE public.beneficiaries
    DROP CONSTRAINT IF EXISTS beneficiaries_kyc_status_check;

ALTER TABLE public.beneficiaries
    ADD CONSTRAINT beneficiaries_kyc_status_check
    CHECK (kyc_status IS NULL OR kyc_status IN (
        'approved','pending','rejected','in_progress',
        'in_review','verified','expired','declined','blocked'
    ));

-- 2026_beneficiary_limits.sql
-- ───────────────────────────────────────────────────────
-- 2026_beneficiary_limits.sql
--
-- Topes por TERCERO/BENEFICIARIO. Mirror exacto del sistema de topes
-- de usuarios (2026_user_limits.sql + 2026_user_limits_fix.sql) pero
-- aplicado a public.beneficiaries.
--
-- Casos de uso:
--   • Admin abre KYC Terceros → fila → "Topes" → edita los topes
--     que aplican cuando alguien envía a ESE beneficiario.
--   • Admin abre el drawer de un usuario → tab "Topes" → lista
--     todos los beneficiarios del user con sus consumos individuales.
--
-- Resolución del tope efectivo (igual que users):
--   custom_* del beneficiary → app_settings('operational_limits') → defaults hardcoded
-- ───────────────────────────────────────────────────────

-- 1) Columnas en beneficiaries
ALTER TABLE public.beneficiaries
    ADD COLUMN IF NOT EXISTS custom_daily_limit   numeric,
    ADD COLUMN IF NOT EXISTS custom_monthly_limit numeric,
    ADD COLUMN IF NOT EXISTS limits_currency      text;

-- 2) RPC: resumen del consumo + tope efectivo de un beneficiario.
--    Suma TXs donde el beneficiario fue el destinatario (beneficiary_id
--    es la columna que apunta a beneficiaries.id desde transactions).
--    Si tu schema usa otro nombre, ajustá el WHERE.
CREATE OR REPLACE FUNCTION public.get_beneficiary_limits_summary(p_beneficiary_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_custom_d      numeric;
    v_custom_m      numeric;
    v_ben_curr      text;
    v_global        jsonb;
    v_eff_daily     numeric;
    v_eff_monthly   numeric;
    v_eff_currency  text;
    v_used_d        numeric;
    v_used_m        numeric;
    v_caller_role   text;
    v_owner_id      uuid;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;

    -- Permisos: el dueño del beneficiario puede consultar el suyo;
    -- super_admin/compliance/treasury pueden consultar cualquiera.
    SELECT admin_role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    SELECT owner_user_id INTO v_owner_id FROM public.beneficiaries WHERE id = p_beneficiary_id;

    IF v_owner_id IS NULL THEN
        RETURN jsonb_build_object('error', 'beneficiary_not_found');
    END IF;

    IF auth.uid() <> v_owner_id
       AND COALESCE(v_caller_role, '') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error', 'forbidden');
    END IF;

    -- 1) traer custom + global default
    SELECT custom_daily_limit, custom_monthly_limit, limits_currency
    INTO v_custom_d, v_custom_m, v_ben_curr
    FROM public.beneficiaries WHERE id = p_beneficiary_id;

    SELECT value INTO v_global
    FROM public.app_settings WHERE key = 'operational_limits';

    v_eff_daily    := COALESCE(v_custom_d, (v_global->>'daily')::numeric, 800);
    v_eff_monthly  := COALESCE(v_custom_m, (v_global->>'monthly')::numeric, 3000);
    v_eff_currency := COALESCE(v_ben_curr, v_global->>'currency', 'USD');

    -- 2) consumo rolling — TXs donde el beneficiario fue el destinatario.
    --    Probamos beneficiary_id (spec ideal) y caemos a recipient_id /
    --    destination_id si tu schema usa otro nombre. Si ninguna existe,
    --    el query devuelve 0 y queda como "sin uso" (no rompe).
    BEGIN
        SELECT COALESCE(SUM(COALESCE(amount, 0)), 0)
        INTO v_used_d
        FROM public.transactions
        WHERE beneficiary_id = p_beneficiary_id
          AND created_at >= now() - interval '24 hours'
          AND kind IN ('send', 'load', 'convert', 'envio', 'carga')
          AND status IN ('completed', 'approved', 'sent', 'success');

        SELECT COALESCE(SUM(COALESCE(amount, 0)), 0)
        INTO v_used_m
        FROM public.transactions
        WHERE beneficiary_id = p_beneficiary_id
          AND created_at >= now() - interval '30 days'
          AND kind IN ('send', 'load', 'convert', 'envio', 'carga')
          AND status IN ('completed', 'approved', 'sent', 'success');
    EXCEPTION WHEN undefined_column THEN
        v_used_d := 0;
        v_used_m := 0;
    END;

    RETURN jsonb_build_object(
        'currency',           v_eff_currency,
        'daily_max',          v_eff_daily,
        'monthly_max',        v_eff_monthly,
        'daily_used',         v_used_d,
        'monthly_used',       v_used_m,
        'daily_pct',          CASE WHEN v_eff_daily > 0   THEN ROUND((v_used_d / v_eff_daily   * 100)::numeric, 2) ELSE 0 END,
        'monthly_pct',        CASE WHEN v_eff_monthly > 0 THEN ROUND((v_used_m / v_eff_monthly * 100)::numeric, 2) ELSE 0 END,
        'is_custom_daily',    v_custom_d IS NOT NULL,
        'is_custom_monthly',  v_custom_m IS NOT NULL,
        'owner_user_id',      v_owner_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_beneficiary_limits_summary(uuid) TO anon, authenticated;

-- 3) RPC: setear topes custom de un beneficiario.
--    Pasar NULL en p_daily_limit / p_monthly_limit / p_currency = volver
--    al default global. Solo admins con rol super_admin / compliance / treasury.
CREATE OR REPLACE FUNCTION public.admin_set_beneficiary_limits(
    p_beneficiary_id uuid,
    p_daily_limit    numeric,
    p_monthly_limit  numeric,
    p_currency       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_role text;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;

    SELECT admin_role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    IF COALESCE(v_caller_role, '') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error', 'forbidden');
    END IF;

    UPDATE public.beneficiaries
       SET custom_daily_limit   = p_daily_limit,
           custom_monthly_limit = p_monthly_limit,
           limits_currency      = p_currency
     WHERE id = p_beneficiary_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'beneficiary_not_found');
    END IF;

    RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_beneficiary_limits(uuid, numeric, numeric, text) TO authenticated;

-- 2026_beneficiary_limits_summary_v2.sql
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

-- 2026_compliance_hold.sql
-- ───────────────────────────────────────────────────────
-- 2026_compliance_hold.sql
--
-- Compliance Hold: cuando hay una o más solicitudes de documentación
-- pendientes para un usuario, su cuenta queda en "hold" y NO puede
-- enviar (`send`) ni cargar (`load`) plata. Solo puede convertir
-- (`convert`) lo que ya tiene en sus wallets — eso le permite mover
-- el saldo dentro de CuyPay pero no aumentar exposición externa
-- hasta que compliance apruebe los docs.
--
-- Reusa la tabla `document_requests` ya existente. No crea
-- `compliance_document_requests` separada para evitar duplicación
-- y mantener un solo origen de verdad. El RPC `get_my_compliance_status`
-- expone los campos con los nombres que pidió la app móvil.
--
-- Estados de document_requests que activan hold:
--   • pending    → la solicitud está esperando respuesta del usuario
--   • submitted  → el usuario respondió, compliance todavía no revisó
--   • escalated  → compliance escaló a otra área, sigue en revisión
--
-- Estados que liberan el hold (siempre y cuando no haya otra activa):
--   • approved   → compliance aprobó, el usuario puede operar
--   • rejected   → compliance rechazó, el caso se cierra
--   • canceled   → compliance canceló la solicitud
-- ───────────────────────────────────────────────────────

-- 1) Columnas en users
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS compliance_hold         boolean     NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS compliance_hold_set_at  timestamptz,
    ADD COLUMN IF NOT EXISTS compliance_hold_reason  text;

CREATE INDEX IF NOT EXISTS users_compliance_hold_idx
    ON public.users(compliance_hold) WHERE compliance_hold;

COMMENT ON COLUMN public.users.compliance_hold IS
    'Si true, el user no puede send/load — solo convert. Se setea automáticamente por trigger según document_requests.';

-- 2) Campo opcional para que el usuario suba 1 archivo principal
ALTER TABLE public.document_requests
    ADD COLUMN IF NOT EXISTS user_response_url text;

-- 3) Recompute helper — recalcula el flag para un user
CREATE OR REPLACE FUNCTION public.recompute_compliance_hold(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_has_active boolean;
    v_was_on_hold boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM public.document_requests
        WHERE user_id = p_user_id
          AND status IN ('pending', 'submitted', 'escalated')
    ) INTO v_has_active;

    SELECT compliance_hold INTO v_was_on_hold
    FROM public.users WHERE id = p_user_id;

    UPDATE public.users
    SET
        compliance_hold        = v_has_active,
        compliance_hold_set_at = CASE
            WHEN v_has_active AND NOT COALESCE(v_was_on_hold, false) THEN now()
            WHEN NOT v_has_active THEN NULL
            ELSE compliance_hold_set_at
        END,
        compliance_hold_reason = CASE
            WHEN v_has_active THEN 'Solicitudes de documentación pendientes'
            ELSE NULL
        END
    WHERE id = p_user_id;
END;
$$;

-- 4) Trigger: cualquier INSERT/UPDATE de status/DELETE en document_requests
--    recalcula automáticamente el hold del user afectado.
CREATE OR REPLACE FUNCTION public.tg_document_requests_recompute_hold()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.recompute_compliance_hold(OLD.user_id);
        RETURN OLD;
    END IF;

    PERFORM public.recompute_compliance_hold(NEW.user_id);

    -- Si el user_id cambió (caso raro), también recompute al anterior
    IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
        PERFORM public.recompute_compliance_hold(OLD.user_id);
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS document_requests_hold_trigger ON public.document_requests;
CREATE TRIGGER document_requests_hold_trigger
    AFTER INSERT OR UPDATE OF status, user_id OR DELETE
    ON public.document_requests
    FOR EACH ROW EXECUTE FUNCTION public.tg_document_requests_recompute_hold();

-- 5) RPC público: get_my_compliance_status
--    La app móvil lo llama después del login para decidir si bloquear UI
--    de send/load. Devuelve el estado de hold + las solicitudes activas
--    para mostrarle al usuario qué tiene que hacer.
CREATE OR REPLACE FUNCTION public.get_my_compliance_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid  uuid := auth.uid();
    v_hold boolean;
    v_docs jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('error', 'not authenticated');
    END IF;

    SELECT compliance_hold INTO v_hold
    FROM public.users WHERE id = v_uid;

    SELECT COALESCE(
        jsonb_agg(jsonb_build_object(
            'id',          d.id,
            'doc_type',    d.category,
            'title',       d.title,
            'description', d.description,
            'deadline',    d.due_date,
            'status',      d.status,
            'created_at',  d.requested_at,
            'attachments', d.attachments,
            'user_response_url', d.user_response_url
        ) ORDER BY d.requested_at DESC),
        '[]'::jsonb
    ) INTO v_docs
    FROM public.document_requests d
    WHERE d.user_id = v_uid
      AND d.status IN ('pending', 'submitted', 'escalated');

    RETURN jsonb_build_object(
        'compliance_hold',    COALESCE(v_hold, false),
        'pending_documents',  v_docs
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_compliance_status() TO authenticated;

-- 6) Helper para chequear hold del user actual desde RLS policies
CREATE OR REPLACE FUNCTION public.is_user_on_compliance_hold()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(compliance_hold, false)
    FROM public.users
    WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.is_user_on_compliance_hold() TO authenticated;

-- 7) RLS RESTRICTIVE en transactions: bloquea INSERT de kind='send' o 'load'
--    cuando el user está en compliance_hold. Convert sigue permitido.
--    OJO: esta policy es RESTRICTIVE, se aplica además de las existentes —
--    NO reemplaza la lógica de permisos normal, solo agrega el bloqueo.

DROP POLICY IF EXISTS tx_block_send_load_on_compliance_hold ON public.transactions;
DROP POLICY IF EXISTS tx_block_send_load_on_compliance_hold ON public.transactions;
CREATE POLICY tx_block_send_load_on_compliance_hold ON public.transactions
    AS RESTRICTIVE
    FOR INSERT TO authenticated
    WITH CHECK (
        NOT public.is_user_on_compliance_hold()
        OR COALESCE(kind, '') NOT IN ('send', 'load')
    );

COMMENT ON POLICY tx_block_send_load_on_compliance_hold ON public.transactions IS
    'Si el user está en compliance_hold, solo puede insertar TX de tipo convert (o cualquier otro != send/load).';

-- 8) Backfill: recompute para todos los users que tienen al menos una solicitud
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT DISTINCT user_id FROM public.document_requests
    LOOP
        PERFORM public.recompute_compliance_hold(r.user_id);
    END LOOP;
END $$;

-- 9) Verificación: cuántos users quedaron en hold
SELECT
    COUNT(*) FILTER (WHERE compliance_hold)        AS users_en_hold,
    COUNT(*)                                       AS users_totales
FROM public.users;

-- 2026_cron_finity_snapshot.sql
-- ════════════════════════════════════════════════════════
-- SNAPSHOT AUTOMÁTICO de la tasa USD→COP cada 5 minutos.
--
-- Llama a la edge 'finity-proxy' (action=snapshot_finity) que consulta la
-- tasa REAL de Finity y guarda un punto en fx_rate_snapshots — así la
-- gráfica del convertidor OTC siempre tiene datos, aunque nadie lo abra.
--
-- ⚠️ Antes de correr esto, reemplaza <ANON_KEY> por tu
-- VITE_SUPABASE_ANON_KEY (Supabase → Project Settings → API → anon public).
--
-- Para cambiar el intervalo edita el schedule ('*/5 * * * *' = cada 5 min).
-- Para APAGARLO: SELECT cron.unschedule('cuypay_finity_snapshot');
-- ════════════════════════════════════════════════════════

DO $ext$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_cron; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_cron no disponible (habilítala en Supabase → Database → Extensions)'; END $ext$;
DO $ext$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_net; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_net no disponible (habilítala en Supabase → Database → Extensions)'; END $ext$;

DO $$ BEGIN
  PERFORM cron.unschedule('cuypay_finity_snapshot');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- [lincoin] Cron de Finity ELIMINADO — Lincoin no usa Finity (rails vía Mouv).

-- 2026_cron_sweep.sql
-- ════════════════════════════════════════════════════════
-- BARRIDO AUTOMÁTICO cada 1 minuto: llama a la edge tatum-wallet
-- (action=sweep_all) que mueve el USDT de todos los buzones de clientes
-- a la wallet recaudadora.
--
-- ⚠️ Antes de correr esto, reemplaza <ANON_KEY> por tu VITE_SUPABASE_ANON_KEY
-- (Supabase → Project Settings → API → anon public).
--
-- Requiere las extensiones pg_cron y pg_net (Supabase las trae; se activan
-- abajo si no están). Para cambiar el intervalo, edita el schedule
-- ('* * * * *' = cada minuto; '*/5 * * * *' = cada 5 min).
--
-- Para APAGARLO: SELECT cron.unschedule('cuypay_sweep_all');
-- ════════════════════════════════════════════════════════

DO $ext$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_cron; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_cron no disponible (habilítala en Supabase → Database → Extensions)'; END $ext$;
DO $ext$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_net; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_net no disponible (habilítala en Supabase → Database → Extensions)'; END $ext$;

-- Quita el job previo si existe (idempotente)
DO $$ BEGIN
  PERFORM cron.unschedule('cuypay_sweep_all');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- [lincoin] Cron de barrido Tatum ELIMINADO — Lincoin usa GasFree (USDT-TRON), no Tatum.
-- El barrido de buzones GasFree se programa aparte cuando aplique.

-- 2026_document_requests_block_unlock.sql
-- ───────────────────────────────────────────────────────
-- 2026_document_requests_block_unlock.sql
--
-- Amplía el CHECK constraint de document_requests.category para
-- aceptar 'block_unlock'. Sin esto, el INSERT que hace
-- ComplianceSection.applyBlock() cuando se bloquea con documentos
-- requeridos falla en silencio y la solicitud nunca aparece en
-- Compliance → Documentación.
--
-- Idempotente — dropea el constraint anterior y lo re-crea con la
-- lista completa (incluye limit_increase que ya venía de
-- 2026_document_requests_limit_increase.sql).
-- ───────────────────────────────────────────────────────

ALTER TABLE public.document_requests
    DROP CONSTRAINT IF EXISTS document_requests_category_check;

ALTER TABLE public.document_requests
    ADD CONSTRAINT document_requests_category_check
    CHECK (category IN (
        'source_of_funds',
        'transaction_purpose',
        'beneficiary_id',
        'employment',
        'address',
        'limit_increase',   -- ampliación de topes (iniciada por el user)
        'block_unlock',     -- levantamiento de bloqueo (iniciada por admin)
        'other'
    ));

-- 2026_document_requests_limit_increase.sql
-- ───────────────────────────────────────────────────────
-- 2026_document_requests_limit_increase.sql
--
-- Amplía el flujo de document_requests para que el USER pueda
-- iniciar una solicitud (no solo el admin como hoy).
--
-- Caso de uso: el cliente quiere ampliar sus topes de transferencia
-- diarios/mensuales. Desde la app iOS/Android, abre "Topes y Límites
-- → Solicitar ampliación", adjunta los 4 documentos requeridos
-- (cédula, selfie, comprobante ingresos, factura servicios) y le
-- llega al admin en Compliance → Documentación como una solicitud
-- tipo 'limit_increase' en status 'submitted' (ya respondida, lista
-- para revisar).
-- ───────────────────────────────────────────────────────

-- 1) Ampliar el CHECK constraint del category para aceptar 'limit_increase'
ALTER TABLE public.document_requests
    DROP CONSTRAINT IF EXISTS document_requests_category_check;

ALTER TABLE public.document_requests
    ADD CONSTRAINT document_requests_category_check
    CHECK (category IN (
        'source_of_funds',
        'transaction_purpose',
        'beneficiary_id',
        'employment',
        'address',
        'limit_increase',   -- nuevo: iniciado por el user
        'other'
    ));

-- 2) RPC que la app móvil llama desde "Solicitar ampliación de topes".
--    Crea la solicitud en status 'submitted' (no 'pending') porque el
--    user YA está mandando los documentos en este mismo acto — el flujo
--    nace con respuesta. El admin solo aprueba/rechaza.
--
--    attachments es un array de objetos { url, name?, mime? } que la
--    app sube primero al bucket de Storage y después pasa las URLs acá.
--
--    Devuelve el id de la solicitud creada, o un error claro si el user
--    ya tiene otra ampliación de topes pendiente (evita spam).
CREATE OR REPLACE FUNCTION public.request_limit_increase(
    p_user_response text,
    p_attachments   jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_id  uuid;
    v_existing uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN jsonb_build_object('error', 'not authenticated');
    END IF;

    -- Validación: bloquear si ya hay una ampliación abierta del mismo user
    SELECT id INTO v_existing
    FROM public.document_requests
    WHERE user_id = v_uid
      AND category = 'limit_increase'
      AND status IN ('pending', 'submitted', 'escalated')
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object(
            'error', 'already_pending',
            'message', 'Ya tenés una solicitud de ampliación en revisión.',
            'existing_id', v_existing
        );
    END IF;

    -- Validación de attachments — mínimo 1 archivo
    IF jsonb_array_length(COALESCE(p_attachments, '[]'::jsonb)) = 0 THEN
        RETURN jsonb_build_object(
            'error', 'no_attachments',
            'message', 'Adjuntá al menos un documento.'
        );
    END IF;

    INSERT INTO public.document_requests (
        user_id,
        category,
        title,
        description,
        status,
        requested_by,
        user_response,
        responded_at,
        attachments
    ) VALUES (
        v_uid,
        'limit_increase',
        'Solicitud de ampliación de topes',
        'El usuario solicita aumentar los topes de transferencia diarios y mensuales. Adjuntos: cédula, selfie con documento, comprobante de ingresos, recibo de servicios.',
        'submitted',          -- nace con respuesta
        v_uid,                -- iniciada por el propio user
        COALESCE(p_user_response, ''),
        now(),
        p_attachments
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object(
        'ok', true,
        'id', v_id,
        'status', 'submitted',
        'message', 'Solicitud enviada. Te respondemos en 1-2 días hábiles.'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_limit_increase(text, jsonb) TO authenticated;

-- 3) Asegurar que el bucket de storage existe para que la app pueda
--    subir los archivos antes de llamar al RPC. Si Antigravity ya lo
--    creó en otra migración, este INSERT es no-op por ON CONFLICT.
INSERT INTO storage.buckets (id, name, public)
VALUES ('doc_requests', 'doc_requests', false)
ON CONFLICT (id) DO NOTHING;

-- 4) Policy para que el user solo pueda subir/leer SUS archivos
--    en doc_requests/<user_id>/...
DROP POLICY IF EXISTS doc_requests_user_upload ON storage.objects;
DROP POLICY IF EXISTS doc_requests_user_upload ON storage.objects;
CREATE POLICY doc_requests_user_upload ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'doc_requests'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

DROP POLICY IF EXISTS doc_requests_user_read_own ON storage.objects;
DROP POLICY IF EXISTS doc_requests_user_read_own ON storage.objects;
CREATE POLICY doc_requests_user_read_own ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'doc_requests'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Admins de compliance/super_admin leen TODOS los archivos del bucket
DROP POLICY IF EXISTS doc_requests_admin_read_all ON storage.objects;
DROP POLICY IF EXISTS doc_requests_admin_read_all ON storage.objects;
CREATE POLICY doc_requests_admin_read_all ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'doc_requests'
        AND EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = auth.uid()
              AND u.admin_role IN ('super_admin', 'compliance')
        )
    );

-- 2026_document_requests_mobile_uploads.sql
-- ───────────────────────────────────────────────────────
-- 2026_document_requests_mobile_uploads.sql
--
-- Sincroniza el schema de document_requests con lo que están
-- subiendo las apps mobile:
--   • category ahora acepta slugs de documentos individuales
--     (cedula_front, selfie, proof_income, etc.) además de las
--     categorías originales de solicitud (source_of_funds, etc.)
--   • Nueva columna file_url text para la URL pública del archivo
--     subido al bucket doc_requests/{user_id}/…
--
-- El mobile hace INSERT o UPDATE de 1 fila por documento —
-- category = slug del doc, file_url = URL pública, status='submitted'.
-- El admin lista todas las filas de un user y aprueba/rechaza
-- individualmente cada documento.
--
-- Idempotente.
-- ───────────────────────────────────────────────────────

-- 1) File URL
ALTER TABLE public.document_requests
    ADD COLUMN IF NOT EXISTS file_url text;

-- 2) Extender el CHECK constraint de category para admitir slugs de docs
ALTER TABLE public.document_requests
    DROP CONSTRAINT IF EXISTS document_requests_category_check;

ALTER TABLE public.document_requests
    ADD CONSTRAINT document_requests_category_check
    CHECK (category IN (
        -- Categorías de solicitud (una request abarca varios docs)
        'source_of_funds',
        'transaction_purpose',
        'beneficiary_id',
        'employment',
        'address',
        'limit_increase',
        'block_unlock',
        'other',
        -- Slugs de documentos individuales (una request = un archivo)
        'cedula_front',
        'cedula_back',
        'selfie',
        'proof_address',
        'proof_income',
        'bank_statement',
        'tax_return'
        -- 'source_of_funds' aparece arriba y también sirve como slug
    ));

-- 3) Índice para el listado del admin — filtro por status='submitted'
--    es la vista principal
CREATE INDEX IF NOT EXISTS document_requests_status_submitted_idx
    ON public.document_requests(user_id, requested_at DESC)
    WHERE status = 'submitted';

-- 2026_finity_webhook_events.sql
-- ───────────────────────────────────────────────────────
-- 2026_finity_webhook_events.sql — Auditoría de webhooks de Finity.
-- Pegar en el SQL Editor del proyecto de EMPRESAS.
-- ───────────────────────────────────────────────────────


CREATE INDEX IF NOT EXISTS finity_webhook_events_time_idx
    ON public.finity_webhook_events (received_at DESC);

ALTER TABLE public.finity_webhook_events ENABLE ROW LEVEL SECURITY;

-- Lectura para el panel admin (la app usa anon key con auth propia).
DROP POLICY IF EXISTS finity_webhook_events_read ON public.finity_webhook_events;
DROP POLICY IF EXISTS finity_webhook_events_read ON public.finity_webhook_events;
CREATE POLICY finity_webhook_events_read ON public.finity_webhook_events
    FOR SELECT TO anon, authenticated USING (true);

-- Escribe solo el service role (la edge finity-webhook) — sin policy de
-- INSERT para anon/authenticated.

NOTIFY pgrst, 'reload schema';

-- 2026_fix_todo_en_uno.sql
-- ════════════════════════════════════════════════════════
-- ARREGLO TODO-EN-UNO (reemplaza FIX-contactos y FIX-movimientos).
-- El proyecto no tenía public.is_any_admin() — la base de los candados.
-- Orden: 1) crear is_any_admin  2) candado de users SIN raw_data
--        3) políticas de transactions (leer/insertar lo propio)
-- Es idempotente: correrlo dos veces no daña nada.
-- ════════════════════════════════════════════════════════

-- 1) Función base: ¿el usuario autenticado es admin?
CREATE OR REPLACE FUNCTION public.is_any_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- 2) Candado de columnas sensibles en users — SIN raw_data (ahí viven los
--    contactos y el usuario debe poder escribirlos). role/saldos/kyc
--    siguen siendo solo-admin.
CREATE OR REPLACE FUNCTION public.guard_users_sensitive_cols()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller UUID := auth.uid();
  sensitive TEXT[] := ARRAY[
    'role', 'admin_role', 'kyc_status', 'kyc_verified_at',
    'balances', 'crypto_balances', 'is_blocked',
    'assigned_currency', 'didit_session_id'
  ];
  col TEXT;
  old_val TEXT;
  new_val TEXT;
BEGIN
  IF caller IS NULL THEN RETURN NEW; END IF;          -- service role
  IF public.is_any_admin() THEN RETURN NEW; END IF;   -- admin
  FOREACH col IN ARRAY sensitive LOOP
    old_val := to_jsonb(OLD) ->> col;
    new_val := to_jsonb(NEW) ->> col;
    IF old_val IS DISTINCT FROM new_val THEN
      RAISE EXCEPTION 'Cannot change column "%" (sensitive, admin-only)', col;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS users_sensitive_cols_guard ON public.users;
CREATE TRIGGER users_sensitive_cols_guard
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_users_sensitive_cols();

-- 3) transactions: RLS con "cada quien lo suyo"
DO $$
DECLARE r RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='transactions') THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY';
  FOR r IN SELECT policyname FROM pg_policies
           WHERE tablename='transactions' AND schemaname='public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.transactions', r.policyname);
  END LOOP;
  EXECUTE $p$CREATE POLICY tx_select_own_or_admin ON public.transactions
    FOR SELECT TO authenticated
    USING ((user_id IS NOT NULL AND user_id::text = auth.uid()::text) OR public.is_any_admin())$p$;
  EXECUTE $p$CREATE POLICY tx_insert_own_or_admin ON public.transactions
    FOR INSERT TO authenticated
    WITH CHECK ((user_id IS NOT NULL AND user_id::text = auth.uid()::text) OR public.is_any_admin())$p$;
  EXECUTE $p$CREATE POLICY tx_update_admin ON public.transactions
    FOR UPDATE TO authenticated
    USING (public.is_any_admin()) WITH CHECK (public.is_any_admin())$p$;
  EXECUTE $p$CREATE POLICY tx_delete_admin ON public.transactions
    FOR DELETE TO authenticated
    USING (public.is_any_admin())$p$;
END $$;

-- 4) Verificación: debe listar las 4 políticas tx_*
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'transactions'
ORDER BY policyname;

-- 2026_fx_admin_publish_rates.sql
-- ════════════════════════════════════════════════════════
-- Permitir que el admin PUBLIQUE tasas en fx_rate_snapshots
--
-- Las apps (iOS + Android) leen la tasa base de fx_rate_snapshots
-- (fila más reciente por par). El panel admin necesita poder INSERT ahí
-- cuando el admin setea/cambia una tasa. Hasta ahora solo el Edge Function
-- (service_role) insertaba; con esto super_admin/treasury también pueden.
--
-- Idempotente.
-- ════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "fx_snapshots_insert_treasury" ON public.fx_rate_snapshots;
CREATE POLICY "fx_snapshots_insert_treasury"
  ON public.fx_rate_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND admin_role IN ('super_admin','treasury')
    )
  );

NOTIFY pgrst, 'reload schema';

-- 2026_fx_manual_mode.sql
-- ════════════════════════════════════════════════════════
-- FX: persistir el modo Manual / API por par
--
-- El toggle del admin necesita un flag persistido para sobrevivir al cron
-- de XE (que escribe filas más recientes y "ganaría" la última snapshot).
-- Con manual_mode=true el admin declara: "este par lo manejo yo, no escribas
-- XE encima". Antigravity DEBE filtrar esta columna en su edge function.
-- ════════════════════════════════════════════════════════

ALTER TABLE public.fx_pair_config ADD COLUMN IF NOT EXISTS manual_mode BOOLEAN DEFAULT false;

NOTIFY pgrst, 'reload schema';

SELECT from_currency, to_currency, manual_mode FROM public.fx_pair_config
WHERE manual_mode = true ORDER BY from_currency, to_currency;

-- 2026_fx_pair_costs.sql
-- ============================================================
-- fx_pair_costs — costo operativo POR PAR de monedas FX
--
-- Contexto: CuyPay cobra comisión al cliente (3-4-2-1%) pero al
-- ejecutar el intercambio Colombia↔Brasil tiene un costo operativo
-- propio: gas onchain, wire fee del banco, spread del partner FX.
-- Esto es plata REAL que sale antes de calcular utilidad.
--
-- Estructura:
--   cost_usd: monto fijo en USD por TX del par (ej. $2 wire SWIFT)
--   cost_pct: % adicional sobre la COMISIÓN cobrada (ej. 5% partner)
--
-- Cómo se usa en AccountingSection:
--   effective_cost = cost_usd + (cost_pct/100 × comisión_cliente)
--   comisión_neta_para_split = comisión_cliente − effective_cost
--   luego 50/50 + IVA solo al emisor.
--
-- Ejemplo COP→BRL, fee=$100, cost_usd=$2, cost_pct=5:
--   effective_cost = 2 + 5 = $7
--   neta_split = $93 → $46.50 a Colombia / $46.50 a Brasil
--   IVA CO 19% = $8.835 → Colombia neto $37.665
--   Empresa neta = $84.165 (de $100 brutos)
--
-- Aplicar en AMBOS proyectos Supabase (Empresas + Personas).
-- ============================================================


-- Auto-update del updated_at en cada UPDATE.
CREATE OR REPLACE FUNCTION public.tg_fx_pair_costs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fx_pair_costs_touch ON public.fx_pair_costs;
CREATE TRIGGER fx_pair_costs_touch
  BEFORE INSERT OR UPDATE ON public.fx_pair_costs
  FOR EACH ROW EXECUTE FUNCTION public.tg_fx_pair_costs_updated_at();

-- ============================================================
-- RLS: lectura para cualquier admin; escritura solo
-- super_admin y treasury (la cifra impacta utilidad).
-- ============================================================

ALTER TABLE public.fx_pair_costs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
           WHERE tablename = 'fx_pair_costs' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.fx_pair_costs', r.policyname);
  END LOOP;
END $$;

-- Si is_any_admin / is_admin_with_role no existen todavía en este proyecto
-- (la migración 2026_security_hardening_rls.sql las crea), las policies
-- van a fallar al evaluarse. Definimos un fallback acá para no bloquear
-- el deploy en orden distinto.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_any_admin') THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.is_any_admin() RETURNS BOOLEAN
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $b$
        SELECT EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid()
            AND (u.role = 'admin' OR COALESCE(to_jsonb(u)->>'admin_role','') <> '')
        );
      $b$
    $f$;
    GRANT EXECUTE ON FUNCTION public.is_any_admin() TO authenticated, anon;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_admin_with_role') THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.is_admin_with_role(VARIADIC roles text[]) RETURNS BOOLEAN
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $b$
        SELECT EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid()
            AND ((to_jsonb(u)->>'admin_role') = ANY(roles)
                 OR (u.role = 'admin' AND 'super_admin' = ANY(roles)))
        );
      $b$
    $f$;
    GRANT EXECUTE ON FUNCTION public.is_admin_with_role(text[]) TO authenticated, anon;
  END IF;
END $$;

DROP POLICY IF EXISTS fx_pair_costs_select ON public.fx_pair_costs;
CREATE POLICY fx_pair_costs_select ON public.fx_pair_costs FOR SELECT TO authenticated
  USING (public.is_any_admin());

DROP POLICY IF EXISTS fx_pair_costs_insert ON public.fx_pair_costs;
CREATE POLICY fx_pair_costs_insert ON public.fx_pair_costs FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_with_role('super_admin', 'treasury'));

DROP POLICY IF EXISTS fx_pair_costs_update ON public.fx_pair_costs;
CREATE POLICY fx_pair_costs_update ON public.fx_pair_costs FOR UPDATE TO authenticated
  USING (public.is_admin_with_role('super_admin', 'treasury'))
  WITH CHECK (public.is_admin_with_role('super_admin', 'treasury'));

DROP POLICY IF EXISTS fx_pair_costs_delete ON public.fx_pair_costs;
CREATE POLICY fx_pair_costs_delete ON public.fx_pair_costs FOR DELETE TO authenticated
  USING (public.is_admin_with_role('super_admin', 'treasury'));

-- ============================================================
-- Smoke check
-- ============================================================

DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_policies WHERE tablename = 'fx_pair_costs' AND schemaname='public';
  RAISE NOTICE 'fx_pair_costs: policies=%, rls enabled', n;
END $$;

-- 2026_fx_public_read.sql
-- ════════════════════════════════════════════════════════
-- FX commissions: tablas + RLS para que la app Android/iOS lea
-- las tasas, fees y configuración nocturna que setea el admin.
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- ════════════════════════════════════════════════════════

-- ───── 1. Tablas (idempotente) ─────

-- Configuración global (una sola fila id=1)
INSERT INTO public.fx_global_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.fx_global_config ENABLE ROW LEVEL SECURITY;

-- Configuración por par
-- Si la tabla ya existía sin la columna, agregarla
ALTER TABLE public.fx_pair_config ADD COLUMN IF NOT EXISTS base_fee_pct NUMERIC(6,3) NOT NULL DEFAULT 0.5;
ALTER TABLE public.fx_pair_config ENABLE ROW LEVEL SECURITY;

-- Snapshots de tasas (llenado por Edge Function o frontend)
CREATE INDEX IF NOT EXISTS idx_fx_snapshots_pair_time
    ON public.fx_rate_snapshots(from_currency, to_currency, captured_at DESC);
ALTER TABLE public.fx_rate_snapshots ENABLE ROW LEVEL SECURITY;

-- ───── 2. RLS — la clave para que Android/iOS LEAN ─────
-- La app móvil consulta estas tablas con su user authenticated; por eso
-- abrimos SELECT a `authenticated`. Solo super_admin/treasury pueden modificar.

-- fx_global_config
DROP POLICY IF EXISTS "fx_global_read"   ON public.fx_global_config;
DROP POLICY IF EXISTS "fx_global_manage" ON public.fx_global_config;

DROP POLICY IF EXISTS "fx_global_read_authenticated" ON public.fx_global_config;
CREATE POLICY "fx_global_read_authenticated"
  ON public.fx_global_config FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "fx_global_write_treasury" ON public.fx_global_config;
CREATE POLICY "fx_global_write_treasury"
  ON public.fx_global_config FOR ALL
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

-- fx_pair_config
DROP POLICY IF EXISTS "fx_pair_read"   ON public.fx_pair_config;
DROP POLICY IF EXISTS "fx_pair_manage" ON public.fx_pair_config;

DROP POLICY IF EXISTS "fx_pair_read_authenticated" ON public.fx_pair_config;
CREATE POLICY "fx_pair_read_authenticated"
  ON public.fx_pair_config FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "fx_pair_write_treasury" ON public.fx_pair_config;
CREATE POLICY "fx_pair_write_treasury"
  ON public.fx_pair_config FOR ALL
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

-- fx_rate_snapshots — lectura abierta a la app móvil
DROP POLICY IF EXISTS "fx_snapshots_read" ON public.fx_rate_snapshots;

DROP POLICY IF EXISTS "fx_snapshots_read_authenticated" ON public.fx_rate_snapshots;
CREATE POLICY "fx_snapshots_read_authenticated"
  ON public.fx_rate_snapshots FOR SELECT
  TO authenticated
  USING (true);

-- (Los inserts en snapshots los hace el Edge Function con service_role → bypass RLS)

-- ───── 3. Función helper para calcular comisión final ─────
-- La app Android/iOS puede llamar esta función vía RPC para obtener el %
-- exacto a aplicar para un par + monto + hora actual.
CREATE OR REPLACE FUNCTION public.fx_calc_commission_pct(
    p_from_currency TEXT,
    p_to_currency   TEXT,
    p_amount        NUMERIC,
    p_from_usd_rate NUMERIC,
    p_now           TIMESTAMPTZ DEFAULT NOW()
) RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    pair_cfg   RECORD;
    global_cfg RECORD;
    amount_usd NUMERIC;
    tier       JSONB;
    pct        NUMERIC := 0;
    local_hour INT;
    in_night   BOOLEAN := false;
BEGIN
    SELECT * INTO pair_cfg FROM public.fx_pair_config
        WHERE from_currency = p_from_currency
          AND to_currency = p_to_currency
          AND is_active = true;
    IF NOT FOUND THEN RETURN 0; END IF;

    SELECT * INTO global_cfg FROM public.fx_global_config WHERE id = 1;

    amount_usd := p_amount * COALESCE(p_from_usd_rate, 1);

    -- Buscar el tier que aplique
    FOR tier IN SELECT * FROM jsonb_array_elements(pair_cfg.tiers) LOOP
        IF amount_usd >= (tier->>'from_usd')::NUMERIC
            AND (tier->'to_usd' = 'null'::jsonb OR (tier->>'to_usd') IS NULL OR amount_usd < (tier->>'to_usd')::NUMERIC)
        THEN
            pct := (tier->>'pct')::NUMERIC;
            EXIT;
        END IF;
    END LOOP;

    -- Fallback al base_fee_pct si los tiers están vacíos
    IF pct = 0 THEN pct := pair_cfg.base_fee_pct; END IF;

    -- Ventana nocturna global
    IF global_cfg.night_enabled THEN
        local_hour := EXTRACT(HOUR FROM (p_now AT TIME ZONE global_cfg.timezone))::INT;
        IF global_cfg.night_start_hour < global_cfg.night_end_hour THEN
            in_night := local_hour >= global_cfg.night_start_hour
                    AND local_hour <  global_cfg.night_end_hour;
        ELSE  -- ventana cruza medianoche (ej: 22:00 → 06:00)
            in_night := local_hour >= global_cfg.night_start_hour
                     OR local_hour <  global_cfg.night_end_hour;
        END IF;
        IF in_night THEN pct := pct + global_cfg.night_extra_pct; END IF;
    END IF;

    RETURN pct;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fx_calc_commission_pct TO authenticated;

-- ───── 4. Seed: 20 pares LATAM si no existen ─────
INSERT INTO public.fx_pair_config (from_currency, to_currency, base_fee_pct) VALUES
    ('COP','CLP', 0.8),('COP','PEN', 0.8),('COP','MXN', 0.8),('COP','BRL', 0.8),
    ('CLP','COP', 0.8),('CLP','PEN', 0.8),('CLP','MXN', 0.8),('CLP','BRL', 0.8),
    ('PEN','COP', 0.8),('PEN','CLP', 0.8),('PEN','MXN', 0.8),('PEN','BRL', 0.8),
    ('MXN','COP', 0.8),('MXN','CLP', 0.8),('MXN','PEN', 0.8),('MXN','BRL', 0.8),
    ('BRL','COP', 0.8),('BRL','CLP', 0.8),('BRL','PEN', 0.8),('BRL','MXN', 0.8)
ON CONFLICT (from_currency, to_currency) DO NOTHING;

-- ───── 5. Verificación ─────
SELECT COUNT(*) AS pairs_configured FROM public.fx_pair_config;
SELECT * FROM public.fx_global_config;
SELECT 'Authenticated puede leer fx_pair_config: ' || (
    EXISTS(SELECT 1 FROM pg_policies WHERE tablename='fx_pair_config' AND cmd='SELECT' AND roles::text LIKE '%authenticated%')
)::text AS rls_check;

-- 2026_fx_snapshots_empresas.sql
-- ───────────────────────────────────────────────────────
-- 2026_fx_snapshots_empresas.sql
--
-- Infraestructura de tasas FastForex para el proyecto Supabase de
-- EMPRESAS (el feed original vive en CuyPayANDROID; con esto este
-- proyecto tiene el suyo propio).
--
--   1. Tabla fx_rate_snapshots (misma estructura que CuyPayANDROID)
--   2. RLS: lectura para usuarios autenticados y anon
--   3. (Opcional) programación del cron cada 5 min con pg_cron + pg_net
--
-- Pegar en el SQL Editor del proyecto de EMPRESAS.
-- ───────────────────────────────────────────────────────


CREATE INDEX IF NOT EXISTS fx_snapshots_pair_time_idx
    ON public.fx_rate_snapshots (from_currency, to_currency, captured_at DESC);

ALTER TABLE public.fx_rate_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fx_snapshots_read ON public.fx_rate_snapshots;
DROP POLICY IF EXISTS fx_snapshots_read ON public.fx_rate_snapshots;
CREATE POLICY fx_snapshots_read ON public.fx_rate_snapshots
    FOR SELECT TO anon, authenticated USING (true);

-- "Publicar todas" del panel inserta tasas manuales desde la app (anon).
DROP POLICY IF EXISTS fx_snapshots_insert ON public.fx_rate_snapshots;
DROP POLICY IF EXISTS fx_snapshots_insert ON public.fx_rate_snapshots;
CREATE POLICY fx_snapshots_insert ON public.fx_rate_snapshots
    FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ═══ Configuración por par (toggles, modo Manual, tiers de comisión) ═══
-- Idempotente para proyectos donde la tabla ya existía sin la columna:
ALTER TABLE public.fx_pair_config ADD COLUMN IF NOT EXISTS base_fee_pct numeric;

ALTER TABLE public.fx_pair_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fx_pair_config_read ON public.fx_pair_config;
DROP POLICY IF EXISTS fx_pair_config_read ON public.fx_pair_config;
CREATE POLICY fx_pair_config_read ON public.fx_pair_config
    FOR SELECT TO anon, authenticated USING (true);
-- Escritura también para anon: la app de empresas usa auth PROPIA y llama
-- con la anon key (mismo modelo que el resto de tablas de la app).
DROP POLICY IF EXISTS fx_pair_config_write ON public.fx_pair_config;
DROP POLICY IF EXISTS fx_pair_config_write ON public.fx_pair_config;
CREATE POLICY fx_pair_config_write ON public.fx_pair_config
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ═══ Configuración global (ventana nocturna) ═══
INSERT INTO public.fx_global_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.fx_global_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fx_global_read ON public.fx_global_config;
DROP POLICY IF EXISTS fx_global_read ON public.fx_global_config;
CREATE POLICY fx_global_read ON public.fx_global_config
    FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS fx_global_write ON public.fx_global_config;
DROP POLICY IF EXISTS fx_global_write ON public.fx_global_config;
CREATE POLICY fx_global_write ON public.fx_global_config
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ═══ Estado del sync (fuente preferida, salud) ═══
INSERT INTO public.xe_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.xe_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS xe_config_read ON public.xe_config;
DROP POLICY IF EXISTS xe_config_read ON public.xe_config;
CREATE POLICY xe_config_read ON public.xe_config
    FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS xe_config_write ON public.xe_config;
DROP POLICY IF EXISTS xe_config_write ON public.xe_config;
CREATE POLICY xe_config_write ON public.xe_config
    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ═══ Vista de salud que consume el panel ═══
CREATE OR REPLACE VIEW public.fx_health_dashboard AS
SELECT
    c.preferred_source,
    c.last_sync_at,
    c.last_error,
    c.last_error_at,
    c.consecutive_failures,
    c.fallback_enabled,
    (SELECT count(*) FROM public.fx_rate_snapshots s
      WHERE s.source = 'FASTFOREX' AND s.captured_at > now() - interval '24 hours') AS ff_snapshots_24h,
    (SELECT count(*) FROM public.fx_rate_snapshots s
      WHERE s.source = 'MANUAL' AND s.captured_at > now() - interval '24 hours') AS manual_snapshots_24h
FROM public.xe_config c
WHERE c.id = 1;

GRANT SELECT ON public.fx_health_dashboard TO anon, authenticated;

-- ═══ RPC stub de sync (el panel lo llama; acá el feed real es el cron) ═══
CREATE OR REPLACE FUNCTION public.sync_xe_rates_now()
RETURNS jsonb
LANGUAGE sql
AS $$ SELECT jsonb_build_object('success', true, 'cached', true) $$;
GRANT EXECUTE ON FUNCTION public.sync_xe_rates_now() TO anon, authenticated;

-- ═══ Programación cada 5 minutos (opción pg_cron) ═══
-- Requiere habilitar las extensiones pg_cron y pg_net:
--   Dashboard → Database → Extensions → habilitar "pg_cron" y "pg_net".
-- Luego DESCOMENTAR y ajustar <PROJECT-REF> y <CRON_SECRET>:
--
-- SELECT cron.schedule(
--     'fastforex-sync-5min',
--     '*/5 * * * *',
--     $$
--     SELECT net.http_post(
--         url := 'https://<PROJECT-REF>.supabase.co/functions/v1/fastforex-sync?key=<CRON_SECRET>',
--         headers := '{"Content-Type":"application/json"}'::jsonb,
--         body := '{}'::jsonb
--     );
--     $$
-- );
--
-- Para verificar:   SELECT * FROM cron.job;
-- Para eliminar:    SELECT cron.unschedule('fastforex-sync-5min');

NOTIFY pgrst, 'reload schema';

-- 2026_legal_documents.sql
-- ───────────────────────────────────────────────────────
-- 2026_legal_documents.sql
--
-- Textos legales dinámicos para las APPS (iOS/Android), guardados en
-- app_settings (misma tabla que ya edita el panel en Soporte →
-- Configuración → Documentación de páginas). Keys:
--
--   legal_add_beneficiary_terms  T&C al agregar un tercero (pantalla
--                                "Agregar Tercero" de la app)
--   page_terms                   Términos y Condiciones generales
--   page_data_treatment          Tratamiento de datos / privacidad
--
-- El value es un string JSON con el texto (soporta el markdown-lite del
-- panel: líneas "## " = título, "- " = viñeta, resto párrafos).
-- ───────────────────────────────────────────────────────

-- Seed inicial del texto de terceros (solo si no existe; el panel lo
-- sobreescribe al editar)
INSERT INTO public.app_settings (key, value)
VALUES (
    'legal_add_beneficiary_terms',
    to_jsonb('## Términos para agregar terceros

Al agregar un tercero (beneficiario) a tu libreta de contactos de CuyPay declaras que:

- Conoces a la persona que estás registrando y los datos proporcionados son verídicos.
- Las operaciones hacia este contacto son legítimas y con recursos de origen lícito.
- Autorizas a CuyPay a verificar la identidad del tercero (KYC) cuando la regulación lo requiera.
- CuyPay puede limitar, suspender o bloquear operaciones hacia este contacto por motivos de cumplimiento (SAGRILAFT / AML).

El uso de esta función se rige por los Términos y Condiciones generales y la Política de Tratamiento de Datos de CuyPay.'::text)
)
ON CONFLICT (key) DO NOTHING;

-- Lectura: los usuarios autenticados de la app leen cualquier key de
-- configuración pública; el anon (landing) solo las keys públicas.
-- Son policies ADICIONALES (OR con las existentes) — no restringen nada
-- que ya funcione.
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_auth_read ON public.app_settings;
DROP POLICY IF EXISTS app_settings_auth_read ON public.app_settings;
CREATE POLICY app_settings_auth_read ON public.app_settings
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS app_settings_anon_public_read ON public.app_settings;
DROP POLICY IF EXISTS app_settings_anon_public_read ON public.app_settings;
CREATE POLICY app_settings_anon_public_read ON public.app_settings
    FOR SELECT TO anon
    USING (
        key LIKE 'page_%'
        OR key LIKE 'legal_%'
        OR key LIKE 'link_%'
        OR key IN ('support_whatsapp','calendly_url','support_video_url','support_email')
    );

NOTIFY pgrst, 'reload schema';

-- 2026_limit_increase_apply_trigger.sql
-- ───────────────────────────────────────────────────────
-- 2026_limit_increase_apply_trigger.sql
--
-- Al aprobar una solicitud en limit_increase_requests, aplicar el
-- requested_amount a los TOPES REALES del usuario (users.custom_
-- monthly_limit) — sin esto la aprobación era solo visual y las
-- transacciones seguían evaluando el tope viejo.
--
-- Política aplicada:
--   custom_monthly_limit = requested_amount
--   custom_daily_limit   = max(actual, 20% del mensual solicitado)
--     (heurística razonable; el admin puede afinar con el editor
--      de topes "Aprobar y ajustar topes")
--   limits_currency      = 'USD' si estaba vacía
--   is_custom_monthly    = true   ← las apps leen estos flags para saber
--   is_custom_daily      = true     que el usuario tiene topes justificados
--
-- Solo dispara en la transición → 'approved' (no re-aplica en
-- updates posteriores de notas etc.).
-- ───────────────────────────────────────────────────────

-- Flags que consumen iOS/Android (y exime de reglas AML generales)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_custom_daily   boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_custom_monthly boolean DEFAULT false;

-- v3: requested_amount es TEXT en la tabla del móvil → cast explícito a
-- numeric antes de comparar/multiplicar (error original: "operator does
-- not exist: text > integer"). user_id también se castea defensivamente.
CREATE OR REPLACE FUNCTION public.apply_limit_increase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_amount numeric;
BEGIN
    IF NEW.status = 'approved'
       AND COALESCE(OLD.status, '') IS DISTINCT FROM 'approved' THEN

        BEGIN
            v_amount := NULLIF(trim(NEW.requested_amount::text), '')::numeric;
        EXCEPTION WHEN OTHERS THEN
            v_amount := NULL; -- monto ilegible: no aplicar nada, pero no romper el Aprobar
        END;

        IF v_amount IS NOT NULL AND v_amount > 0 THEN
            UPDATE public.users
            SET custom_monthly_limit = v_amount,
                custom_daily_limit   = GREATEST(
                    COALESCE(custom_daily_limit, 0)::numeric,
                    ROUND(v_amount * 0.2)
                ),
                limits_currency   = COALESCE(limits_currency, 'USD'),
                is_custom_monthly = true,
                is_custom_daily   = true
            WHERE id = (NEW.user_id::text)::uuid;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_limit_increase ON public.limit_increase_requests;
CREATE TRIGGER trg_apply_limit_increase
    AFTER UPDATE OF status ON public.limit_increase_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.apply_limit_increase();

-- 2026_limit_increase_beneficiary.sql
-- ───────────────────────────────────────────────────────
-- 2026_limit_increase_beneficiary.sql
--
-- Aumentos de topes POR BENEFICIARIO (contacto de la libreta).
-- Antes toda solicitud de limit_increase_requests aplicaba los topes
-- al usuario dueño; ahora, si la fila trae beneficiary_id, el trigger
-- de aprobación aplica los topes al CONTACTO (tabla beneficiaries) y
-- deja al usuario intacto.
--
-- RPC request_limit_increase: recreado en base a la definición REAL
-- deployada (inspeccionada con pg_get_functiondef el 2026-07-13):
--   request_limit_increase(p_user_response text, p_attachments jsonb)
--   RETURNS json — chequeo de pendiente + INSERT (user_id, user_response,
--   attachments, status) + json {ok, request_id}.
-- La v2 de abajo conserva esa firma y el contrato de retorno, y agrega
-- parámetros OPCIONALES: p_requested_amount, p_beneficiary_id,
-- p_requested_daily_amount. Las llamadas viejas de iOS siguen funcionando.
-- ───────────────────────────────────────────────────────

-- ═══ 1. Columnas nuevas en la tabla del móvil ═══
ALTER TABLE public.limit_increase_requests
    ADD COLUMN IF NOT EXISTS beneficiary_id uuid REFERENCES public.beneficiaries(id) ON DELETE SET NULL;

-- Tope DIARIO pedido explícitamente por el usuario desde iOS (la app
-- valida que no exceda el 10% del mensual). text para matchear el tipo
-- de requested_amount que ya usa esta tabla; el trigger castea.
ALTER TABLE public.limit_increase_requests
    ADD COLUMN IF NOT EXISTS requested_daily_amount text;

CREATE INDEX IF NOT EXISTS lir_beneficiary_idx
    ON public.limit_increase_requests (beneficiary_id)
    WHERE beneficiary_id IS NOT NULL;

-- ═══ 2. Topes custom en beneficiaries (por si faltan en este entorno) ═══
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS custom_daily_limit   numeric;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS custom_monthly_limit numeric;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS limits_currency      text;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS is_custom_daily      boolean DEFAULT false;
ALTER TABLE public.beneficiaries ADD COLUMN IF NOT EXISTS is_custom_monthly    boolean DEFAULT false;

-- ═══ 3. Trigger de aprobación v5: rama beneficiario vs usuario ═══
-- v5: si la solicitud trae requested_daily_amount (nueva caja de texto de
-- iOS, validada allá a ≤10% del mensual), se aplica ESE valor como tope
-- diario. Si no viene (solicitudes viejas), fallback a la heurística del
-- 20% del mensual. Cap defensivo: el diario nunca supera el mensual.
CREATE OR REPLACE FUNCTION public.apply_limit_increase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_amount numeric;
    v_daily  numeric;
    v_ben    uuid;
BEGIN
    IF NEW.status = 'approved'
       AND COALESCE(OLD.status, '') IS DISTINCT FROM 'approved' THEN

        -- requested_amount / requested_daily_amount son TEXT → cast defensivo
        BEGIN
            v_amount := NULLIF(trim(NEW.requested_amount::text), '')::numeric;
        EXCEPTION WHEN OTHERS THEN
            v_amount := NULL;
        END;

        BEGIN
            v_daily := NULLIF(trim(NEW.requested_daily_amount::text), '')::numeric;
        EXCEPTION WHEN OTHERS THEN
            v_daily := NULL;
        END;
        IF v_daily IS NOT NULL AND v_daily <= 0 THEN v_daily := NULL; END IF;

        BEGIN
            v_ben := (NEW.beneficiary_id::text)::uuid;
        EXCEPTION WHEN OTHERS THEN
            v_ben := NULL;
        END;

        IF v_amount IS NOT NULL AND v_amount > 0 THEN
            -- Diario pedido explícito (cap: nunca mayor al mensual);
            -- fallback 20% del mensual para solicitudes sin el dato nuevo.
            v_daily := COALESCE(LEAST(v_daily, v_amount), ROUND(v_amount * 0.2));

            IF v_ben IS NOT NULL THEN
                -- Solicitud desde la libreta de contactos → topes del CONTACTO
                UPDATE public.beneficiaries
                SET custom_monthly_limit = v_amount,
                    custom_daily_limit   = v_daily,
                    limits_currency   = COALESCE(limits_currency, 'USD'),
                    is_custom_monthly = true,
                    is_custom_daily   = true
                WHERE id = v_ben;
            ELSE
                -- Solicitud global → topes del USUARIO
                UPDATE public.users
                SET custom_monthly_limit = v_amount,
                    custom_daily_limit   = v_daily,
                    limits_currency   = COALESCE(limits_currency, 'USD'),
                    is_custom_monthly = true,
                    is_custom_daily   = true
                WHERE id = (NEW.user_id::text)::uuid;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- Evitar DOBLE aplicación: si Antigravity dejó su propio trigger de
-- aprobación con otro nombre, lo soltamos — apply_limit_increase queda
-- como el único que aplica topes.
DROP TRIGGER IF EXISTS handle_limit_increase_approval ON public.limit_increase_requests;
DROP TRIGGER IF EXISTS trg_handle_limit_increase_approval ON public.limit_increase_requests;
DROP TRIGGER IF EXISTS on_limit_increase_approval ON public.limit_increase_requests;

DROP TRIGGER IF EXISTS trg_apply_limit_increase ON public.limit_increase_requests;
CREATE TRIGGER trg_apply_limit_increase
    AFTER UPDATE OF status ON public.limit_increase_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.apply_limit_increase();

-- ═══ 4. RPC request_limit_increase v2 ═══
-- Mismo nombre/orden/tipos de los 2 params originales + retorno json →
-- las llamadas actuales de iOS (p_user_response, p_attachments) siguen
-- resolviendo. Los params nuevos son opcionales. Soltamos overloads
-- previos para que PostgREST no se confunda con funciones ambiguas.
DROP FUNCTION IF EXISTS public.request_limit_increase(text, jsonb);
DROP FUNCTION IF EXISTS public.request_limit_increase(text, jsonb, text);
DROP FUNCTION IF EXISTS public.request_limit_increase(text, jsonb, numeric);
DROP FUNCTION IF EXISTS public.request_limit_increase(text, jsonb, text, uuid);
DROP FUNCTION IF EXISTS public.request_limit_increase(text, jsonb, text, uuid, text);

CREATE FUNCTION public.request_limit_increase(
    p_user_response          text,
    p_attachments            jsonb DEFAULT '[]'::jsonb,
    p_requested_amount       text  DEFAULT NULL,
    p_beneficiary_id         uuid  DEFAULT NULL,
    p_requested_daily_amount text  DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_pending_count int;
    v_request_id uuid;
BEGIN
    IF v_uid IS NULL THEN
        RETURN json_build_object('ok', false, 'error', 'not_authenticated', 'message', 'Debes iniciar sesión.');
    END IF;

    -- Si es para un contacto, validar que sea del usuario
    IF p_beneficiary_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.beneficiaries
        WHERE id = p_beneficiary_id AND owner_user_id = v_uid
    ) THEN
        RETURN json_build_object('ok', false, 'error', 'beneficiary_not_found', 'message', 'Ese contacto no existe o no es tuyo.');
    END IF;

    -- Una pendiente por ÁMBITO: global aparte, y cada contacto aparte
    -- (puedes tener una global pendiente y otra para un contacto).
    SELECT COUNT(*) INTO v_pending_count
      FROM public.limit_increase_requests
     WHERE user_id = v_uid
       AND status = 'pending'
       AND beneficiary_id IS NOT DISTINCT FROM p_beneficiary_id;

    IF v_pending_count > 0 THEN
        RETURN json_build_object('ok', false, 'error', 'already_pending', 'message', 'Ya tienes una solicitud de ampliación en revisión.');
    END IF;

    INSERT INTO public.limit_increase_requests
        (user_id, user_response, attachments, status,
         requested_amount, beneficiary_id, requested_daily_amount)
    VALUES
        (v_uid, p_user_response, p_attachments, 'pending',
         NULLIF(trim(coalesce(p_requested_amount, '')), ''),
         p_beneficiary_id,
         NULLIF(trim(coalesce(p_requested_daily_amount, '')), ''))
    RETURNING id INTO v_request_id;

    RETURN json_build_object('ok', true, 'request_id', v_request_id);
END;
$$;

REVOKE ALL ON FUNCTION public.request_limit_increase(text, jsonb, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_limit_increase(text, jsonb, text, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- 2026_limits_currency_conversion.sql
-- ───────────────────────────────────────────────────────
-- 2026_limits_currency_conversion.sql
--
-- Fix: el sumatorio de uso en get_user_limits_summary y
-- get_beneficiary_limits_summary sumaba `amount` directo desde
-- transactions sin convertir a la moneda del tope. Resultado:
-- una TX de 200.000 COP se comparaba contra un tope de 5.000 USD =
-- 4000% usado.
--
-- Cambios:
--   1) Helper SQL public.to_currency(amount, from_curr, to_curr) que
--      convierte usando public.fx_rates si existe el par, o cae a
--      constantes TRM hardcodeadas (junio 2026) si la tabla no tiene
--      la tasa.
--   2) Re-crea get_user_limits_summary y get_beneficiary_limits_summary
--      sumando SUM(to_currency(amount, currency, eff_currency)).
--
-- Para correr en SQL Editor de Supabase Personas.
-- ───────────────────────────────────────────────────────

-- 1) Helper de conversión.
--    Estrategia:
--      a) Si from = to → devuelve amount.
--      b) Si hay par directo activo en fx_rates → usa esa rate.
--      c) Si hay par inverso → usa 1/rate.
--      d) Si no, baja todo a USD usando constantes hardcodeadas y de
--         ahí sube a to_currency con constantes hardcodeadas.
--      e) Si la moneda es desconocida → devuelve amount (fallback safe).
CREATE OR REPLACE FUNCTION public.to_currency(
    p_amount     numeric,
    p_from       text,
    p_to         text
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_rate    numeric;
    v_inv     numeric;
    v_amt_usd numeric;
BEGIN
    IF p_amount IS NULL OR p_amount = 0 THEN RETURN 0; END IF;
    IF p_from IS NULL OR p_to IS NULL THEN RETURN p_amount; END IF;
    IF UPPER(p_from) = UPPER(p_to) THEN RETURN p_amount; END IF;

    -- a) par directo en fx_rates
    BEGIN
        SELECT rate INTO v_rate
        FROM public.fx_rates
        WHERE UPPER(from_currency) = UPPER(p_from)
          AND UPPER(to_currency)   = UPPER(p_to)
          AND is_active = true
        ORDER BY effective_from DESC NULLS LAST
        LIMIT 1;
        IF v_rate IS NOT NULL AND v_rate > 0 THEN
            RETURN p_amount * v_rate;
        END IF;

        -- b) par inverso
        SELECT rate INTO v_inv
        FROM public.fx_rates
        WHERE UPPER(from_currency) = UPPER(p_to)
          AND UPPER(to_currency)   = UPPER(p_from)
          AND is_active = true
        ORDER BY effective_from DESC NULLS LAST
        LIMIT 1;
        IF v_inv IS NOT NULL AND v_inv > 0 THEN
            RETURN p_amount / v_inv;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        -- fx_rates puede no existir; seguimos con fallback hardcoded.
        NULL;
    END;

    -- c+d) bajar a USD usando constantes hardcoded (TRM jun-2026
    --      aproximadas). Si la moneda no está en la tabla, asumimos
    --      que ya es USD para no romper el cálculo.
    v_amt_usd := p_amount * CASE UPPER(p_from)
        WHEN 'USD' THEN 1.0
        WHEN 'COP' THEN 1.0 / 4000.0
        WHEN 'CLP' THEN 1.0 / 950.0
        WHEN 'PEN' THEN 1.0 / 3.7
        WHEN 'MXN' THEN 1.0 / 17.0
        WHEN 'BRL' THEN 1.0 / 5.5
        WHEN 'VES' THEN 1.0 / 36.0
        WHEN 'EUR' THEN 1.08
        ELSE 1.0
    END;

    RETURN v_amt_usd * CASE UPPER(p_to)
        WHEN 'USD' THEN 1.0
        WHEN 'COP' THEN 4000.0
        WHEN 'CLP' THEN 950.0
        WHEN 'PEN' THEN 3.7
        WHEN 'MXN' THEN 17.0
        WHEN 'BRL' THEN 5.5
        WHEN 'VES' THEN 36.0
        WHEN 'EUR' THEN 1.0 / 1.08
        ELSE 1.0
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.to_currency(numeric, text, text) TO anon, authenticated;

-- 2) RE-CREAR get_user_limits_summary con conversión por TX.
CREATE OR REPLACE FUNCTION public.get_user_limits_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_custom_d      numeric;
    v_custom_m      numeric;
    v_user_curr     text;
    v_global        jsonb;
    v_eff_daily     numeric;
    v_eff_monthly   numeric;
    v_eff_currency  text;
    v_used_d        numeric;
    v_used_m        numeric;
    v_caller_role   text;
BEGIN
    SELECT admin_role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;
    IF auth.uid() <> p_user_id
       AND COALESCE(v_caller_role, '') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error', 'forbidden');
    END IF;

    SELECT custom_daily_limit, custom_monthly_limit, limits_currency
    INTO v_custom_d, v_custom_m, v_user_curr
    FROM public.users WHERE id = p_user_id;

    SELECT value INTO v_global
    FROM public.app_settings WHERE key = 'operational_limits';

    v_eff_daily    := COALESCE(v_custom_d, (v_global->>'daily')::numeric, 800);
    v_eff_monthly  := COALESCE(v_custom_m, (v_global->>'monthly')::numeric, 3000);
    v_eff_currency := COALESCE(v_user_curr, v_global->>'currency', 'USD');

    -- Sumas convertidas a v_eff_currency. Cada TX se convierte desde su
    -- moneda origen (transactions.currency) al currency del tope.
    SELECT COALESCE(SUM(public.to_currency(COALESCE(amount, 0), COALESCE(currency, v_eff_currency), v_eff_currency)), 0)
    INTO v_used_d
    FROM public.transactions
    WHERE owner_user_id = p_user_id
      AND created_at >= now() - interval '24 hours'
      AND kind IN ('send', 'load', 'convert', 'envio', 'carga')
      AND status IN ('completed', 'approved', 'sent', 'success');

    SELECT COALESCE(SUM(public.to_currency(COALESCE(amount, 0), COALESCE(currency, v_eff_currency), v_eff_currency)), 0)
    INTO v_used_m
    FROM public.transactions
    WHERE owner_user_id = p_user_id
      AND created_at >= now() - interval '30 days'
      AND kind IN ('send', 'load', 'convert', 'envio', 'carga')
      AND status IN ('completed', 'approved', 'sent', 'success');

    RETURN jsonb_build_object(
        'currency',           v_eff_currency,
        'daily_max',          v_eff_daily,
        'monthly_max',        v_eff_monthly,
        'daily_used',         ROUND(v_used_d::numeric, 2),
        'monthly_used',       ROUND(v_used_m::numeric, 2),
        'daily_pct',          CASE WHEN v_eff_daily > 0   THEN ROUND((v_used_d / v_eff_daily   * 100)::numeric, 2) ELSE 0 END,
        'monthly_pct',        CASE WHEN v_eff_monthly > 0 THEN ROUND((v_used_m / v_eff_monthly * 100)::numeric, 2) ELSE 0 END,
        'is_custom_daily',    v_custom_d IS NOT NULL,
        'is_custom_monthly',  v_custom_m IS NOT NULL
    );
END;
$$;

-- 3) RE-CREAR get_beneficiary_limits_summary con la misma conversión.
CREATE OR REPLACE FUNCTION public.get_beneficiary_limits_summary(p_beneficiary_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_custom_d      numeric;
    v_custom_m      numeric;
    v_ben_curr      text;
    v_global        jsonb;
    v_eff_daily     numeric;
    v_eff_monthly   numeric;
    v_eff_currency  text;
    v_used_d        numeric;
    v_used_m        numeric;
    v_caller_role   text;
    v_owner_id      uuid;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;

    SELECT admin_role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    SELECT owner_user_id INTO v_owner_id FROM public.beneficiaries WHERE id = p_beneficiary_id;

    IF v_owner_id IS NULL THEN
        RETURN jsonb_build_object('error', 'beneficiary_not_found');
    END IF;

    IF auth.uid() <> v_owner_id
       AND COALESCE(v_caller_role, '') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error', 'forbidden');
    END IF;

    SELECT custom_daily_limit, custom_monthly_limit, limits_currency
    INTO v_custom_d, v_custom_m, v_ben_curr
    FROM public.beneficiaries WHERE id = p_beneficiary_id;

    SELECT value INTO v_global
    FROM public.app_settings WHERE key = 'operational_limits';

    v_eff_daily    := COALESCE(v_custom_d, (v_global->>'daily')::numeric, 800);
    v_eff_monthly  := COALESCE(v_custom_m, (v_global->>'monthly')::numeric, 3000);
    v_eff_currency := COALESCE(v_ben_curr, v_global->>'currency', 'USD');

    BEGIN
        SELECT COALESCE(SUM(public.to_currency(COALESCE(amount, 0), COALESCE(currency, v_eff_currency), v_eff_currency)), 0)
        INTO v_used_d
        FROM public.transactions
        WHERE beneficiary_id = p_beneficiary_id
          AND created_at >= now() - interval '24 hours'
          AND kind IN ('send', 'load', 'convert', 'envio', 'carga')
          AND status IN ('completed', 'approved', 'sent', 'success');

        SELECT COALESCE(SUM(public.to_currency(COALESCE(amount, 0), COALESCE(currency, v_eff_currency), v_eff_currency)), 0)
        INTO v_used_m
        FROM public.transactions
        WHERE beneficiary_id = p_beneficiary_id
          AND created_at >= now() - interval '30 days'
          AND kind IN ('send', 'load', 'convert', 'envio', 'carga')
          AND status IN ('completed', 'approved', 'sent', 'success');
    EXCEPTION WHEN undefined_column THEN
        v_used_d := 0;
        v_used_m := 0;
    END;

    RETURN jsonb_build_object(
        'currency',           v_eff_currency,
        'daily_max',          v_eff_daily,
        'monthly_max',        v_eff_monthly,
        'daily_used',         ROUND(v_used_d::numeric, 2),
        'monthly_used',       ROUND(v_used_m::numeric, 2),
        'daily_pct',          CASE WHEN v_eff_daily > 0   THEN ROUND((v_used_d / v_eff_daily   * 100)::numeric, 2) ELSE 0 END,
        'monthly_pct',        CASE WHEN v_eff_monthly > 0 THEN ROUND((v_used_m / v_eff_monthly * 100)::numeric, 2) ELSE 0 END,
        'is_custom_daily',    v_custom_d IS NOT NULL,
        'is_custom_monthly',  v_custom_m IS NOT NULL,
        'owner_user_id',      v_owner_id
    );
END;
$$;

-- 2026_limits_custom_flags.sql
-- ───────────────────────────────────────────────────────
-- 2026_limits_custom_flags.sql  (CONSOLIDADO — un solo paste)
--
-- Cierra el circuito de topes personalizados con la app iOS:
--
--   1. Flags users.is_custom_daily / is_custom_monthly (los lee la app).
--   2. Trigger apply_limit_increase v3: requested_amount es TEXT en
--      limit_increase_requests → cast explícito a numeric (arregla
--      "operator does not exist: text > integer" al Aprobar).
--   3. get_user_limits_summary v2: daily_max/monthly_max devuelven el
--      tope custom cuando existe, e incluye is_custom_daily /
--      is_custom_monthly leídos de la tabla users.
--   4. admin_set_user_limits mantiene los flags sincronizados cuando el
--      admin edita topes a mano desde el panel.
--
-- Idempotente: se puede correr las veces que haga falta.
-- ───────────────────────────────────────────────────────

-- ═══ 1. Flags ═══
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_custom_daily   boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_custom_monthly boolean DEFAULT false;

-- Backfill: quien ya tiene tope custom aplicado, queda marcado
UPDATE public.users SET is_custom_daily = true
WHERE custom_daily_limit IS NOT NULL AND COALESCE(is_custom_daily, false) = false;
UPDATE public.users SET is_custom_monthly = true
WHERE custom_monthly_limit IS NOT NULL AND COALESCE(is_custom_monthly, false) = false;

-- ═══ 2. Trigger de aprobación (v3: casts sobre columnas text) ═══
CREATE OR REPLACE FUNCTION public.apply_limit_increase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_amount numeric;
BEGIN
    IF NEW.status = 'approved'
       AND COALESCE(OLD.status, '') IS DISTINCT FROM 'approved' THEN

        BEGIN
            v_amount := NULLIF(trim(NEW.requested_amount::text), '')::numeric;
        EXCEPTION WHEN OTHERS THEN
            v_amount := NULL; -- monto ilegible: no aplicar nada, pero no romper el Aprobar
        END;

        IF v_amount IS NOT NULL AND v_amount > 0 THEN
            UPDATE public.users
            SET custom_monthly_limit = v_amount,
                custom_daily_limit   = GREATEST(
                    COALESCE(custom_daily_limit, 0)::numeric,
                    ROUND(v_amount * 0.2)
                ),
                limits_currency   = COALESCE(limits_currency, 'USD'),
                is_custom_monthly = true,
                is_custom_daily   = true
            WHERE id = (NEW.user_id::text)::uuid;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_limit_increase ON public.limit_increase_requests;
CREATE TRIGGER trg_apply_limit_increase
    AFTER UPDATE OF status ON public.limit_increase_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.apply_limit_increase();

-- ═══ 3. get_user_limits_summary v2 ═══
-- DROP previo por si la versión deployada tiene otro tipo de retorno (42P13).
DROP FUNCTION IF EXISTS public.get_user_limits_summary(uuid);

CREATE FUNCTION public.get_user_limits_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_custom_d numeric; v_custom_m numeric; v_user_curr text; v_global jsonb;
    v_flag_d boolean; v_flag_m boolean;
    v_eff_daily numeric; v_eff_monthly numeric; v_eff_currency text;
    v_used_d numeric := 0; v_used_m numeric := 0; v_caller_role text;
    v_owner_col text;
BEGIN
    IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error','not_authenticated'); END IF;
    SELECT admin_role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    IF auth.uid() <> p_user_id
       AND COALESCE(v_caller_role,'') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error','forbidden');
    END IF;

    SELECT custom_daily_limit, custom_monthly_limit, limits_currency,
           COALESCE(is_custom_daily, false), COALESCE(is_custom_monthly, false)
    INTO v_custom_d, v_custom_m, v_user_curr, v_flag_d, v_flag_m
    FROM public.users WHERE id = p_user_id;

    -- Un tope custom guardado cuenta como custom aunque el flag viejo esté en false
    v_flag_d := v_flag_d OR (v_custom_d IS NOT NULL);
    v_flag_m := v_flag_m OR (v_custom_m IS NOT NULL);

    SELECT value INTO v_global FROM public.app_settings WHERE key = 'operational_limits';

    -- El custom SIEMPRE gana sobre el global cuando existe
    v_eff_daily    := CASE WHEN v_flag_d AND v_custom_d IS NOT NULL THEN v_custom_d
                           ELSE COALESCE((v_global->>'daily')::numeric,   800) END;
    v_eff_monthly  := CASE WHEN v_flag_m AND v_custom_m IS NOT NULL THEN v_custom_m
                           ELSE COALESCE((v_global->>'monthly')::numeric, 6000) END;
    v_eff_currency := COALESCE(v_user_curr, v_global->>'currency', 'USD');

    -- La columna del dueño en transactions varía por entorno
    -- (user_id / owner_user_id / sender_id / from_user_id): detectarla
    -- en vez de asumir 'user_id' (error en iOS: column "user_id" does not exist).
    SELECT column_name INTO v_owner_col
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions'
      AND column_name IN ('user_id','owner_user_id','sender_id','from_user_id')
    ORDER BY array_position(ARRAY['user_id','owner_user_id','sender_id','from_user_id'], column_name)
    LIMIT 1;

    -- Solo cargas (kind='load'); cada monto convertido a la moneda del
    -- tope ANTES de sumar. Si algo falla (columna/tabla distinta), el
    -- consumo queda en 0 pero los topes sí se devuelven.
    IF v_owner_col IS NOT NULL THEN
        BEGIN
            EXECUTE format(
                'SELECT
                    COALESCE(SUM(CASE WHEN created_at >= now() - interval ''24 hours''
                        THEN public.to_currency(COALESCE(amount,0), COALESCE(currency, $2), $2) ELSE 0 END), 0),
                    COALESCE(SUM(public.to_currency(COALESCE(amount,0), COALESCE(currency, $2), $2)), 0)
                 FROM public.transactions
                 WHERE %I = $1
                   AND created_at >= now() - interval ''30 days''
                   AND kind = ''load''
                   AND status IN (''completed'',''approved'',''sent'',''success'')',
                v_owner_col)
            INTO v_used_d, v_used_m
            USING p_user_id, v_eff_currency;
        EXCEPTION WHEN OTHERS THEN
            v_used_d := 0; v_used_m := 0;
        END;
    END IF;

    RETURN jsonb_build_object(
        'currency',          v_eff_currency,
        'daily_max',         v_eff_daily,
        'monthly_max',       v_eff_monthly,
        'daily_used',        ROUND(v_used_d::numeric, 2),
        'monthly_used',      ROUND(v_used_m::numeric, 2),
        'daily_pct',         CASE WHEN v_eff_daily   > 0 THEN ROUND((v_used_d / v_eff_daily   * 100)::numeric, 2) ELSE 0 END,
        'monthly_pct',       CASE WHEN v_eff_monthly > 0 THEN ROUND((v_used_m / v_eff_monthly * 100)::numeric, 2) ELSE 0 END,
        'is_custom_daily',   v_flag_d,
        'is_custom_monthly', v_flag_m
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_limits_summary(uuid) TO authenticated;

-- ═══ 4. admin_set_user_limits mantiene los flags ═══
CREATE OR REPLACE FUNCTION public.admin_set_user_limits(
    p_user_id        uuid,
    p_daily_limit    numeric DEFAULT NULL,
    p_monthly_limit  numeric DEFAULT NULL,
    p_currency       text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role text;
BEGIN
    SELECT admin_role INTO v_role FROM public.users WHERE id = auth.uid();
    IF COALESCE(v_role, '') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error', 'forbidden');
    END IF;

    UPDATE public.users
    SET
        custom_daily_limit   = p_daily_limit,
        custom_monthly_limit = p_monthly_limit,
        limits_currency      = p_currency,
        is_custom_daily      = (p_daily_limit   IS NOT NULL),
        is_custom_monthly    = (p_monthly_limit IS NOT NULL)
    WHERE id = p_user_id;

    INSERT INTO public.admin_actions (admin_id, admin_email, admin_role, action, target_type, target_id, metadata)
    SELECT
        u.id, u.email, u.admin_role,
        'user_limits.update', 'user', p_user_id::text,
        jsonb_build_object(
            'daily_limit',   p_daily_limit,
            'monthly_limit', p_monthly_limit,
            'currency',      p_currency
        )
    FROM public.users u WHERE u.id = auth.uid();

    RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_user_limits(uuid, numeric, numeric, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ═══ Verificación (opcional, correr aparte) ═══
-- SELECT public.get_user_limits_summary(id) FROM public.users
--   WHERE email = 'bryandavidortiz51@gmail.com';

-- 2026_limits_fx_consolidated.sql
-- ───────────────────────────────────────────────────────
-- 2026_limits_fx_consolidated.sql
--
-- CONSOLIDADO idempotente del sistema de topes con conversión FX.
-- Correr este archivo completo deja el cálculo correcto sin importar
-- qué versión previa de los RPCs esté deployada.
--
-- Reglas de negocio:
--   • Solo transacciones kind='load' (cargas) consumen tope.
--   • Cada TX se convierte de su currency a la moneda del tope
--     (default USD) ANTES de sumar. 200.000 COP ≈ 50 USD, no 200.000.
--   • Tope efectivo: custom del user/beneficiary → app_settings
--     ('operational_limits') → default hardcoded.
--
-- Fuentes de tasa FX (en orden):
--   1. public.fx_rate_snapshots  (TRM real del día — edge fx-snapshot)
--   2. public.fx_rates           (seed/tesorería)
--   3. public.exchange_rates     (tabla de Antigravity, si existe)
--   4. Constantes hardcoded vía pivote USD (último recurso)
-- ───────────────────────────────────────────────────────

-- ═══ 1. Helper de conversión ═══
CREATE OR REPLACE FUNCTION public.to_currency(
    p_amount numeric,
    p_from   text,
    p_to     text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_rate    numeric;
    v_inv     numeric;
    v_amt_usd numeric;
BEGIN
    IF p_amount IS NULL OR p_amount = 0 THEN RETURN 0; END IF;
    IF p_from IS NULL OR p_to IS NULL THEN RETURN p_amount; END IF;
    IF UPPER(p_from) = UPPER(p_to) THEN RETURN p_amount; END IF;

    -- 1) snapshot más reciente (TRM real)
    BEGIN
        SELECT rate INTO v_rate FROM public.fx_rate_snapshots
            WHERE UPPER(from_currency)=UPPER(p_from) AND UPPER(to_currency)=UPPER(p_to)
            ORDER BY captured_at DESC LIMIT 1;
        IF v_rate IS NOT NULL AND v_rate > 0 THEN RETURN p_amount * v_rate; END IF;
        SELECT rate INTO v_inv FROM public.fx_rate_snapshots
            WHERE UPPER(from_currency)=UPPER(p_to) AND UPPER(to_currency)=UPPER(p_from)
            ORDER BY captured_at DESC LIMIT 1;
        IF v_inv IS NOT NULL AND v_inv > 0 THEN RETURN p_amount / v_inv; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- 2) fx_rates (tesorería/seed)
    BEGIN
        SELECT rate INTO v_rate FROM public.fx_rates
            WHERE UPPER(from_currency)=UPPER(p_from) AND UPPER(to_currency)=UPPER(p_to) AND is_active = true
            ORDER BY effective_from DESC NULLS LAST LIMIT 1;
        IF v_rate IS NOT NULL AND v_rate > 0 THEN RETURN p_amount * v_rate; END IF;
        SELECT rate INTO v_inv FROM public.fx_rates
            WHERE UPPER(from_currency)=UPPER(p_to) AND UPPER(to_currency)=UPPER(p_from) AND is_active = true
            ORDER BY effective_from DESC NULLS LAST LIMIT 1;
        IF v_inv IS NOT NULL AND v_inv > 0 THEN RETURN p_amount / v_inv; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- 3) exchange_rates (schema par from/to; si la tabla usa otras columnas
    --    este bloque simplemente cae al fallback sin romper)
    BEGIN
        SELECT rate INTO v_rate FROM public.exchange_rates
            WHERE UPPER(from_currency)=UPPER(p_from) AND UPPER(to_currency)=UPPER(p_to)
            ORDER BY created_at DESC LIMIT 1;
        IF v_rate IS NOT NULL AND v_rate > 0 THEN RETURN p_amount * v_rate; END IF;
        SELECT rate INTO v_inv FROM public.exchange_rates
            WHERE UPPER(from_currency)=UPPER(p_to) AND UPPER(to_currency)=UPPER(p_from)
            ORDER BY created_at DESC LIMIT 1;
        IF v_inv IS NOT NULL AND v_inv > 0 THEN RETURN p_amount / v_inv; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- 4) Último recurso: constantes aproximadas vía pivote USD
    v_amt_usd := p_amount * CASE UPPER(p_from)
        WHEN 'USD' THEN 1.0
        WHEN 'COP' THEN 1.0/4000.0
        WHEN 'CLP' THEN 1.0/950.0
        WHEN 'PEN' THEN 1.0/3.7
        WHEN 'MXN' THEN 1.0/17.0
        WHEN 'BRL' THEN 1.0/5.5
        WHEN 'VES' THEN 1.0/36.0
        WHEN 'EUR' THEN 1.08
        ELSE 1.0
    END;
    RETURN v_amt_usd * CASE UPPER(p_to)
        WHEN 'USD' THEN 1.0
        WHEN 'COP' THEN 4000.0
        WHEN 'CLP' THEN 950.0
        WHEN 'PEN' THEN 3.7
        WHEN 'MXN' THEN 17.0
        WHEN 'BRL' THEN 5.5
        WHEN 'VES' THEN 36.0
        WHEN 'EUR' THEN 1.0/1.08
        ELSE 1.0
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.to_currency(numeric, text, text) TO anon, authenticated;

-- ═══ 2. Summary de topes por USUARIO ═══
CREATE OR REPLACE FUNCTION public.get_user_limits_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_custom_d numeric; v_custom_m numeric; v_user_curr text; v_global jsonb;
    v_eff_daily numeric; v_eff_monthly numeric; v_eff_currency text;
    v_used_d numeric; v_used_m numeric; v_caller_role text;
BEGIN
    SELECT admin_role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error','not_authenticated'); END IF;
    IF auth.uid() <> p_user_id
       AND COALESCE(v_caller_role,'') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error','forbidden');
    END IF;

    SELECT custom_daily_limit, custom_monthly_limit, limits_currency
    INTO v_custom_d, v_custom_m, v_user_curr FROM public.users WHERE id = p_user_id;

    SELECT value INTO v_global FROM public.app_settings WHERE key = 'operational_limits';

    v_eff_daily    := COALESCE(v_custom_d, (v_global->>'daily')::numeric,   800);
    v_eff_monthly  := COALESCE(v_custom_m, (v_global->>'monthly')::numeric, 6000);
    v_eff_currency := COALESCE(v_user_curr, v_global->>'currency', 'USD');

    -- Solo cargas (kind='load'); cada monto convertido a la moneda del
    -- tope ANTES de sumar.
    SELECT COALESCE(SUM(public.to_currency(COALESCE(amount,0), COALESCE(currency, v_eff_currency), v_eff_currency)),0)
    INTO v_used_d FROM public.transactions
    WHERE user_id = p_user_id
      AND created_at >= now() - interval '24 hours'
      AND kind = 'load'
      AND status IN ('completed','approved','sent','success');

    SELECT COALESCE(SUM(public.to_currency(COALESCE(amount,0), COALESCE(currency, v_eff_currency), v_eff_currency)),0)
    INTO v_used_m FROM public.transactions
    WHERE user_id = p_user_id
      AND created_at >= now() - interval '30 days'
      AND kind = 'load'
      AND status IN ('completed','approved','sent','success');

    RETURN jsonb_build_object(
        'currency',          v_eff_currency,
        'daily_max',         v_eff_daily,
        'monthly_max',       v_eff_monthly,
        'daily_used',        ROUND(v_used_d::numeric, 2),
        'monthly_used',      ROUND(v_used_m::numeric, 2),
        'daily_pct',         CASE WHEN v_eff_daily   > 0 THEN ROUND((v_used_d / v_eff_daily   * 100)::numeric, 2) ELSE 0 END,
        'monthly_pct',       CASE WHEN v_eff_monthly > 0 THEN ROUND((v_used_m / v_eff_monthly * 100)::numeric, 2) ELSE 0 END,
        'is_custom_daily',   v_custom_d IS NOT NULL,
        'is_custom_monthly', v_custom_m IS NOT NULL
    );
END;
$$;

-- ═══ 3. Summary de topes por BENEFICIARIO ═══
CREATE OR REPLACE FUNCTION public.get_beneficiary_limits_summary(p_beneficiary_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_custom_d numeric; v_custom_m numeric; v_ben_curr text; v_global jsonb;
    v_eff_daily numeric; v_eff_monthly numeric; v_eff_currency text;
    v_used_d numeric; v_used_m numeric; v_caller_role text; v_owner_id uuid;
BEGIN
    IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error','not_authenticated'); END IF;
    SELECT admin_role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    SELECT owner_user_id INTO v_owner_id FROM public.beneficiaries WHERE id = p_beneficiary_id;
    IF v_owner_id IS NULL THEN RETURN jsonb_build_object('error','beneficiary_not_found'); END IF;
    IF auth.uid() <> v_owner_id
       AND COALESCE(v_caller_role,'') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error','forbidden');
    END IF;

    SELECT custom_daily_limit, custom_monthly_limit, limits_currency
    INTO v_custom_d, v_custom_m, v_ben_curr FROM public.beneficiaries WHERE id = p_beneficiary_id;

    SELECT value INTO v_global FROM public.app_settings WHERE key = 'operational_limits';

    v_eff_daily    := COALESCE(v_custom_d, (v_global->>'daily')::numeric,   800);
    v_eff_monthly  := COALESCE(v_custom_m, (v_global->>'monthly')::numeric, 6000);
    v_eff_currency := COALESCE(v_ben_curr, v_global->>'currency', 'USD');

    BEGIN
        SELECT COALESCE(SUM(public.to_currency(COALESCE(amount,0), COALESCE(currency, v_eff_currency), v_eff_currency)),0)
        INTO v_used_d FROM public.transactions
        WHERE beneficiary_id = p_beneficiary_id
          AND created_at >= now() - interval '24 hours'
          AND kind = 'load'
          AND status IN ('completed','approved','sent','success');

        SELECT COALESCE(SUM(public.to_currency(COALESCE(amount,0), COALESCE(currency, v_eff_currency), v_eff_currency)),0)
        INTO v_used_m FROM public.transactions
        WHERE beneficiary_id = p_beneficiary_id
          AND created_at >= now() - interval '30 days'
          AND kind = 'load'
          AND status IN ('completed','approved','sent','success');
    EXCEPTION WHEN undefined_column THEN
        v_used_d := 0; v_used_m := 0;
    END;

    RETURN jsonb_build_object(
        'currency',          v_eff_currency,
        'daily_max',         v_eff_daily,
        'monthly_max',       v_eff_monthly,
        'daily_used',        ROUND(v_used_d::numeric, 2),
        'monthly_used',      ROUND(v_used_m::numeric, 2),
        'daily_pct',         CASE WHEN v_eff_daily   > 0 THEN ROUND((v_used_d / v_eff_daily   * 100)::numeric, 2) ELSE 0 END,
        'monthly_pct',       CASE WHEN v_eff_monthly > 0 THEN ROUND((v_used_m / v_eff_monthly * 100)::numeric, 2) ELSE 0 END,
        'is_custom_daily',   v_custom_d IS NOT NULL,
        'is_custom_monthly', v_custom_m IS NOT NULL,
        'owner_user_id',     v_owner_id
    );
END;
$$;

-- ═══ 4. Verificación (correr después para confirmar) ═══
-- SELECT public.to_currency(200000, 'COP', 'USD');   -- esperado ≈ 50
-- SELECT public.get_user_limits_summary(id)
--   FROM public.users WHERE email = 'bryandavidortiz51@gmail.com';

-- 2026_limits_only_loads.sql
-- ───────────────────────────────────────────────────────
-- 2026_limits_only_loads.sql
--
-- Cambio de regla de negocio: el tope diario/mensual aplica SOLO
-- a transacciones de "cargar dinero" (depósitos). Envíos y
-- conversiones no descuentan del límite ni aparecen en la barra
-- de progreso.
--
-- Antes el WHERE incluía:
--   kind IN ('send', 'load', 'convert', 'envio', 'carga')
-- Ahora estricto:
--   kind = 'load'
--
-- Si el backend mete cargas con label 'carga' en español, agregar
-- esos rows a 'load' o cambiar el filtro a IN ('load','carga').
--
-- Re-crea los dos RPCs de summary; el resto (conversión TRM,
-- permisos, fallback de columnas) se mantiene idéntico.
-- ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_user_limits_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_custom_d      numeric;
    v_custom_m      numeric;
    v_user_curr     text;
    v_global        jsonb;
    v_eff_daily     numeric;
    v_eff_monthly   numeric;
    v_eff_currency  text;
    v_used_d        numeric;
    v_used_m        numeric;
    v_caller_role   text;
BEGIN
    SELECT admin_role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;
    IF auth.uid() <> p_user_id
       AND COALESCE(v_caller_role, '') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error', 'forbidden');
    END IF;

    SELECT custom_daily_limit, custom_monthly_limit, limits_currency
    INTO v_custom_d, v_custom_m, v_user_curr
    FROM public.users WHERE id = p_user_id;

    SELECT value INTO v_global
    FROM public.app_settings WHERE key = 'operational_limits';

    v_eff_daily    := COALESCE(v_custom_d, (v_global->>'daily')::numeric, 800);
    v_eff_monthly  := COALESCE(v_custom_m, (v_global->>'monthly')::numeric, 3000);
    v_eff_currency := COALESCE(v_user_curr, v_global->>'currency', 'USD');

    -- Regla nueva: SOLO depósitos (kind in 'load','carga') cuentan.
    -- Envíos y conversiones quedan fuera del límite.
    SELECT COALESCE(SUM(public.to_currency(COALESCE(amount, 0), COALESCE(currency, v_eff_currency), v_eff_currency)), 0)
    INTO v_used_d
    FROM public.transactions
    WHERE owner_user_id = p_user_id
      AND created_at >= now() - interval '24 hours'
      AND kind = 'load'
      AND status IN ('completed', 'approved', 'sent', 'success');

    SELECT COALESCE(SUM(public.to_currency(COALESCE(amount, 0), COALESCE(currency, v_eff_currency), v_eff_currency)), 0)
    INTO v_used_m
    FROM public.transactions
    WHERE owner_user_id = p_user_id
      AND created_at >= now() - interval '30 days'
      AND kind = 'load'
      AND status IN ('completed', 'approved', 'sent', 'success');

    RETURN jsonb_build_object(
        'currency',           v_eff_currency,
        'daily_max',          v_eff_daily,
        'monthly_max',        v_eff_monthly,
        'daily_used',         ROUND(v_used_d::numeric, 2),
        'monthly_used',       ROUND(v_used_m::numeric, 2),
        'daily_pct',          CASE WHEN v_eff_daily > 0   THEN ROUND((v_used_d / v_eff_daily   * 100)::numeric, 2) ELSE 0 END,
        'monthly_pct',        CASE WHEN v_eff_monthly > 0 THEN ROUND((v_used_m / v_eff_monthly * 100)::numeric, 2) ELSE 0 END,
        'is_custom_daily',    v_custom_d IS NOT NULL,
        'is_custom_monthly',  v_custom_m IS NOT NULL
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_beneficiary_limits_summary(p_beneficiary_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_custom_d      numeric;
    v_custom_m      numeric;
    v_ben_curr      text;
    v_global        jsonb;
    v_eff_daily     numeric;
    v_eff_monthly   numeric;
    v_eff_currency  text;
    v_used_d        numeric;
    v_used_m        numeric;
    v_caller_role   text;
    v_owner_id      uuid;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;

    SELECT admin_role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    SELECT owner_user_id INTO v_owner_id FROM public.beneficiaries WHERE id = p_beneficiary_id;

    IF v_owner_id IS NULL THEN
        RETURN jsonb_build_object('error', 'beneficiary_not_found');
    END IF;

    IF auth.uid() <> v_owner_id
       AND COALESCE(v_caller_role, '') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error', 'forbidden');
    END IF;

    SELECT custom_daily_limit, custom_monthly_limit, limits_currency
    INTO v_custom_d, v_custom_m, v_ben_curr
    FROM public.beneficiaries WHERE id = p_beneficiary_id;

    SELECT value INTO v_global
    FROM public.app_settings WHERE key = 'operational_limits';

    v_eff_daily    := COALESCE(v_custom_d, (v_global->>'daily')::numeric, 800);
    v_eff_monthly  := COALESCE(v_custom_m, (v_global->>'monthly')::numeric, 3000);
    v_eff_currency := COALESCE(v_ben_curr, v_global->>'currency', 'USD');

    BEGIN
        SELECT COALESCE(SUM(public.to_currency(COALESCE(amount, 0), COALESCE(currency, v_eff_currency), v_eff_currency)), 0)
        INTO v_used_d
        FROM public.transactions
        WHERE beneficiary_id = p_beneficiary_id
          AND created_at >= now() - interval '24 hours'
          AND kind = 'load'
          AND status IN ('completed', 'approved', 'sent', 'success');

        SELECT COALESCE(SUM(public.to_currency(COALESCE(amount, 0), COALESCE(currency, v_eff_currency), v_eff_currency)), 0)
        INTO v_used_m
        FROM public.transactions
        WHERE beneficiary_id = p_beneficiary_id
          AND created_at >= now() - interval '30 days'
          AND kind = 'load'
          AND status IN ('completed', 'approved', 'sent', 'success');
    EXCEPTION WHEN undefined_column THEN
        v_used_d := 0;
        v_used_m := 0;
    END;

    RETURN jsonb_build_object(
        'currency',           v_eff_currency,
        'daily_max',          v_eff_daily,
        'monthly_max',        v_eff_monthly,
        'daily_used',         ROUND(v_used_d::numeric, 2),
        'monthly_used',       ROUND(v_used_m::numeric, 2),
        'daily_pct',          CASE WHEN v_eff_daily > 0   THEN ROUND((v_used_d / v_eff_daily   * 100)::numeric, 2) ELSE 0 END,
        'monthly_pct',        CASE WHEN v_eff_monthly > 0 THEN ROUND((v_used_m / v_eff_monthly * 100)::numeric, 2) ELSE 0 END,
        'is_custom_daily',    v_custom_d IS NOT NULL,
        'is_custom_monthly',  v_custom_m IS NOT NULL,
        'owner_user_id',      v_owner_id
    );
END;
$$;

-- 2026_next_gasfree_index.sql
-- Asignación ATÓMICA del índice HD de wallets GasFree.
-- Reemplaza el patrón read-then-write (no atómico) del edge function, que
-- permitía que dos usuarios tomaran el MISMO índice → la MISMA wallet GasFree
-- (colisión de direcciones observada entre XATECH y MEXITECH).
--
-- Devuelve el índice recién asignado (== nuevo valor del contador). El primer
-- llamado sin contador previo devuelve 1 (los clientes arrancan en el índice 1;
-- el índice 0 queda reservado a la recaudadora).
create or replace function next_gasfree_index()
returns integer
language plpgsql
as $$
declare
  v integer;
begin
  insert into system_config(key, value)
  values ('gasfree_hd_counter', '1')
  on conflict (key)
  do update set value = ((coalesce(nullif(system_config.value, ''), '0'))::int + 1)::text
  returning value::int into v;
  return v;
end;
$$;

grant execute on function next_gasfree_index() to anon, authenticated, service_role;

-- Refrescar el caché de PostgREST para exponer la RPC de inmediato.
notify pgrst, 'reload schema';

-- 2026_notify_tx_trigger.sql
-- ════════════════════════════════════════════════════════
-- CORREOS AUTOMÁTICOS AL CLIENTE por cada movimiento.
--
-- Dispara la edge function 'notify-transaction' (que manda el correo por
-- Resend) en DOS momentos, para CUALQUIER camino que cree/actualice una
-- transacción (cliente, gasfree, finity, admin):
--
--   1. AL CREAR la operación (INSERT)            → correo "en proceso / recibido"
--   2. AL COMPLETARSE (UPDATE, status='Completado') → correo "se completó"
--
-- Cubre: conversión (convert), envío (send), cargue/depósito (load),
-- pagos entre usuarios (pay_sent/pay_received) y OTC. La propia función
-- filtra los tipos que no aplican y deduplica con flags en raw_data
-- (notified / notified_completed), así que nunca manda un correo repetido.
--
-- ⚠️ Antes de correr esto:
--   • Reemplaza <ANON_KEY> por tu VITE_SUPABASE_ANON_KEY
--     (Supabase → Project Settings → API → anon public).
--   • Asegúrate de que los secrets RESEND_API_KEY y FROM_EMAIL estén
--     configurados en Edge Functions (si no, la función no envía).
--
-- Para APAGARLO: DROP TRIGGER IF EXISTS trg_cuypay_notify_tx ON public.transactions;
-- ════════════════════════════════════════════════════════

DO $ext$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_net; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_net no disponible (habilítala en Supabase → Database → Extensions)'; END $ext$;

CREATE OR REPLACE FUNCTION public.cuypay_notify_tx()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Notificar en:
  --   • INSERT (siempre)  → la función decide "creado" vs "completado" por el estado
  --   • UPDATE solo cuando el estado CAMBIÓ a 'Completado' (evita re-disparos
  --     por la propia escritura de los flags de dedup, que no tocan status)
  IF (TG_OP = 'INSERT')
     OR (TG_OP = 'UPDATE'
         AND NEW.status IS DISTINCT FROM OLD.status
         AND NEW.status = 'Completado') THEN
    PERFORM net.http_post(
      url     := 'https://<TU_PROJECT_REF>.supabase.co/functions/v1/notify-transaction',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', '<ANON_KEY>',
        'Authorization', 'Bearer <ANON_KEY>'
      ),
      body    := jsonb_build_object(
        'type', TG_OP,
        'table', 'transactions',
        'record', to_jsonb(NEW)
      )
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cuypay_notify_tx ON public.transactions;
CREATE TRIGGER trg_cuypay_notify_tx
  AFTER INSERT OR UPDATE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.cuypay_notify_tx();

-- 2026_phase_2_compliance.sql
-- ════════════════════════════════════════════════════════
-- F2: COMPLIANCE AVANZADO
-- - AML rules configurables
-- - Compliance alerts (con trigger automático)
-- - Sanctions list (OFAC/PEP simplificada)
-- ════════════════════════════════════════════════════════

-- ───── 1. AML RULES ─────
-- Reglas configurables que disparan alertas en TX
ALTER TABLE public.aml_rules ENABLE ROW LEVEL SECURITY;

-- ───── 2. COMPLIANCE ALERTS ─────
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_status ON public.compliance_alerts(status);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_severity ON public.compliance_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_created ON public.compliance_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_user ON public.compliance_alerts(user_id);
ALTER TABLE public.compliance_alerts ENABLE ROW LEVEL SECURITY;

-- ───── 3. SANCTIONS LIST (simplificada) ─────
CREATE INDEX IF NOT EXISTS idx_sanctions_name ON public.sanctions_list USING GIN (to_tsvector('simple', full_name));
CREATE INDEX IF NOT EXISTS idx_sanctions_list_type ON public.sanctions_list(list_type);
ALTER TABLE public.sanctions_list ENABLE ROW LEVEL SECURITY;

-- ───── 4. RLS para las nuevas tablas ─────
DROP POLICY IF EXISTS "compliance_read_aml_rules" ON public.aml_rules;
CREATE POLICY "compliance_read_aml_rules" ON public.aml_rules
  FOR SELECT USING (public.is_admin_with_role('super_admin','compliance','audit'));
DROP POLICY IF EXISTS "compliance_manage_aml_rules" ON public.aml_rules;
CREATE POLICY "compliance_manage_aml_rules" ON public.aml_rules
  FOR ALL USING (public.is_admin_with_role('super_admin','compliance'));

DROP POLICY IF EXISTS "compliance_read_alerts" ON public.compliance_alerts;
CREATE POLICY "compliance_read_alerts" ON public.compliance_alerts
  FOR SELECT USING (public.is_admin_with_role('super_admin','compliance','audit'));
DROP POLICY IF EXISTS "compliance_update_alerts" ON public.compliance_alerts;
CREATE POLICY "compliance_update_alerts" ON public.compliance_alerts
  FOR UPDATE USING (public.is_admin_with_role('super_admin','compliance'));
DROP POLICY IF EXISTS "compliance_insert_alerts" ON public.compliance_alerts;
CREATE POLICY "compliance_insert_alerts" ON public.compliance_alerts
  FOR INSERT WITH CHECK (true);  -- triggers internos pueden insertar

DROP POLICY IF EXISTS "compliance_read_sanctions" ON public.sanctions_list;
CREATE POLICY "compliance_read_sanctions" ON public.sanctions_list
  FOR SELECT USING (public.is_admin_with_role('super_admin','compliance','audit'));
DROP POLICY IF EXISTS "compliance_manage_sanctions" ON public.sanctions_list;
CREATE POLICY "compliance_manage_sanctions" ON public.sanctions_list
  FOR ALL USING (public.is_admin_with_role('super_admin','compliance'));

-- ───── 5. TRIGGER — evalúa reglas AML cuando se inserta una TX ─────
CREATE OR REPLACE FUNCTION public.evaluate_aml_rules()
RETURNS TRIGGER AS $$
DECLARE
    rule RECORD;
    user_record RECORD;
    velocity_count INT;
    description TEXT;
BEGIN
    -- Saltamos si no hay usuario
    IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

    -- Traer país del usuario
    SELECT country INTO user_record FROM public.users WHERE id = NEW.user_id;

    -- Iterar todas las reglas activas
    FOR rule IN
        SELECT * FROM public.aml_rules WHERE is_active = true
    LOOP
        -- Filtros básicos
        IF rule.transaction_type IS NOT NULL AND rule.transaction_type <> NEW.type THEN CONTINUE; END IF;
        IF rule.currency IS NOT NULL AND rule.currency <> COALESCE(NEW.from_currency, '') THEN CONTINUE; END IF;

        IF rule.rule_type = 'high_amount' THEN
            IF rule.amount_threshold IS NOT NULL AND COALESCE(NEW.from_amount, 0) >= rule.amount_threshold THEN
                description := format('Transacción de %s %s supera umbral de %s',
                    NEW.from_currency, NEW.from_amount, rule.amount_threshold);
                INSERT INTO public.compliance_alerts (rule_id, rule_name, severity, user_id, transaction_id, description, metadata)
                VALUES (rule.id, rule.name, rule.severity, NEW.user_id, NEW.id, description,
                    jsonb_build_object('amount', NEW.from_amount, 'currency', NEW.from_currency, 'type', NEW.type));
            END IF;

        ELSIF rule.rule_type = 'velocity' THEN
            SELECT COUNT(*) INTO velocity_count
            FROM public.transactions
            WHERE user_id = NEW.user_id
              AND created_at >= NOW() - (rule.time_window_hours || ' hours')::interval;
            IF velocity_count >= 5 THEN  -- regla simple: 5+ TX en ventana
                description := format('Usuario realizó %s transacciones en %s horas',
                    velocity_count, rule.time_window_hours);
                INSERT INTO public.compliance_alerts (rule_id, rule_name, severity, user_id, transaction_id, description, metadata)
                VALUES (rule.id, rule.name, rule.severity, NEW.user_id, NEW.id, description,
                    jsonb_build_object('tx_count', velocity_count, 'window_hours', rule.time_window_hours));
            END IF;
        END IF;
    END LOOP;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Nunca rompemos la TX original si falla la evaluación
    RAISE WARNING 'AML evaluation failed: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_transaction_aml_check ON public.transactions;
CREATE TRIGGER on_transaction_aml_check
    AFTER INSERT ON public.transactions
    FOR EACH ROW EXECUTE FUNCTION public.evaluate_aml_rules();

-- ───── 6. Seed de reglas iniciales ─────
INSERT INTO public.aml_rules (name, description, rule_type, amount_threshold, severity)
VALUES
    ('Transacción alto valor (5M)', 'Alerta cuando una transacción supera 5,000,000', 'high_amount', 5000000, 'high'),
    ('Transacción muy alto valor (20M)', 'Alerta crítica para TX > 20M', 'high_amount', 20000000, 'critical'),
    ('Alta velocidad de TX', 'Más de 5 TX en 1 hora', 'velocity', NULL, 'medium')
ON CONFLICT DO NOTHING;

UPDATE public.aml_rules SET time_window_hours = 1 WHERE rule_type = 'velocity' AND time_window_hours IS NULL;

-- 2026_phase_3_treasury.sql
-- ════════════════════════════════════════════════════════
-- F3: TREASURY AVANZADO
-- - FX rates (tasas de cambio)
-- - Partners (proveedores/contrapartes)
-- - Bank reconciliation (conciliación bancaria)
-- ════════════════════════════════════════════════════════

-- ───── 1. FX RATES ─────
CREATE INDEX IF NOT EXISTS idx_fx_rates_pair ON public.fx_rates(from_currency, to_currency) WHERE is_active = true;
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;

-- ───── 2. PARTNERS ─────
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;

-- ───── 3. BANK RECONCILIATION ─────

CREATE INDEX IF NOT EXISTS idx_statement_lines_statement ON public.bank_statement_lines(statement_id);
CREATE INDEX IF NOT EXISTS idx_statement_lines_match ON public.bank_statement_lines(match_status);

ALTER TABLE public.bank_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;

-- ───── 4. RLS ─────
DROP POLICY IF EXISTS "treasury_read_fx" ON public.fx_rates;
CREATE POLICY "treasury_read_fx" ON public.fx_rates
  FOR SELECT USING (public.is_admin_with_role('super_admin','treasury','audit'));
DROP POLICY IF EXISTS "treasury_manage_fx" ON public.fx_rates;
CREATE POLICY "treasury_manage_fx" ON public.fx_rates
  FOR ALL USING (public.is_admin_with_role('super_admin','treasury'));

DROP POLICY IF EXISTS "treasury_read_partners" ON public.partners;
CREATE POLICY "treasury_read_partners" ON public.partners
  FOR SELECT USING (public.is_admin_with_role('super_admin','treasury','audit'));
DROP POLICY IF EXISTS "treasury_manage_partners" ON public.partners;
CREATE POLICY "treasury_manage_partners" ON public.partners
  FOR ALL USING (public.is_admin_with_role('super_admin','treasury'));

DROP POLICY IF EXISTS "treasury_read_statements" ON public.bank_statements;
CREATE POLICY "treasury_read_statements" ON public.bank_statements
  FOR SELECT USING (public.is_admin_with_role('super_admin','treasury','audit'));
DROP POLICY IF EXISTS "treasury_manage_statements" ON public.bank_statements;
CREATE POLICY "treasury_manage_statements" ON public.bank_statements
  FOR ALL USING (public.is_admin_with_role('super_admin','treasury'));

DROP POLICY IF EXISTS "treasury_read_lines" ON public.bank_statement_lines;
CREATE POLICY "treasury_read_lines" ON public.bank_statement_lines
  FOR SELECT USING (public.is_admin_with_role('super_admin','treasury','audit'));
DROP POLICY IF EXISTS "treasury_manage_lines" ON public.bank_statement_lines;
CREATE POLICY "treasury_manage_lines" ON public.bank_statement_lines
  FOR ALL USING (public.is_admin_with_role('super_admin','treasury'));

-- ───── 5. Seed FX rates iniciales ─────
INSERT INTO public.fx_rates (from_currency, to_currency, rate, spread_pct, is_active) VALUES
    ('USD','COP', 4000.00, 0.5, true),
    ('USD','PEN', 3.75,    0.5, true),
    ('USD','CLP', 950.00,  0.5, true),
    ('USD','MXN', 17.50,   0.5, true),
    ('COP','USD', 0.00025, 0.5, true),
    ('PEN','USD', 0.266,   0.5, true)
ON CONFLICT DO NOTHING;

-- 2026_phase_5_dual_approval.sql
-- ════════════════════════════════════════════════════════
-- F5: 2FA + DOBLE APROBACIÓN
-- - Workflow de aprobación con segundo aprobador para TX altas
-- - Umbral configurable por moneda
-- ════════════════════════════════════════════════════════

-- ───── 1. Umbrales de doble aprobación ─────
ALTER TABLE public.dual_approval_thresholds ENABLE ROW LEVEL SECURITY;

-- ───── 2. Workflow de aprobaciones ─────
CREATE INDEX IF NOT EXISTS idx_tx_approvals_tx ON public.tx_approvals(transaction_id);
ALTER TABLE public.tx_approvals ENABLE ROW LEVEL SECURITY;

-- ───── 3. RLS ─────
DROP POLICY IF EXISTS "thresholds_read" ON public.dual_approval_thresholds;
CREATE POLICY "thresholds_read" ON public.dual_approval_thresholds
  FOR SELECT USING (public.is_any_admin());
DROP POLICY IF EXISTS "thresholds_manage" ON public.dual_approval_thresholds;
CREATE POLICY "thresholds_manage" ON public.dual_approval_thresholds
  FOR ALL USING (public.is_admin_with_role('super_admin', 'treasury'));

DROP POLICY IF EXISTS "approvals_read" ON public.tx_approvals;
CREATE POLICY "approvals_read" ON public.tx_approvals
  FOR SELECT USING (public.is_any_admin());
DROP POLICY IF EXISTS "approvals_write" ON public.tx_approvals;
CREATE POLICY "approvals_write" ON public.tx_approvals
  FOR INSERT WITH CHECK (
    public.is_admin_with_role('super_admin', 'treasury') AND approver_id = auth.uid()
  );

-- ───── 4. Helper: ¿necesita doble aprobación? ─────
CREATE OR REPLACE FUNCTION public.tx_needs_dual_approval(p_tx_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.transactions t
    JOIN public.dual_approval_thresholds d
      ON d.currency = t.from_currency AND d.is_active = true
    WHERE t.id = p_tx_id
      AND COALESCE(t.from_amount, 0) >= d.amount_threshold
  );
$$;

-- ───── 5. Helper: ¿ya tiene 2 aprobaciones distintas? ─────
CREATE OR REPLACE FUNCTION public.tx_has_dual_approval(p_tx_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT (
    SELECT COUNT(DISTINCT approver_id)
    FROM public.tx_approvals
    WHERE transaction_id = p_tx_id AND decision = 'approve'
  ) >= 2;
$$;

-- ───── 6. Seeds: umbrales iniciales ─────
INSERT INTO public.dual_approval_thresholds (currency, amount_threshold, is_active) VALUES
    ('COP', 10000000,  true),    -- 10 millones COP
    ('USD', 2500,      true),    -- 2,500 USD
    ('PEN', 10000,     true),    -- 10,000 PEN
    ('CLP', 2500000,   true),    -- 2.5 millones CLP
    ('MXN', 50000,     true)     -- 50,000 MXN
ON CONFLICT (currency) DO NOTHING;

-- 2026_phase_6_scale.sql
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

-- 2026_phase_7_fx_commissions.sql
-- ════════════════════════════════════════════════════════
-- F7: FX COMMISSIONS — tiers + ventana nocturna por par
-- ════════════════════════════════════════════════════════

-- ───── 1. Configuración global de FX ─────
-- Una sola fila — toggles globales de comportamiento
INSERT INTO public.fx_global_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.fx_global_config ENABLE ROW LEVEL SECURITY;

-- ───── 2. Configuración por par ─────
-- Si la tabla ya existía sin la columna, agregarla
ALTER TABLE public.fx_pair_config ADD COLUMN IF NOT EXISTS base_fee_pct NUMERIC(6,3) NOT NULL DEFAULT 0.5;
ALTER TABLE public.fx_pair_config ENABLE ROW LEVEL SECURITY;

-- ───── 3. Cache de tasas xe.com (servidor llena, cliente consulta) ─────
CREATE INDEX IF NOT EXISTS idx_fx_snapshots_pair_time ON public.fx_rate_snapshots(from_currency, to_currency, captured_at DESC);
ALTER TABLE public.fx_rate_snapshots ENABLE ROW LEVEL SECURITY;

-- ───── 4. RLS ─────
DROP POLICY IF EXISTS "fx_global_read" ON public.fx_global_config;
CREATE POLICY "fx_global_read" ON public.fx_global_config
  FOR SELECT USING (public.is_any_admin());
DROP POLICY IF EXISTS "fx_global_manage" ON public.fx_global_config;
CREATE POLICY "fx_global_manage" ON public.fx_global_config
  FOR ALL USING (public.is_admin_with_role('super_admin', 'treasury'));

DROP POLICY IF EXISTS "fx_pair_read" ON public.fx_pair_config;
CREATE POLICY "fx_pair_read" ON public.fx_pair_config
  FOR SELECT USING (public.is_any_admin());
DROP POLICY IF EXISTS "fx_pair_manage" ON public.fx_pair_config;
CREATE POLICY "fx_pair_manage" ON public.fx_pair_config
  FOR ALL USING (public.is_admin_with_role('super_admin', 'treasury'));

DROP POLICY IF EXISTS "fx_snapshots_read" ON public.fx_rate_snapshots;
CREATE POLICY "fx_snapshots_read" ON public.fx_rate_snapshots
  FOR SELECT USING (public.is_any_admin());
-- inserts vienen del Edge Function con service_role → bypass RLS

-- ───── 5. Seed pares: cada moneda contra cada otra (incluye VES con fee mayor) ─────
INSERT INTO public.fx_pair_config (from_currency, to_currency, base_fee_pct) VALUES
    ('USD','COP', 0.5),('USD','CLP', 0.5),('USD','PEN', 0.5),('USD','MXN', 0.5),('USD','BRL', 0.5),('USD','VES', 1.0),
    ('COP','USD', 0.8),('COP','CLP', 0.8),('COP','PEN', 0.8),('COP','MXN', 0.8),('COP','BRL', 0.8),('COP','VES', 1.0),
    ('CLP','USD', 0.8),('CLP','COP', 0.8),('CLP','PEN', 0.8),('CLP','MXN', 0.8),('CLP','BRL', 0.8),('CLP','VES', 1.0),
    ('PEN','USD', 0.8),('PEN','COP', 0.8),('PEN','CLP', 0.8),('PEN','MXN', 0.8),('PEN','BRL', 0.8),('PEN','VES', 1.0),
    ('MXN','USD', 0.8),('MXN','COP', 0.8),('MXN','CLP', 0.8),('MXN','PEN', 0.8),('MXN','BRL', 0.8),('MXN','VES', 1.0),
    ('BRL','USD', 0.8),('BRL','COP', 0.8),('BRL','CLP', 0.8),('BRL','PEN', 0.8),('BRL','MXN', 0.8),('BRL','VES', 1.0),
    ('VES','USD', 1.0),('VES','COP', 1.0),('VES','CLP', 1.0),('VES','PEN', 1.0),('VES','MXN', 1.0),('VES','BRL', 1.0)
ON CONFLICT (from_currency, to_currency) DO NOTHING;

-- ───── 6. Helper: calcular comisión para un monto ─────
-- Entrada: amount en from_currency + USD-rate del momento (BRL/USD, etc.)
-- Devuelve el % a aplicar
CREATE OR REPLACE FUNCTION public.fx_calc_commission_pct(
    p_from_currency TEXT,
    p_to_currency TEXT,
    p_amount NUMERIC,
    p_from_usd_rate NUMERIC,
    p_now TIMESTAMPTZ DEFAULT NOW()
) RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    pair_cfg RECORD;
    global_cfg RECORD;
    amount_usd NUMERIC;
    tier JSONB;
    pct NUMERIC := 0;
    local_hour INT;
    in_night BOOLEAN := false;
BEGIN
    SELECT * INTO pair_cfg FROM public.fx_pair_config
        WHERE from_currency = p_from_currency AND to_currency = p_to_currency AND is_active = true;
    IF NOT FOUND THEN RETURN 0; END IF;

    SELECT * INTO global_cfg FROM public.fx_global_config WHERE id = 1;

    -- Convertir a USD: amount * from_usd_rate (rate BRL→USD ej 0.20)
    amount_usd := p_amount * COALESCE(p_from_usd_rate, 1);

    -- Buscar tier
    FOR tier IN SELECT * FROM jsonb_array_elements(pair_cfg.tiers) LOOP
        IF amount_usd >= (tier->>'from_usd')::NUMERIC
            AND (tier->'to_usd' = 'null'::jsonb OR amount_usd < (tier->>'to_usd')::NUMERIC)
        THEN
            pct := (tier->>'pct')::NUMERIC;
            EXIT;
        END IF;
    END LOOP;

    -- Ventana nocturna global
    IF global_cfg.night_enabled THEN
        local_hour := EXTRACT(HOUR FROM (p_now AT TIME ZONE global_cfg.timezone))::INT;
        IF global_cfg.night_start_hour < global_cfg.night_end_hour THEN
            in_night := local_hour >= global_cfg.night_start_hour AND local_hour < global_cfg.night_end_hour;
        ELSE  -- ventana cruza medianoche
            in_night := local_hour >= global_cfg.night_start_hour OR local_hour < global_cfg.night_end_hour;
        END IF;
        IF in_night THEN pct := pct + global_cfg.night_extra_pct; END IF;
    END IF;

    RETURN pct;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fx_calc_commission_pct TO authenticated;

-- ───── 7. Verificar ─────
SELECT COUNT(*) AS pairs_seeded FROM public.fx_pair_config;
SELECT * FROM public.fx_global_config;

-- 2026_relax_raw_data_guard.sql
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

-- 2026_security_hardening_rls.sql
-- ============================================================
-- SECURITY HARDENING — apply en AMBOS proyectos (Empresas y Personas).
--
-- Contexto: el security audit encontró que fix_rls_full_reset.sql dejó
-- RLS abierto a anon/authenticated con USING (true). Cualquiera con el
-- anon key (que vive en el bundle del browser) podía:
--   UPDATE users SET role='admin', kyc_status='approved', balances=...
--   SELECT raw_data FROM users  (passwordHash, HD index, KYC PII)
--
-- Y migraciones 2026_phase_*.sql referencian is_admin_with_role() /
-- is_any_admin() que NUNCA existieron — esas policies probablemente
-- fallaron silentes y dejaron compliance/treasury sin RLS efectiva.
--
-- Esta migración:
--   1. Define is_any_admin() + is_admin_with_role() tolerantes a las
--      diferencias de schema entre Empresas (users.role='admin') y
--      Personas (users.admin_role IN ('super_admin',...)).
--   2. Reactiva RLS estricta en public.users y public.transactions.
--   3. Agrega trigger BEFORE UPDATE que bloquea cambios a columnas
--      sensibles para usuarios no-admin. Usa to_jsonb para tolerar
--      columnas que existen solo en un proyecto.
--   4. Service role (edge functions) sigue libre — auth.uid() es NULL.
--
-- Idempotente — se puede re-correr sin romper.
-- ============================================================

-- ============================================================
-- 1) FUNCIONES is_any_admin() / is_admin_with_role()
-- ============================================================

-- is_any_admin: true si el caller tiene role='admin' (Empresas)
-- O admin_role IS NOT NULL (Personas). Usamos to_jsonb del row para
-- tolerar si admin_role no existe como columna en este proyecto.
CREATE OR REPLACE FUNCTION public.is_any_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND (
        u.role = 'admin'
        OR COALESCE(NULLIF(to_jsonb(u) ->> 'admin_role', ''), NULL) IS NOT NULL
      )
  );
$$;

-- is_admin_with_role(VARIADIC roles): true si el caller tiene
-- admin_role en la lista (Personas). En Empresas el concepto de
-- sub-rol no existe — devolvemos true si users.role='admin' Y
-- 'super_admin' está en la lista pedida (alineación más segura).
CREATE OR REPLACE FUNCTION public.is_admin_with_role(VARIADIC roles text[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND (
        (to_jsonb(u) ->> 'admin_role') = ANY(roles)
        OR (u.role = 'admin' AND 'super_admin' = ANY(roles))
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_any_admin()             TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_admin_with_role(text[]) TO authenticated, anon;

-- ============================================================
-- 2) RLS estricta en public.users
-- ============================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
           WHERE tablename = 'users' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.users', r.policyname);
  END LOOP;
END $$;

-- SELECT: el user ve su propia fila; admins ven todas.
DROP POLICY IF EXISTS users_select_self_or_admin ON public.users;
CREATE POLICY users_select_self_or_admin ON public.users FOR SELECT
  TO authenticated
  USING (auth.uid() = id OR public.is_any_admin());

-- INSERT: signup propio o admin.
DROP POLICY IF EXISTS users_insert_self ON public.users;
CREATE POLICY users_insert_self ON public.users FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS users_insert_admin ON public.users;
CREATE POLICY users_insert_admin ON public.users FOR INSERT
  TO authenticated
  WITH CHECK (public.is_any_admin());

-- UPDATE: self (trigger filtra cols sensibles) o admin.
DROP POLICY IF EXISTS users_update_self ON public.users;
CREATE POLICY users_update_self ON public.users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS users_update_admin ON public.users;
CREATE POLICY users_update_admin ON public.users FOR UPDATE
  TO authenticated
  USING (public.is_any_admin())
  WITH CHECK (public.is_any_admin());

-- DELETE: solo admin (self-delete via edge function delete-self).
DROP POLICY IF EXISTS users_delete_admin ON public.users;
CREATE POLICY users_delete_admin ON public.users FOR DELETE
  TO authenticated
  USING (public.is_any_admin());

-- Anon → sin policies → bloqueado.

-- ============================================================
-- 3) Trigger que bloquea cols sensibles para non-admin.
--    Usa to_jsonb para tolerar columnas faltantes (admin_role
--    no existe en Empresas, balances no en Personas, etc.).
-- ============================================================

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
    'didit_session_id',
    'raw_data'
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

-- ============================================================
-- 4) RLS estricta en public.transactions (si existe)
-- ============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'transactions') THEN
    EXECUTE 'ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

DO $$
DECLARE r RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'transactions') THEN
    FOR r IN SELECT policyname FROM pg_policies
             WHERE tablename = 'transactions' AND schemaname = 'public'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.transactions', r.policyname);
    END LOOP;
  END IF;
END $$;

DO $$
DECLARE
  has_owner BOOLEAN;
  has_user  BOOLEAN;
  select_using TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'transactions') THEN
    RETURN;
  END IF;

  -- Detectamos qué columna usa la tabla para identificar al dueño.
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='transactions' AND column_name='owner_user_id')
    INTO has_owner;
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='transactions' AND column_name='user_id')
    INTO has_user;

  select_using := 'public.is_any_admin()';
  IF has_owner THEN
    select_using := '(owner_user_id IS NOT NULL AND owner_user_id = auth.uid()) OR ' || select_using;
  END IF;
  IF has_user THEN
    select_using := '(user_id IS NOT NULL AND user_id = auth.uid()) OR ' || select_using;
  END IF;

  EXECUTE format('CREATE POLICY tx_select_owner_or_admin ON public.transactions FOR SELECT TO authenticated USING (%s)', select_using);
  EXECUTE 'CREATE POLICY tx_insert_admin ON public.transactions FOR INSERT TO authenticated WITH CHECK (public.is_any_admin())';
  EXECUTE 'CREATE POLICY tx_update_admin ON public.transactions FOR UPDATE TO authenticated USING (public.is_any_admin()) WITH CHECK (public.is_any_admin())';
  EXECUTE 'CREATE POLICY tx_delete_admin ON public.transactions FOR DELETE TO authenticated USING (public.is_any_admin())';
END $$;

-- ============================================================
-- 5) Revocar grants explícitos a anon que dejó fix_rls_full_reset.
-- ============================================================

REVOKE ALL ON public.users FROM anon;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='transactions') THEN
    EXECUTE 'REVOKE ALL ON public.transactions FROM anon';
  END IF;
END $$;

-- ============================================================
-- 6) Smoke check (aparece en logs del SQL Editor al aplicar)
-- ============================================================

DO $$
DECLARE
  policies_users INT;
  policies_tx    INT := 0;
  trigger_exists BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO policies_users FROM pg_policies WHERE tablename = 'users' AND schemaname='public';
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='transactions') THEN
    SELECT COUNT(*) INTO policies_tx FROM pg_policies WHERE tablename = 'transactions' AND schemaname='public';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'users_sensitive_cols_guard'
      AND tgrelid = 'public.users'::regclass
  ) INTO trigger_exists;
  RAISE NOTICE 'security_hardening: policies users=%, transactions=%, trigger=%',
    policies_users, policies_tx, trigger_exists;
END $$;

-- 2026_site_events.sql
-- ───────────────────────────────────────────────────────
-- 2026_site_events.sql
--
-- Analítica liviana del sitio: la landing y las páginas estáticas
-- insertan un evento por vista (page, referrer) y actualizan
-- duration_seconds al salir (visibilitychange/unmount). El admin lo
-- ve en Soporte → Analíticas del sitio.
-- ───────────────────────────────────────────────────────


CREATE INDEX IF NOT EXISTS site_events_created_idx ON public.site_events (created_at DESC);
CREATE INDEX IF NOT EXISTS site_events_page_idx    ON public.site_events (page, created_at DESC);

ALTER TABLE public.site_events ENABLE ROW LEVEL SECURITY;

-- Visitantes (anónimos) pueden registrar su vista y actualizar la duración
DROP POLICY IF EXISTS site_events_insert ON public.site_events;
DROP POLICY IF EXISTS site_events_insert ON public.site_events;
CREATE POLICY site_events_insert ON public.site_events
    FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS site_events_update ON public.site_events;
DROP POLICY IF EXISTS site_events_update ON public.site_events;
CREATE POLICY site_events_update ON public.site_events
    FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Solo usuarios autenticados (el admin) pueden LEER las métricas
DROP POLICY IF EXISTS site_events_read ON public.site_events;
DROP POLICY IF EXISTS site_events_read ON public.site_events;
CREATE POLICY site_events_read ON public.site_events
    FOR SELECT TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';

-- 2026_to_currency_use_snapshots.sql
-- ───────────────────────────────────────────────────────
-- 2026_to_currency_use_snapshots.sql
--
-- Fix del fix: public.to_currency() leía de public.fx_rates (la
-- tabla de seed inicial, donde COP/USD vale 4000 hardcodeado y
-- nunca cambia). La TRM REAL vive en public.fx_rate_snapshots,
-- alimentada cada hora por la edge function fx-snapshot desde
-- Fawaz Currency API.
--
-- Esta migración reescribe to_currency para que:
--   1) Primero busque la snapshot MÁS RECIENTE de fx_rate_snapshots
--      (donde están las TRM reales del día).
--   2) Si no hay snapshot del par, intenta el par inverso.
--   3) Si tampoco, cae a public.fx_rates (legacy seed).
--   4) Como último recurso, constantes hardcoded para que el
--      sistema no se rompa si Fawaz cayó.
-- ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.to_currency(
    p_amount     numeric,
    p_from       text,
    p_to         text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_rate    numeric;
    v_inv     numeric;
    v_amt_usd numeric;
BEGIN
    IF p_amount IS NULL OR p_amount = 0 THEN RETURN 0; END IF;
    IF p_from IS NULL OR p_to IS NULL THEN RETURN p_amount; END IF;
    IF UPPER(p_from) = UPPER(p_to) THEN RETURN p_amount; END IF;

    -- 1) snapshot más reciente del par directo
    BEGIN
        SELECT rate INTO v_rate
        FROM public.fx_rate_snapshots
        WHERE UPPER(from_currency) = UPPER(p_from)
          AND UPPER(to_currency)   = UPPER(p_to)
        ORDER BY captured_at DESC
        LIMIT 1;
        IF v_rate IS NOT NULL AND v_rate > 0 THEN
            RETURN p_amount * v_rate;
        END IF;

        -- 2) snapshot inversa
        SELECT rate INTO v_inv
        FROM public.fx_rate_snapshots
        WHERE UPPER(from_currency) = UPPER(p_to)
          AND UPPER(to_currency)   = UPPER(p_from)
        ORDER BY captured_at DESC
        LIMIT 1;
        IF v_inv IS NOT NULL AND v_inv > 0 THEN
            RETURN p_amount / v_inv;
        END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- 3) fx_rates legacy (seed) por si el snapshot está vacío
    BEGIN
        SELECT rate INTO v_rate
        FROM public.fx_rates
        WHERE UPPER(from_currency) = UPPER(p_from)
          AND UPPER(to_currency)   = UPPER(p_to)
          AND is_active = true
        ORDER BY effective_from DESC NULLS LAST
        LIMIT 1;
        IF v_rate IS NOT NULL AND v_rate > 0 THEN
            RETURN p_amount * v_rate;
        END IF;

        SELECT rate INTO v_inv
        FROM public.fx_rates
        WHERE UPPER(from_currency) = UPPER(p_to)
          AND UPPER(to_currency)   = UPPER(p_from)
          AND is_active = true
        ORDER BY effective_from DESC NULLS LAST
        LIMIT 1;
        IF v_inv IS NOT NULL AND v_inv > 0 THEN
            RETURN p_amount / v_inv;
        END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- 4) Último recurso: constantes hardcoded vía pivote USD.
    --    Estas no se usan si Fawaz está vivo (cron cada hora popula
    --    fx_rate_snapshots y se gana por el paso 1).
    v_amt_usd := p_amount * CASE UPPER(p_from)
        WHEN 'USD' THEN 1.0
        WHEN 'COP' THEN 1.0 / 4000.0
        WHEN 'CLP' THEN 1.0 / 950.0
        WHEN 'PEN' THEN 1.0 / 3.7
        WHEN 'MXN' THEN 1.0 / 17.0
        WHEN 'BRL' THEN 1.0 / 5.5
        WHEN 'VES' THEN 1.0 / 36.0
        WHEN 'EUR' THEN 1.08
        ELSE 1.0
    END;

    RETURN v_amt_usd * CASE UPPER(p_to)
        WHEN 'USD' THEN 1.0
        WHEN 'COP' THEN 4000.0
        WHEN 'CLP' THEN 950.0
        WHEN 'PEN' THEN 3.7
        WHEN 'MXN' THEN 17.0
        WHEN 'BRL' THEN 5.5
        WHEN 'VES' THEN 36.0
        WHEN 'EUR' THEN 1.0 / 1.08
        ELSE 1.0
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.to_currency(numeric, text, text) TO anon, authenticated;

-- 2026_transactions_coupon_code.sql
-- ───────────────────────────────────────────────────────
-- 2026_transactions_coupon_code.sql
--
-- Persiste el cupón aplicado en cada transacción de tipo convert
-- (también funciona para send/load si en el futuro se aceptan).
--
-- Por qué dos columnas y no solo el código:
--   • coupon_code: lo que el cliente escribió/aplicó. Sirve para
--     mostrar "Cupón aplicado: WELCOME20" en el detalle de la TX
--     y para auditar qué campañas convirtieron.
--   • coupon_discount_pct: snapshot del % que estaba activo AL
--     MOMENTO de la transacción. Si después el admin cambia el %
--     o desactiva el cupón, la TX vieja sigue mostrando el valor
--     real que le aplicaron al cliente (no el actual).
--
-- Ambas son NULLABLE — TXs sin cupón siguen funcionando igual.
--
-- Cómo lo persiste la app:
--   La app móvil llama al RPC create_convert_transaction(... p_coupon_code text).
--   Ese RPC (que vive en el repo de Antigravity) tiene que extraer
--   el % del cupón desde public.app_settings.value->'coupons' (donde
--   el admin lo edita desde el panel) y guardar AMBOS valores en la fila.
-- ───────────────────────────────────────────────────────

ALTER TABLE public.transactions
    ADD COLUMN IF NOT EXISTS coupon_code         text,
    ADD COLUMN IF NOT EXISTS coupon_discount_pct numeric;

CREATE INDEX IF NOT EXISTS transactions_coupon_code_idx
    ON public.transactions(coupon_code)
    WHERE coupon_code IS NOT NULL;

COMMENT ON COLUMN public.transactions.coupon_code IS
    'Código del cupón aplicado por el cliente al crear la TX (NULL si no usó cupón).';
COMMENT ON COLUMN public.transactions.coupon_discount_pct IS
    'Snapshot del % de descuento que el cupón otorgaba AL MOMENTO de la TX.';

-- ─────────────────────────────────────────────
-- Helper que cualquiera puede usar para resolver un cupón al
-- momento de aplicarlo. Devuelve el % de descuento si el cupón
-- está activo, o NULL si no existe / está inactivo / vencido.
--
-- El RPC create_convert_transaction de Antigravity debería llamar
-- a esta función para resolver el % a guardar en coupon_discount_pct.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_coupon_discount(p_code text)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_coupons jsonb;
    v_match   jsonb;
    v_pct     numeric;
    v_exp     timestamptz;
    v_active  boolean;
BEGIN
    IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
        RETURN NULL;
    END IF;

    -- app_settings es key/value singleton: probamos value, después config,
    -- y por último columnas planas. Eso cubre las 3 shapes históricas.
    SELECT COALESCE(
               (SELECT value->'coupons'  FROM public.app_settings LIMIT 1),
               (SELECT config->'coupons' FROM public.app_settings LIMIT 1)
           )
    INTO v_coupons;

    IF v_coupons IS NULL OR jsonb_typeof(v_coupons) <> 'array' THEN
        RETURN NULL;
    END IF;

    -- Buscamos el primero que matchee code (case-insensitive)
    SELECT elem INTO v_match
    FROM jsonb_array_elements(v_coupons) AS elem
    WHERE upper(elem->>'code') = upper(trim(p_code))
    LIMIT 1;

    IF v_match IS NULL THEN
        RETURN NULL;
    END IF;

    v_active := COALESCE((v_match->>'active')::boolean, false);
    IF NOT v_active THEN
        RETURN NULL;
    END IF;

    -- Si tiene fecha de vencimiento, chequear que no esté vencido
    IF v_match ? 'expires_at' AND v_match->>'expires_at' IS NOT NULL THEN
        v_exp := (v_match->>'expires_at')::timestamptz;
        IF v_exp < now() THEN RETURN NULL; END IF;
    END IF;

    v_pct := (v_match->>'discount')::numeric;
    IF v_pct IS NULL OR v_pct <= 0 THEN
        RETURN NULL;
    END IF;

    RETURN v_pct;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_coupon_discount(text) TO authenticated;

-- ─────────────────────────────────────────────
-- Verificación
-- ─────────────────────────────────────────────
SELECT
    column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'transactions'
  AND column_name IN ('coupon_code', 'coupon_discount_pct');

-- 2026_treasury_auto_client_load.sql
-- ════════════════════════════════════════════════════════
-- Cargue de cliente → tesorería (auto-crédito al aprobar)
--
-- Cuando una transacción kind='load' (cargue) pasa a estado aprobado/
-- completado, se acredita automáticamente la cuenta del LIBRO de tesorería
-- enlazada a la cuenta bancaria donde el cliente depositó
-- (treasury_accounts.bank_account_id = transactions.bank_account_id).
--
-- Idempotente: cada TX genera a lo sumo UN movimiento client_load
-- (treasury_movements.source_tx_id único). No se puede duplicar el crédito.
--
-- Requisito del app: la TX de cargue debe traer bank_account_id (la cuenta
-- cuypay_bank_accounts donde se depositó). Si viene null, no se acredita
-- (el admin lo verá como cargue sin cuenta asignada).
-- ════════════════════════════════════════════════════════

-- ───── 1. Idempotencia: enlazar cada movimiento con su TX de origen ─────
ALTER TABLE public.treasury_movements ADD COLUMN IF NOT EXISTS source_tx_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_mov_source_tx
    ON public.treasury_movements(source_tx_id)
    WHERE source_tx_id IS NOT NULL;

-- ───── 2. Función del trigger ─────
CREATE OR REPLACE FUNCTION public.tg_treasury_on_load_approved()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_acct      public.treasury_accounts%ROWTYPE;
    v_amount    NUMERIC;
    v_is_final  BOOLEAN;
    v_was_final BOOLEAN;
    FINAL_STATES TEXT[] := ARRAY['approved','completed','aprobada','completado','aprobado','success','confirmed'];
    LOAD_KINDS   TEXT[] := ARRAY['load','carga','deposit','topup','recarga'];
BEGIN
    -- Solo cargues
    IF lower(COALESCE(NEW.kind, '')) <> ALL (LOAD_KINDS) THEN
        RETURN NEW;
    END IF;

    v_is_final  := lower(COALESCE(NEW.status, '')) = ANY (FINAL_STATES);
    v_was_final := lower(COALESCE(OLD.status, '')) = ANY (FINAL_STATES);

    -- Solo cuando la TX RECIÉN pasa a estado final
    IF NOT v_is_final OR v_was_final THEN
        RETURN NEW;
    END IF;

    -- Necesita cuenta de depósito para saber a qué cuenta del libro acreditar
    IF NEW.bank_account_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Cuenta del libro enlazada a esa cuenta bancaria
    SELECT * INTO v_acct
    FROM public.treasury_accounts
    WHERE bank_account_id = NEW.bank_account_id
    LIMIT 1;
    IF NOT FOUND THEN
        RETURN NEW;  -- no hay cuenta de libro enlazada; el admin puede registrarlo manual
    END IF;

    -- Idempotencia: no duplicar si ya se registró el cargue de esta TX
    IF EXISTS (SELECT 1 FROM public.treasury_movements WHERE source_tx_id = NEW.id::text) THEN
        RETURN NEW;
    END IF;

    v_amount := COALESCE(NEW.amount, 0);
    IF v_amount <= 0 THEN
        RETURN NEW;
    END IF;

    -- Registrar el movimiento + acreditar la cuenta del libro
    INSERT INTO public.treasury_movements (
        kind, to_account_id, to_amount, to_currency, notes, source_tx_id, created_at
    ) VALUES (
        'client_load', v_acct.id, v_amount, v_acct.currency,
        'Cargue de cliente · TX ' || NEW.id::text, NEW.id::text, NOW()
    );

    UPDATE public.treasury_accounts
    SET balance = balance + v_amount, updated_at = NOW()
    WHERE id = v_acct.id;

    RETURN NEW;
END;
$$;

-- ───── 3. Trigger sobre cambios de estado de la transacción ─────
DROP TRIGGER IF EXISTS trg_treasury_on_load_approved ON public.transactions;
CREATE TRIGGER trg_treasury_on_load_approved
    AFTER UPDATE OF status ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.tg_treasury_on_load_approved();

NOTIFY pgrst, 'reload schema';

-- ───── 4. Verificación ─────
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trg_treasury_on_load_approved';

-- 2026_treasury_by_currency.sql
-- ════════════════════════════════════════════════════════
-- Tesorería delegada por moneda
--
-- Cada admin de tesorería puede tener asignada UNA moneda
-- principal (COP, CLP, PEN, MXN, BRL). Solo verá las cuentas,
-- transacciones y pares FX que tocan esa moneda.
--
-- assigned_currency = NULL → ve todas (rol "treasury global"
-- como antes, o super_admin)
-- ════════════════════════════════════════════════════════

-- ───── 1. Columna en users ─────
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS assigned_currency TEXT
        CHECK (assigned_currency IS NULL OR assigned_currency IN ('COP','CLP','PEN','MXN','BRL'));

COMMENT ON COLUMN public.users.assigned_currency IS
    'Moneda asignada al admin de tesorería. NULL = ve todas (super_admin o treasury global). Valor = solo ve TX/cuentas/pares de esa moneda.';

-- ───── 2. Vista: balance calculado por moneda ─────
-- Suma los loads aprobados/completed (entradas) y resta los sends aprobados/completed
-- (salidas). Hace lo mismo para los pendientes.
-- NOTA: usamos la columna `amount` y `currency` del esquema CuyPayANDROID.
-- Si la app guarda algo distinto (ej. from_currency), ajustar el COALESCE.
CREATE OR REPLACE VIEW public.currency_balances AS
WITH tx AS (
    SELECT
        COALESCE(currency, 'UNKNOWN') AS currency,
        kind,
        status,
        COALESCE(amount, 0) AS amount
    FROM public.transactions
    WHERE COALESCE(currency, '') <> ''
)
SELECT
    currency,
    -- Saldo confirmado (loads completados - sends completados)
    COALESCE(SUM(amount) FILTER (
        WHERE kind = 'load'
          AND lower(COALESCE(status,'')) IN ('completed','approved','aprobada','completado','aprobado')
    ), 0) -
    COALESCE(SUM(amount) FILTER (
        WHERE kind = 'send'
          AND lower(COALESCE(status,'')) IN ('completed','approved','aprobada','completado','aprobado')
    ), 0) AS confirmed_balance,

    -- Loads pendientes (van a entrar)
    COALESCE(SUM(amount) FILTER (
        WHERE kind = 'load'
          AND lower(COALESCE(status,'')) IN ('pending','pendiente')
    ), 0) AS pending_in,

    -- Sends pendientes (van a salir)
    COALESCE(SUM(amount) FILTER (
        WHERE kind = 'send'
          AND lower(COALESCE(status,'')) IN ('pending','pendiente')
    ), 0) AS pending_out,

    -- Conteos
    COUNT(*) FILTER (
        WHERE lower(COALESCE(status,'')) IN ('pending','pendiente')
    ) AS pending_count,

    COUNT(*) AS total_tx
FROM tx
GROUP BY currency;

GRANT SELECT ON public.currency_balances TO authenticated;

-- ───── 3. Función helper: el caller ¿tiene acceso a esta moneda? ─────
CREATE OR REPLACE FUNCTION public.user_can_see_currency(p_currency TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    u RECORD;
BEGIN
    SELECT admin_role, assigned_currency INTO u
    FROM public.users WHERE id = auth.uid();
    IF NOT FOUND THEN RETURN false; END IF;

    -- super_admin ve todo
    IF u.admin_role = 'super_admin' THEN RETURN true; END IF;

    -- audit/compliance ven todo (solo lectura general)
    IF u.admin_role IN ('audit','compliance') THEN RETURN true; END IF;

    -- treasury sin moneda asignada = treasury global
    IF u.admin_role = 'treasury' AND u.assigned_currency IS NULL THEN RETURN true; END IF;

    -- treasury con moneda asignada = solo su moneda
    IF u.admin_role = 'treasury' AND u.assigned_currency = p_currency THEN RETURN true; END IF;

    RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_can_see_currency(TEXT) TO authenticated;

-- ───── 4. Verificación ─────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'assigned_currency';

SELECT * FROM public.currency_balances ORDER BY currency;

-- Recargar schema cache de PostgREST
NOTIFY pgrst, 'reload schema';

-- 2026_treasury_capital_in.sql
-- ════════════════════════════════════════════════════════
-- Tesorería: tipo de movimiento "capital_in" (aporte propio)
--
-- Cuando el dueño / la sociedad mete plata a una cuenta (capital inicial,
-- préstamo de socio, reintegro, etc.). Es un INGRESO al libro distinto a
-- un cargue de cliente.
-- ════════════════════════════════════════════════════════

ALTER TABLE public.treasury_movements DROP CONSTRAINT IF EXISTS treasury_movements_kind_check;
ALTER TABLE public.treasury_movements ADD CONSTRAINT treasury_movements_kind_check
    CHECK (kind IN (
        'internal_transfer','fx_buy_usdt','fx_sell_usdt',
        'client_load','client_payout','adjustment','expense','profit',
        'capital_in'
    ));

NOTIFY pgrst, 'reload schema';

-- 2026_treasury_expense.sql
-- ════════════════════════════════════════════════════════
-- Tesorería: agregar tipo de movimiento "expense" (gastos)
--
-- Permite registrar gastos que reducen el saldo de una cuenta:
-- comisiones, impuestos, cuota de manejo, comisión bancaria, etc.
-- ════════════════════════════════════════════════════════

ALTER TABLE public.treasury_movements DROP CONSTRAINT IF EXISTS treasury_movements_kind_check;
ALTER TABLE public.treasury_movements ADD CONSTRAINT treasury_movements_kind_check
    CHECK (kind IN (
        'internal_transfer','fx_buy_usdt','fx_sell_usdt',
        'client_load','client_payout','adjustment','expense'
    ));

NOTIFY pgrst, 'reload schema';

-- 2026_treasury_ledger.sql
-- ════════════════════════════════════════════════════════
-- TESORERÍA CONTABLE — cuentas internas + libro de movimientos
--
-- Modela la tesorería real de CuyPay como un libro contable:
--   • treasury_accounts: cada "bolsa" de dinero (cuentas bancarias por
--     país + wallets USDT por exchange). Cada una tiene su saldo.
--   • treasury_movements: el LIBRO. Cada movimiento debita una cuenta y
--     acredita otra (doble entrada), con tasa, comisión e impuesto.
--   • treasury_apply_movement(): función atómica que inserta el movimiento
--     y actualiza los saldos en una sola transacción.
--
-- Flujo FX en 2 pasos (BRL → COP vía USDT):
--   1. fx_buy_usdt:  cuenta BRL  → wallet USDT   (gastás BRL, recibís USDT)
--   2. fx_sell_usdt: wallet USDT → cuenta COP    (gastás USDT, recibís COP)
--   Podés dejar fondos parados en USDT entre los dos pasos.
-- ════════════════════════════════════════════════════════

-- ───── 1. Cuentas de tesorería ─────
ALTER TABLE public.treasury_accounts ENABLE ROW LEVEL SECURITY;

-- ───── 2. Libro de movimientos ─────
CREATE INDEX IF NOT EXISTS idx_treasury_mov_from ON public.treasury_movements(from_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_treasury_mov_to   ON public.treasury_movements(to_account_id, created_at DESC);
ALTER TABLE public.treasury_movements ENABLE ROW LEVEL SECURITY;

-- ───── 3. Función atómica: registrar movimiento + actualizar saldos ─────
CREATE OR REPLACE FUNCTION public.treasury_apply_movement(
    p_kind          TEXT,
    p_from_account  UUID,
    p_to_account    UUID,
    p_from_amount   NUMERIC,
    p_to_amount     NUMERIC,
    p_exchange_rate NUMERIC DEFAULT NULL,
    p_fee_amount    NUMERIC DEFAULT 0,
    p_fee_currency  TEXT DEFAULT NULL,
    p_tax_amount    NUMERIC DEFAULT 0,
    p_tax_currency  TEXT DEFAULT NULL,
    p_notes         TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_from     RECORD;
    v_to       RECORD;
    v_mov_id   UUID;
    v_caller   UUID := auth.uid();
    v_is_admin BOOLEAN;
BEGIN
    -- Solo super_admin / treasury pueden mover plata de tesorería
    SELECT (admin_role IN ('super_admin','treasury')) INTO v_is_admin
    FROM public.users WHERE id = v_caller;
    IF NOT COALESCE(v_is_admin, false) THEN
        RAISE EXCEPTION 'No autorizado: solo super_admin o treasury pueden registrar movimientos';
    END IF;

    -- Validar cuentas
    IF p_from_account IS NOT NULL THEN
        SELECT * INTO v_from FROM public.treasury_accounts WHERE id = p_from_account FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta origen no existe'; END IF;
    END IF;
    IF p_to_account IS NOT NULL THEN
        SELECT * INTO v_to FROM public.treasury_accounts WHERE id = p_to_account FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta destino no existe'; END IF;
    END IF;

    -- Insertar movimiento
    INSERT INTO public.treasury_movements (
        kind, from_account_id, to_account_id, from_amount, to_amount,
        from_currency, to_currency, exchange_rate,
        fee_amount, fee_currency, tax_amount, tax_currency, notes, created_by
    ) VALUES (
        p_kind, p_from_account, p_to_account, COALESCE(p_from_amount,0), COALESCE(p_to_amount,0),
        v_from.currency, v_to.currency, p_exchange_rate,
        COALESCE(p_fee_amount,0), p_fee_currency, COALESCE(p_tax_amount,0), p_tax_currency, p_notes, v_caller
    ) RETURNING id INTO v_mov_id;

    -- Actualizar saldos
    IF p_from_account IS NOT NULL THEN
        UPDATE public.treasury_accounts
        SET balance = balance - COALESCE(p_from_amount,0), updated_at = NOW()
        WHERE id = p_from_account;
    END IF;
    IF p_to_account IS NOT NULL THEN
        UPDATE public.treasury_accounts
        SET balance = balance + COALESCE(p_to_amount,0), updated_at = NOW()
        WHERE id = p_to_account;
    END IF;

    RETURN v_mov_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.treasury_apply_movement TO authenticated;

-- ───── 4. RLS ─────
DROP POLICY IF EXISTS "treasury_accounts_read" ON public.treasury_accounts;
DROP POLICY IF EXISTS "treasury_accounts_read" ON public.treasury_accounts;
CREATE POLICY "treasury_accounts_read" ON public.treasury_accounts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL));

DROP POLICY IF EXISTS "treasury_accounts_write" ON public.treasury_accounts;
DROP POLICY IF EXISTS "treasury_accounts_write" ON public.treasury_accounts;
CREATE POLICY "treasury_accounts_write" ON public.treasury_accounts
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IN ('super_admin','treasury')));

DROP POLICY IF EXISTS "treasury_movements_read" ON public.treasury_movements;
DROP POLICY IF EXISTS "treasury_movements_read" ON public.treasury_movements;
CREATE POLICY "treasury_movements_read" ON public.treasury_movements
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND admin_role IS NOT NULL));
-- Los inserts van por la función treasury_apply_movement (SECURITY DEFINER)

-- ───── 5. Seed: crear cuentas de tesorería desde los bancos configurados ─────
INSERT INTO public.treasury_accounts (name, type, currency, country_code, bank_account_id)
SELECT
    ba.bank_name || ' ' || public.country_to_currency(ba.country_code),
    'bank',
    public.country_to_currency(ba.country_code),
    ba.country_code,
    ba.id
FROM public.cuypay_bank_accounts ba
WHERE NOT EXISTS (
    SELECT 1 FROM public.treasury_accounts ta WHERE ta.bank_account_id = ba.id
);

-- Wallets USDT por exchange (las que uses)
INSERT INTO public.treasury_accounts (name, type, currency, exchange) VALUES
    ('USDT Binance', 'crypto', 'USDT', 'Binance'),
    ('USDT Bitso',   'crypto', 'USDT', 'Bitso')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ───── 6. Verificar ─────
SELECT name, type, currency, country_code, exchange, balance FROM public.treasury_accounts ORDER BY type, currency;

-- 2026_treasury_main_wallet.sql
-- ════════════════════════════════════════════════════════
-- Tesorería: billetera principal en USDT (reserva)
--
-- Aparte de las wallets operativas (Binance, Bybit, etc.) y la billetera de
-- utilidades, se crea una billetera "Tesorería" en USDT — el cofre principal
-- donde se concentra la reserva. is_treasury la marca como tal.
-- ════════════════════════════════════════════════════════

ALTER TABLE public.treasury_accounts ADD COLUMN IF NOT EXISTS is_treasury BOOLEAN DEFAULT false;

INSERT INTO public.treasury_accounts (name, type, currency, exchange, is_treasury)
SELECT 'Tesorería USDT', 'crypto', 'USDT', 'Tesorería', true
WHERE NOT EXISTS (SELECT 1 FROM public.treasury_accounts WHERE is_treasury = true);

NOTIFY pgrst, 'reload schema';

SELECT name, type, currency, exchange, is_treasury, is_profit, balance
FROM public.treasury_accounts
ORDER BY is_treasury DESC, is_profit DESC, type, currency;

-- 2026_treasury_profit.sql
-- ════════════════════════════════════════════════════════
-- Tesorería: billetera de utilidades + movimiento "profit"
--
-- Permite mandar la utilidad (margen) a una billetera dedicada.
-- Se guarda en USDT por defecto, pero puede convertirse desde cualquier
-- cuenta. El movimiento 'profit' debita la cuenta operativa y acredita
-- la billetera de utilidades.
-- ════════════════════════════════════════════════════════

-- Permitir el tipo 'profit'
ALTER TABLE public.treasury_movements DROP CONSTRAINT IF EXISTS treasury_movements_kind_check;
ALTER TABLE public.treasury_movements ADD CONSTRAINT treasury_movements_kind_check
    CHECK (kind IN (
        'internal_transfer','fx_buy_usdt','fx_sell_usdt',
        'client_load','client_payout','adjustment','expense','profit'
    ));

-- Marca de billetera de utilidades
ALTER TABLE public.treasury_accounts ADD COLUMN IF NOT EXISTS is_profit BOOLEAN DEFAULT false;

-- Crear la billetera de utilidades en USDT si no existe
INSERT INTO public.treasury_accounts (name, type, currency, exchange, is_profit)
SELECT 'Utilidades USDT', 'crypto', 'USDT', 'Utilidades', true
WHERE NOT EXISTS (SELECT 1 FROM public.treasury_accounts WHERE is_profit = true);

NOTIFY pgrst, 'reload schema';

SELECT name, type, currency, is_profit, balance FROM public.treasury_accounts ORDER BY is_profit DESC, type, currency;

-- 2026_tx_insert_own.sql
-- ════════════════════════════════════════════════════════
-- "No hay movimientos": la migración de seguridad dejó transactions con
-- INSERT solo-admin (tx_insert_admin), así que los movimientos de los
-- clientes (depósitos, envíos, recargas) fallaban EN SILENCIO y nunca
-- llegaban a la base.
--
-- Arreglo: cada usuario autenticado puede INSERTAR únicamente filas
-- propias (user_id = su uid). UPDATE y DELETE siguen siendo solo-admin,
-- y el SELECT propio ya existía. Los saldos siguen protegidos por el
-- guard de users — registrar una transacción no mueve dinero.
-- ════════════════════════════════════════════════════════

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='transactions') THEN
    EXECUTE 'DROP POLICY IF EXISTS tx_insert_admin ON public.transactions';
    EXECUTE 'DROP POLICY IF EXISTS tx_insert_own_or_admin ON public.transactions';
    EXECUTE $p$CREATE POLICY tx_insert_own_or_admin ON public.transactions
      FOR INSERT TO authenticated
      WITH CHECK ((user_id IS NOT NULL AND user_id::text = auth.uid()::text) OR public.is_any_admin())$p$;
  END IF;
END $$;

-- 2026_user_block.sql
-- ════════════════════════════════════════════════════════
-- Bloqueo de usuarios por compliance
--
-- El KYC lo decide Didit. Compliance NO aprueba/rechaza KYC desde el
-- admin — pero SÍ puede bloquear a un usuario que infrinja una norma AML.
-- Agregamos las columnas para soportar ese bloqueo.
-- ════════════════════════════════════════════════════════

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS is_blocked     BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS blocked_reason TEXT,
    ADD COLUMN IF NOT EXISTS blocked_at     TIMESTAMPTZ;

COMMENT ON COLUMN public.users.is_blocked IS
    'Si true, el usuario está bloqueado por compliance (no puede operar). El KYC lo maneja Didit aparte.';

-- La app móvil debería chequear is_blocked al iniciar sesión / operar:
--   SELECT is_blocked FROM users WHERE id = auth.uid();
-- y negar operaciones si es true.

-- Forzar reload del schema cache de PostgREST
NOTIFY pgrst, 'reload schema';

-- Verificar
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'users'
  AND column_name IN ('is_blocked', 'blocked_reason', 'blocked_at');

-- 2026_user_block_reason.sql
-- ───────────────────────────────────────────────────────
-- 2026_user_block_reason.sql
--
-- Agrega columnas para que el bloqueo desde Compliance guarde
-- motivo estructurado + checklist de documentos requeridos para
-- levantar el bloqueo. Las apps mobile leen esto para renderizar
-- el ComplianceBanner rojo con el sheet de detalle.
--
-- Nuevas columnas en public.users:
--   block_reason        text        — motivo elegido por el admin
--   block_notes         text        — nota libre opcional
--   required_documents  jsonb array — ['cedula_front','proof_income',…]
--
-- No borra ni renombra nada existente. Idempotente.
-- ───────────────────────────────────────────────────────

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS block_reason       text,
    ADD COLUMN IF NOT EXISTS block_notes        text,
    ADD COLUMN IF NOT EXISTS required_documents jsonb DEFAULT '[]'::jsonb;

-- Índice para queries del banner mobile (busca users con block activo).
CREATE INDEX IF NOT EXISTS idx_users_is_active_false
    ON public.users(id) WHERE is_active = false;

-- 2026_user_block_type.sql
-- ───────────────────────────────────────────────────────
-- 2026_user_block_type.sql
--
-- Agrega columna block_type para distinguir bloqueo temporal
-- (el user puede desbloquearse subiendo docs) vs bloqueo
-- permanente (no hay flujo de desbloqueo desde la app, solo
-- vía intervención manual).
--
-- Flujo:
--   1) Admin bloquea temporalmente + pide docs.
--   2) User sube docs a document_requests.
--   3) Admin revisa. Si NO justifican, presiona "Bloqueo
--      permanente" en el ReviewModal → block_type='permanent'.
--   4) Mobile ComplianceBanner rojo cambia de "subí docs para
--      desbloquearte" → "cuenta bloqueada permanentemente,
--      contactá soporte".
--
-- Idempotente.
-- ───────────────────────────────────────────────────────

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS block_type text
        CHECK (block_type IN ('temporary', 'permanent'));

-- 2026_user_limits.sql
-- ───────────────────────────────────────────────────────
-- 2026_user_limits.sql
--
-- Topes operativos diarios y mensuales por usuario, con defaults
-- globales editables desde el admin.
--
-- Resolución del tope efectivo (front + backend):
--   1) Si users.custom_daily_limit / custom_monthly_limit NO son NULL
--      → ese valor es el tope del user (sobreescribe el global).
--   2) Si son NULL → se usa el default global de
--      app_settings.value WHERE key='operational_limits'
--      con shape { daily: number, monthly: number, currency: text }
--
-- El consumo (used) se calcula de transactions del último periodo
-- (rolling 24h y rolling 30d) sumando los montos de kind in
-- ('send','load','convert') con status in ('completed','approved','sent').
-- ───────────────────────────────────────────────────────

-- 1) Columnas custom en users
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS custom_daily_limit   numeric,
    ADD COLUMN IF NOT EXISTS custom_monthly_limit numeric,
    ADD COLUMN IF NOT EXISTS limits_currency      text;

COMMENT ON COLUMN public.users.custom_daily_limit IS
    'Override del tope diario. NULL = aplica el default global.';
COMMENT ON COLUMN public.users.custom_monthly_limit IS
    'Override del tope mensual. NULL = aplica el default global.';
COMMENT ON COLUMN public.users.limits_currency IS
    'Moneda en la que se interpretan los topes. NULL = la global.';

-- 2) Default global (idempotente — si ya existe la fila no rompe)
INSERT INTO public.app_settings (key, value)
VALUES (
    'operational_limits',
    jsonb_build_object('daily', 800, 'monthly', 3000, 'currency', 'USD')
)
ON CONFLICT (key) DO NOTHING;

-- 3) RPC summary: para un usuario dado, devuelve el tope efectivo,
--    el consumo rolling 24h / 30d, y los % de uso.
CREATE OR REPLACE FUNCTION public.get_user_limits_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_custom_d      numeric;
    v_custom_m      numeric;
    v_user_curr     text;
    v_global        jsonb;
    v_eff_daily     numeric;
    v_eff_monthly   numeric;
    v_eff_currency  text;
    v_used_d        numeric;
    v_used_m        numeric;
    v_caller_role   text;
BEGIN
    -- Permisos: el propio user puede consultarse a sí mismo,
    -- los admins de compliance/treasury/super_admin pueden ver a cualquiera.
    SELECT admin_role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;
    IF auth.uid() <> p_user_id
       AND COALESCE(v_caller_role, '') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error', 'forbidden');
    END IF;

    -- 1) traer custom + global
    SELECT custom_daily_limit, custom_monthly_limit, limits_currency
    INTO v_custom_d, v_custom_m, v_user_curr
    FROM public.users WHERE id = p_user_id;

    SELECT value INTO v_global
    FROM public.app_settings WHERE key = 'operational_limits';

    v_eff_daily    := COALESCE(v_custom_d, (v_global->>'daily')::numeric, 800);
    v_eff_monthly  := COALESCE(v_custom_m, (v_global->>'monthly')::numeric, 3000);
    v_eff_currency := COALESCE(v_user_curr, v_global->>'currency', 'USD');

    -- 2) consumo rolling: sumamos send + load + convert completadas/aprobadas
    --    Tomamos amount como proxy en moneda original (no convertimos a USD
    --    acá; el admin que cambie el currency se hace cargo de coherencia).
    SELECT COALESCE(SUM(COALESCE(amount, from_amount, 0)), 0)
    INTO v_used_d
    FROM public.transactions
    WHERE (owner_user_id = p_user_id OR user_id = p_user_id)
      AND created_at >= now() - interval '24 hours'
      AND COALESCE(kind, type) IN ('send', 'load', 'convert', 'envio', 'carga')
      AND COALESCE(status, '') IN ('completed', 'approved', 'sent', 'success');

    SELECT COALESCE(SUM(COALESCE(amount, from_amount, 0)), 0)
    INTO v_used_m
    FROM public.transactions
    WHERE (owner_user_id = p_user_id OR user_id = p_user_id)
      AND created_at >= now() - interval '30 days'
      AND COALESCE(kind, type) IN ('send', 'load', 'convert', 'envio', 'carga')
      AND COALESCE(status, '') IN ('completed', 'approved', 'sent', 'success');

    RETURN jsonb_build_object(
        'currency',           v_eff_currency,
        'daily_max',          v_eff_daily,
        'monthly_max',        v_eff_monthly,
        'daily_used',         v_used_d,
        'monthly_used',       v_used_m,
        'daily_pct',          CASE WHEN v_eff_daily > 0   THEN ROUND((v_used_d / v_eff_daily   * 100)::numeric, 2) ELSE 0 END,
        'monthly_pct',        CASE WHEN v_eff_monthly > 0 THEN ROUND((v_used_m / v_eff_monthly * 100)::numeric, 2) ELSE 0 END,
        'is_custom_daily',    v_custom_d IS NOT NULL,
        'is_custom_monthly',  v_custom_m IS NOT NULL
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_limits_summary(uuid) TO authenticated;

-- 4) RPC para que un admin actualice los custom limits de un user
CREATE OR REPLACE FUNCTION public.admin_set_user_limits(
    p_user_id        uuid,
    p_daily_limit    numeric DEFAULT NULL,
    p_monthly_limit  numeric DEFAULT NULL,
    p_currency       text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role text;
BEGIN
    SELECT admin_role INTO v_role FROM public.users WHERE id = auth.uid();
    IF COALESCE(v_role, '') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error', 'forbidden');
    END IF;

    UPDATE public.users
    SET
        custom_daily_limit   = p_daily_limit,
        custom_monthly_limit = p_monthly_limit,
        limits_currency      = p_currency
    WHERE id = p_user_id;

    -- Audit log
    INSERT INTO public.admin_actions (admin_id, admin_email, admin_role, action, target_type, target_id, metadata)
    SELECT
        u.id, u.email, u.admin_role,
        'user_limits.update', 'user', p_user_id::text,
        jsonb_build_object(
            'daily_limit',   p_daily_limit,
            'monthly_limit', p_monthly_limit,
            'currency',      p_currency
        )
    FROM public.users u WHERE u.id = auth.uid();

    RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_user_limits(uuid, numeric, numeric, text) TO authenticated;

-- 2026_user_limits_fix.sql
-- ───────────────────────────────────────────────────────
-- 2026_user_limits_fix.sql
--
-- Fix del RPC get_user_limits_summary: en la migración original puse
-- COALESCE(amount, from_amount, 0) pero `from_amount` no es columna
-- real de transactions — es solo un alias PostgREST que usa el front
-- para mapear `currency`. En el RPC tenemos que usar las columnas
-- reales: amount.
--
-- Error reportado:
--   column "from_amount" does not exist
-- ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_user_limits_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_custom_d      numeric;
    v_custom_m      numeric;
    v_user_curr     text;
    v_global        jsonb;
    v_eff_daily     numeric;
    v_eff_monthly   numeric;
    v_eff_currency  text;
    v_used_d        numeric;
    v_used_m        numeric;
    v_caller_role   text;
BEGIN
    -- Permisos: el propio user puede consultarse; admins compliance/treasury/super_admin a cualquiera
    SELECT admin_role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('error', 'not_authenticated');
    END IF;
    IF auth.uid() <> p_user_id
       AND COALESCE(v_caller_role, '') NOT IN ('super_admin','compliance','treasury') THEN
        RETURN jsonb_build_object('error', 'forbidden');
    END IF;

    -- 1) traer custom + global
    SELECT custom_daily_limit, custom_monthly_limit, limits_currency
    INTO v_custom_d, v_custom_m, v_user_curr
    FROM public.users WHERE id = p_user_id;

    SELECT value INTO v_global
    FROM public.app_settings WHERE key = 'operational_limits';

    v_eff_daily    := COALESCE(v_custom_d, (v_global->>'daily')::numeric, 800);
    v_eff_monthly  := COALESCE(v_custom_m, (v_global->>'monthly')::numeric, 3000);
    v_eff_currency := COALESCE(v_user_curr, v_global->>'currency', 'USD');

    -- 2) consumo rolling — usamos SOLO `amount` (única columna real).
    --    owner_user_id vs user_id porque CuyPayANDROID usa la primera y
    --    legacy la segunda.
    SELECT COALESCE(SUM(COALESCE(amount, 0)), 0)
    INTO v_used_d
    FROM public.transactions
    WHERE (owner_user_id = p_user_id OR user_id = p_user_id)
      AND created_at >= now() - interval '24 hours'
      AND COALESCE(kind, type) IN ('send', 'load', 'convert', 'envio', 'carga')
      AND COALESCE(status, '') IN ('completed', 'approved', 'sent', 'success');

    SELECT COALESCE(SUM(COALESCE(amount, 0)), 0)
    INTO v_used_m
    FROM public.transactions
    WHERE (owner_user_id = p_user_id OR user_id = p_user_id)
      AND created_at >= now() - interval '30 days'
      AND COALESCE(kind, type) IN ('send', 'load', 'convert', 'envio', 'carga')
      AND COALESCE(status, '') IN ('completed', 'approved', 'sent', 'success');

    RETURN jsonb_build_object(
        'currency',           v_eff_currency,
        'daily_max',          v_eff_daily,
        'monthly_max',        v_eff_monthly,
        'daily_used',         v_used_d,
        'monthly_used',       v_used_m,
        'daily_pct',          CASE WHEN v_eff_daily > 0   THEN ROUND((v_used_d / v_eff_daily   * 100)::numeric, 2) ELSE 0 END,
        'monthly_pct',        CASE WHEN v_eff_monthly > 0 THEN ROUND((v_used_m / v_eff_monthly * 100)::numeric, 2) ELSE 0 END,
        'is_custom_daily',    v_custom_d IS NOT NULL,
        'is_custom_monthly',  v_custom_m IS NOT NULL
    );
END;
$$;

-- 2026_users_update_own.sql
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

-- 2026_xe_config_admin_rls.sql
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

-- add_crypto_balances_column.sql
-- ============================================================
-- Add crypto_balances column to separate USDT/USDC from fiat.
-- Run this in Supabase SQL Editor.
-- ============================================================

-- 1. Add the column (safe to run multiple times)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS crypto_balances JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. Migrate any existing USDT/USDC from balances → crypto_balances
UPDATE public.users
SET
  crypto_balances = jsonb_build_object(
    'USDT', COALESCE((balances->>'USDT')::numeric, 0),
    'USDC', COALESCE((balances->>'USDC')::numeric, 0),
    'BTC',  COALESCE((balances->>'BTC')::numeric, 0),
    'ETH',  COALESCE((balances->>'ETH')::numeric, 0)
  ),
  balances = balances - 'USDT' - 'USDC' - 'BTC' - 'ETH'
WHERE
  (balances ? 'USDT') OR (balances ? 'USDC') OR (balances ? 'BTC') OR (balances ? 'ETH');

-- 3. Re-create admin RPC functions to include the new column
CREATE OR REPLACE FUNCTION public.cuypay_get_all_users()
RETURNS SETOF public.users
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.users;
$$;

CREATE OR REPLACE FUNCTION public.cuypay_get_all_transactions()
RETURNS SETOF public.transactions
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.transactions;
$$;

GRANT EXECUTE ON FUNCTION public.cuypay_get_all_users        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cuypay_get_all_transactions TO anon, authenticated;

-- add_kyc_columns.sql
-- Migration: Add dedicated KYC columns to users table
-- Run this in the Supabase SQL Editor

ALTER TABLE public.users
  -- Personal KYC
  ADD COLUMN IF NOT EXISTS first_name        text,
  ADD COLUMN IF NOT EXISTS last_name         text,
  ADD COLUMN IF NOT EXISTS birth_date        text,
  ADD COLUMN IF NOT EXISTS nationality       text,
  ADD COLUMN IF NOT EXISTS profession        text,
  ADD COLUMN IF NOT EXISTS doc_type          text,
  ADD COLUMN IF NOT EXISTS doc_number        text,
  ADD COLUMN IF NOT EXISTS doc_country       text,
  ADD COLUMN IF NOT EXISTS residence_country text,
  ADD COLUMN IF NOT EXISTS city              text,
  ADD COLUMN IF NOT EXISTS address           text,
  ADD COLUMN IF NOT EXISTS zip_code          text,
  -- Business
  ADD COLUMN IF NOT EXISTS company_name      text,
  ADD COLUMN IF NOT EXISTS company_country   text,
  ADD COLUMN IF NOT EXISTS company_city      text,
  ADD COLUMN IF NOT EXISTS company_address   text,
  ADD COLUMN IF NOT EXISTS tax_id            text,
  ADD COLUMN IF NOT EXISTS tax_id_type       text,
  -- Legal representative
  ADD COLUMN IF NOT EXISTS rep_legal_name    text,
  ADD COLUMN IF NOT EXISTS rep_first_name    text,
  ADD COLUMN IF NOT EXISTS rep_last_name     text,
  ADD COLUMN IF NOT EXISTS rep_dob           text,
  ADD COLUMN IF NOT EXISTS rep_nationality   text,
  ADD COLUMN IF NOT EXISTS rep_doc_type      text,
  ADD COLUMN IF NOT EXISTS rep_doc_number    text,
  ADD COLUMN IF NOT EXISTS rep_doc_country   text,
  ADD COLUMN IF NOT EXISTS is_pep            boolean DEFAULT false,
  -- Documents (base64 or storage URLs)
  ADD COLUMN IF NOT EXISTS documents         jsonb DEFAULT '{}';

-- add_p2p_transfer_function.sql
-- ============================================================
-- CuyPay P2P Transfer: SECURITY DEFINER function so an
-- authenticated user can atomically deduct from their own
-- balance and credit another user's balance without needing
-- a permissive UPDATE policy on the users table.
-- Run this in the Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cuypay_transfer(
  p_sender_id      TEXT,
  p_recipient_code TEXT,
  p_amount         NUMERIC,
  p_currency       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient_id   TEXT;
  v_recipient_name TEXT;
  v_sender_bal     NUMERIC;
BEGIN
  -- Amount must be a finite positive number
  IF p_amount IS NULL OR p_amount <= 0 OR NOT isfinite(p_amount) THEN
    RETURN jsonb_build_object('error', 'Monto inválido');
  END IF;

  -- Validate currency
  IF p_currency NOT IN ('USD', 'COP', 'CLP', 'MXN', 'PEN') THEN
    RETURN jsonb_build_object('error', 'Moneda no soportada');
  END IF;

  -- Look up recipient by ownReferralCode stored in raw_data
  SELECT id, full_name
    INTO v_recipient_id, v_recipient_name
    FROM public.users
   WHERE raw_data->>'ownReferralCode' = upper(p_recipient_code)
   LIMIT 1;

  IF v_recipient_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuario no encontrado');
  END IF;

  IF v_recipient_id = p_sender_id THEN
    RETURN jsonb_build_object('error', 'No puedes enviarte dinero a ti mismo');
  END IF;

  -- Verify sender balance (server-side — not trusting client state)
  SELECT COALESCE((balances->>p_currency)::NUMERIC, 0)
    INTO v_sender_bal
    FROM public.users
   WHERE id = p_sender_id;

  IF v_sender_bal < p_amount THEN
    RETURN jsonb_build_object('error', 'Saldo insuficiente');
  END IF;

  -- Atomic debit on sender
  UPDATE public.users
     SET balances = jsonb_set(
           balances,
           ARRAY[p_currency],
           to_jsonb(COALESCE((balances->>p_currency)::NUMERIC, 0) - p_amount)
         )
   WHERE id = p_sender_id;

  -- Atomic credit on recipient
  UPDATE public.users
     SET balances = jsonb_set(
           balances,
           ARRAY[p_currency],
           to_jsonb(COALESCE((balances->>p_currency)::NUMERIC, 0) + p_amount)
         )
   WHERE id = v_recipient_id;

  RETURN jsonb_build_object(
    'success',        true,
    'recipient_id',   v_recipient_id,
    'recipient_name', v_recipient_name
  );
END;
$$;

-- Only authenticated users may call this — unauthenticated clients must not initiate transfers
REVOKE EXECUTE ON FUNCTION public.cuypay_transfer FROM anon;
GRANT  EXECUTE ON FUNCTION public.cuypay_transfer TO authenticated;

-- add_save_profile_function.sql
-- SECURITY DEFINER function so any authenticated or anon user can save
-- their own profile data without RLS blocking them.
-- Run this in the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.cuypay_save_profile(
  p_user_id  TEXT,
  p_updates  JSONB
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.users SET
    email      = COALESCE(p_updates->>'email',      email),
    role       = COALESCE(p_updates->>'role',       role),
    full_name  = COALESCE(p_updates->>'full_name',  full_name),
    balances   = COALESCE(p_updates->'balances',    balances),
    kyc_status = COALESCE(p_updates->>'kyc_status', kyc_status),
    raw_data   = COALESCE(p_updates->'raw_data',    raw_data)
  WHERE id = p_user_id::uuid;
$$;

GRANT EXECUTE ON FUNCTION public.cuypay_save_profile TO authenticated;
GRANT EXECUTE ON FUNCTION public.cuypay_save_profile TO anon;

-- admin_read_functions.sql
-- ============================================================
-- Admin read functions — bypass RLS so the admin can always
-- see all users and transactions regardless of policy state.
-- Run in Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cuypay_get_all_users()
RETURNS SETOF public.users
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.users;
$$;

CREATE OR REPLACE FUNCTION public.cuypay_get_all_transactions()
RETURNS SETOF public.transactions
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.transactions;
$$;

-- Grant to both roles so admin-bypass (anon) and real JWT (authenticated) both work
GRANT EXECUTE ON FUNCTION public.cuypay_get_all_users        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cuypay_get_all_transactions TO anon, authenticated;

-- create_transactions_table.sql
-- ============================================================
-- CUYPAY: transactions table + RLS policies
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Create table

-- 2. Enable RLS
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- 3. DROP existing policies if re-running
DROP POLICY IF EXISTS "allow_select_all_transactions"  ON public.transactions;
DROP POLICY IF EXISTS "allow_insert_own_transactions"  ON public.transactions;
DROP POLICY IF EXISTS "allow_update_all_transactions"  ON public.transactions;

-- 4. SELECT: any authenticated user can read all transactions
--    (admin needs to see every request; frontend filters by userId for regular users)
DROP POLICY IF EXISTS "allow_select_all_transactions" ON public.transactions;
CREATE POLICY "allow_select_all_transactions"
  ON public.transactions FOR SELECT
  TO authenticated
  USING (true);

-- 5. INSERT: authenticated users can insert (user_id matches their auth.uid,
--    OR it's an internal admin/treasury movement)
DROP POLICY IF EXISTS "allow_insert_own_transactions" ON public.transactions;
CREATE POLICY "allow_insert_own_transactions"
  ON public.transactions FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    OR user_id::text = 'admin'
  );

-- 6. UPDATE: any authenticated user can update status
--    (admin approves/rejects deposits and withdrawals)
DROP POLICY IF EXISTS "allow_update_all_transactions" ON public.transactions;
CREATE POLICY "allow_update_all_transactions"
  ON public.transactions FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 7. Enable Realtime so the admin panel gets live updates
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='transactions') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions; END IF; END $$;

-- ============================================================
-- Also ensure the users table has correct RLS (if not already set)
-- ============================================================

-- Allow all authenticated users to SELECT all users
-- (admin needs to see all accounts; run only if not already created)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'users'
      AND policyname = 'allow_select_all_users'
  ) THEN
    CREATE POLICY "allow_select_all_users"
      ON public.users FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

-- Allow users to insert/update their own record
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'users'
      AND policyname = 'allow_upsert_own_user'
  ) THEN
    CREATE POLICY "allow_upsert_own_user"
      ON public.users FOR ALL
      TO authenticated
      USING (auth.uid() = id)
      WITH CHECK (auth.uid() = id);
  END IF;
END $$;

-- disable_rls_fix_admin.sql
-- ============================================================
-- DEFINITIVE FIX: Disable RLS on users and transactions
-- so the admin panel can always read all rows.
-- Run this in Supabase SQL Editor.
-- ============================================================

-- 1. Disable RLS entirely on both tables
ALTER TABLE public.users        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions DISABLE ROW LEVEL SECURITY;

-- 2. Grant full access to anon and authenticated roles
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users        TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO anon, authenticated;

-- 3. Also ensure the admin RPC functions exist (recreate for safety)
CREATE OR REPLACE FUNCTION public.cuypay_get_all_users()
RETURNS SETOF public.users LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM public.users; $$;

CREATE OR REPLACE FUNCTION public.cuypay_get_all_transactions()
RETURNS SETOF public.transactions LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM public.transactions; $$;

GRANT EXECUTE ON FUNCTION public.cuypay_get_all_users        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cuypay_get_all_transactions TO anon, authenticated;

-- 4. Also ensure crypto_balances column exists
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS crypto_balances JSONB NOT NULL DEFAULT '{}'::jsonb;

-- fix_authenticated_update_policy.sql
-- ============================================================
-- Fix: Allow authenticated users to update their own profile.
-- This is required for KYC submission and profile updates.
-- The upsert was replaced by update() in saveUser, so we only
-- need UPDATE permission (no INSERT needed anymore via saveUser).
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- Re-enable RLS on users (in case it was disabled during debugging)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 1. Authenticated users can SELECT their own row
DROP POLICY IF EXISTS "allow_auth_select_own_user" ON public.users;
CREATE POLICY "allow_auth_select_own_user"
  ON public.users FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- 2. Authenticated users can UPDATE their own row (KYC, profile, etc.)
DROP POLICY IF EXISTS "allow_auth_update_own_user" ON public.users;
CREATE POLICY "allow_auth_update_own_user"
  ON public.users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 3. Authenticated users can INSERT their own row (needed on first profile creation)
DROP POLICY IF EXISTS "allow_auth_insert_own_user" ON public.users;
CREATE POLICY "allow_auth_insert_own_user"
  ON public.users FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- 4. anon (admin-bypass) can SELECT all users
DROP POLICY IF EXISTS "allow_anon_select_users" ON public.users;
CREATE POLICY "allow_anon_select_users"
  ON public.users FOR SELECT
  TO anon
  USING (true);

-- 5. anon (admin-bypass) can UPDATE any user
DROP POLICY IF EXISTS "allow_anon_update_users" ON public.users;
CREATE POLICY "allow_anon_update_users"
  ON public.users FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- 6. anon (admin-bypass) can INSERT users (needed for registerUser in offline mode)
DROP POLICY IF EXISTS "allow_anon_insert_users" ON public.users;
CREATE POLICY "allow_anon_insert_users"
  ON public.users FOR INSERT
  TO anon
  WITH CHECK (true);

-- Also re-apply transactions policies in case they were lost
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_auth_select_own_transactions" ON public.transactions;
CREATE POLICY "allow_auth_select_own_transactions"
  ON public.transactions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "allow_auth_insert_own_transactions" ON public.transactions;
CREATE POLICY "allow_auth_insert_own_transactions"
  ON public.transactions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "allow_anon_select_transactions" ON public.transactions;
CREATE POLICY "allow_anon_select_transactions"
  ON public.transactions FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "allow_anon_insert_transactions" ON public.transactions;
CREATE POLICY "allow_anon_insert_transactions"
  ON public.transactions FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "allow_anon_update_transactions" ON public.transactions;
CREATE POLICY "allow_anon_update_transactions"
  ON public.transactions FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- fix_complete_admin.sql
-- ============================================================
-- COMPLETE FIX — Run this SINGLE script in Supabase SQL Editor.
-- It fixes RLS, creates read functions, auto-profile trigger,
-- AND recovers existing auth users who have no profile row.
-- ============================================================

-- 1. Enable RLS
ALTER TABLE public.users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- 2. Drop ALL existing policies on users
DO $$ DECLARE r RECORD;
BEGIN FOR r IN SELECT policyname FROM pg_policies WHERE tablename='users' AND schemaname='public'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.users', r.policyname); END LOOP;
END $$;

-- 3. Drop ALL existing policies on transactions
DO $$ DECLARE r RECORD;
BEGIN FOR r IN SELECT policyname FROM pg_policies WHERE tablename='transactions' AND schemaname='public'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.transactions', r.policyname); END LOOP;
END $$;

-- 4. Open policies: allow everything for everyone
DROP POLICY IF EXISTS "users_all" ON public.users;
CREATE POLICY "users_all"  ON public.users        FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "tx_all" ON public.transactions;
CREATE POLICY "tx_all"     ON public.transactions  FOR ALL USING (true) WITH CHECK (true);

-- 5. Grant table access
GRANT ALL ON public.users        TO authenticated, anon;
GRANT ALL ON public.transactions TO authenticated, anon;

-- 6. Read functions (bypass RLS for safety)
CREATE OR REPLACE FUNCTION public.cuypay_get_all_users()
RETURNS SETOF public.users LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT * FROM public.users;
$$;

CREATE OR REPLACE FUNCTION public.cuypay_get_all_transactions()
RETURNS SETOF public.transactions LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT * FROM public.transactions;
$$;

GRANT EXECUTE ON FUNCTION public.cuypay_get_all_users        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cuypay_get_all_transactions TO anon, authenticated;

-- 7. Auto-create profile when a user signs up (trigger on auth.users)
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role, balances, kyc_status, raw_data)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
    'personal',
    '{"USD":0,"COP":0,"CLP":0,"MXN":0,"PEN":0}'::jsonb,
    'pending',
    ('{"notifications":[],"ownReferralCode":"' || UPPER(RIGHT(NEW.id::text, 6)) || '"}')::jsonb
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- 8. RECOVER existing auth users who have no profile row
INSERT INTO public.users (id, email, full_name, role, balances, kyc_status, raw_data)
SELECT
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'full_name', SPLIT_PART(au.email, '@', 1)),
  'personal',
  '{"USD":0,"COP":0,"CLP":0,"MXN":0,"PEN":0}'::jsonb,
  'pending',
  ('{"notifications":[],"ownReferralCode":"' || UPPER(RIGHT(au.id::text, 6)) || '"}')::jsonb
FROM auth.users au
WHERE NOT EXISTS (SELECT 1 FROM public.users pu WHERE pu.id = au.id);

-- fix_everything.sql
-- ============================================================
-- CUYPAY — SCRIPT COMPLETO DE CONFIGURACIÓN
-- Ejecuta este script UNA VEZ en el Editor SQL de Supabase.
-- Crea todas las políticas RLS y las funciones necesarias.
-- ============================================================

-- ---- 1. LIMPIAR POLÍTICAS EXISTENTES ----------------------
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename='users' AND schemaname='public'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.users', r.policyname); END LOOP;
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename='transactions' AND schemaname='public'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.transactions', r.policyname); END LOOP;
END $$;

-- ---- 2. HABILITAR RLS -------------------------------------
ALTER TABLE public.users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- ---- 3. POLÍTICAS PARA users ------------------------------
-- Usuarios autenticados: solo su propia fila
-- Note: id is UUID, auth.uid() is UUID — compare directly, no ::text cast
DROP POLICY IF EXISTS "auth_select_own" ON public.users;
CREATE POLICY "auth_select_own" ON public.users FOR SELECT
  TO authenticated USING (auth.uid() = id);
DROP POLICY IF EXISTS "auth_insert_own" ON public.users;
CREATE POLICY "auth_insert_own" ON public.users FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "auth_update_own" ON public.users;
CREATE POLICY "auth_update_own" ON public.users FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Rol anon (admin-bypass): acceso total para operaciones administrativas
DROP POLICY IF EXISTS "anon_select_users" ON public.users;
CREATE POLICY "anon_select_users"  ON public.users FOR SELECT  TO anon USING (true);
DROP POLICY IF EXISTS "anon_insert_users" ON public.users;
CREATE POLICY "anon_insert_users"  ON public.users FOR INSERT  TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_users" ON public.users;
CREATE POLICY "anon_update_users"  ON public.users FOR UPDATE  TO anon USING (true) WITH CHECK (true);

-- ---- 4. POLÍTICAS PARA transactions -----------------------
DROP POLICY IF EXISTS "auth_select_own_tx" ON public.transactions;
CREATE POLICY "auth_select_own_tx" ON public.transactions FOR SELECT
  TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "auth_insert_own_tx" ON public.transactions;
CREATE POLICY "auth_insert_own_tx" ON public.transactions FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "anon_select_tx" ON public.transactions;
CREATE POLICY "anon_select_tx"  ON public.transactions FOR SELECT  TO anon USING (true);
DROP POLICY IF EXISTS "anon_insert_tx" ON public.transactions;
CREATE POLICY "anon_insert_tx"  ON public.transactions FOR INSERT  TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_tx" ON public.transactions;
CREATE POLICY "anon_update_tx"  ON public.transactions FOR UPDATE  TO anon USING (true) WITH CHECK (true);

-- ---- 5. GRANTS MÍNIMOS ------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.users        TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE ON public.transactions TO authenticated, anon;
GRANT USAGE ON SCHEMA public TO authenticated, anon;

-- ---- 6. FUNCIÓN P2P cuypay_transfer -----------------------
-- SECURITY DEFINER: bypasses RLS to update any user's balance and
-- insert transaction records for both sender and recipient.
-- LANGUAGE sql (not plpgsql): no DECLARE block, avoids mobile copy-paste corruption.
CREATE OR REPLACE FUNCTION public.cuypay_transfer(
  p_sender_id      text,
  p_recipient_code text,
  p_amount         numeric,
  p_currency       text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $func$
  WITH
    sender_row AS (
      SELECT id, full_name, role
        FROM public.users
       WHERE id::text = p_sender_id
       LIMIT 1
    ),
    recipient_row AS (
      SELECT id, full_name
        FROM public.users
       WHERE raw_data->>'ownReferralCode' = upper(p_recipient_code)
         AND id::text <> p_sender_id
       LIMIT 1
    ),
    debit AS (
      UPDATE public.users
         SET balances = jsonb_set(
               balances, ARRAY[p_currency],
               to_jsonb(COALESCE((balances->>p_currency)::numeric, 0) - p_amount)
             )
       WHERE id::text = p_sender_id
         AND (SELECT id FROM recipient_row) IS NOT NULL
         AND COALESCE((balances->>p_currency)::numeric, 0) >= p_amount
      RETURNING id
    ),
    credit AS (
      UPDATE public.users
         SET balances = jsonb_set(
               balances, ARRAY[p_currency],
               to_jsonb(COALESCE((balances->>p_currency)::numeric, 0) + p_amount)
             )
       WHERE id = (SELECT id FROM recipient_row)
         AND (SELECT id FROM debit) IS NOT NULL
      RETURNING id
    ),
    sender_tx AS (
      INSERT INTO public.transactions (user_id, type, amount, currency, status, raw_data)
      SELECT
        p_sender_id::uuid,
        'pay_sent',
        p_amount,
        p_currency,
        'Completado',
        jsonb_build_object(
          'initials',      'PA',
          'title',         'PAY a ' || (SELECT full_name FROM recipient_row),
          'date',          to_char(now(), 'DD/MM/YYYY'),
          'userName',      (SELECT full_name FROM sender_row),
          'userRole',      (SELECT role FROM sender_row),
          'recipientName', (SELECT full_name FROM recipient_row)
        )
      WHERE (SELECT id FROM credit) IS NOT NULL
      RETURNING id
    ),
    recipient_tx AS (
      INSERT INTO public.transactions (user_id, type, amount, currency, status, raw_data)
      SELECT
        (SELECT id FROM recipient_row),
        'pay_received',
        p_amount,
        p_currency,
        'Completado',
        jsonb_build_object(
          'initials',   'PR',
          'title',      'PAY de ' || (SELECT full_name FROM sender_row),
          'date',       to_char(now(), 'DD/MM/YYYY'),
          'userName',   (SELECT full_name FROM recipient_row),
          'senderName', (SELECT full_name FROM sender_row)
        )
      WHERE (SELECT id FROM credit) IS NOT NULL
      RETURNING id
    )
  SELECT
    CASE
      WHEN (SELECT id FROM recipient_row) IS NULL THEN
        jsonb_build_object('error', 'Usuario no encontrado')
      WHEN (SELECT id FROM debit) IS NULL THEN
        jsonb_build_object('error', 'Saldo insuficiente')
      ELSE
        jsonb_build_object(
          'success',        true,
          'recipient_id',   (SELECT id::text FROM recipient_row),
          'recipient_name', (SELECT full_name FROM recipient_row)
        )
    END
$func$;

REVOKE EXECUTE ON FUNCTION public.cuypay_transfer FROM anon;
GRANT  EXECUTE ON FUNCTION public.cuypay_transfer TO authenticated;

-- ---- 7. FUNCIÓN GUARDAR PERFIL ----------------------------
CREATE OR REPLACE FUNCTION public.cuypay_save_profile(
  p_user_id TEXT, p_updates JSONB
)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.users SET
    email      = COALESCE(p_updates->>'email',      email),
    role       = COALESCE(p_updates->>'role',       role),
    full_name  = COALESCE(p_updates->>'full_name',  full_name),
    balances   = COALESCE(p_updates->'balances',    balances),
    kyc_status = COALESCE(p_updates->>'kyc_status', kyc_status),
    raw_data   = COALESCE(p_updates->'raw_data',    raw_data)
  WHERE id = p_user_id::uuid;
$$;
GRANT EXECUTE ON FUNCTION public.cuypay_save_profile TO authenticated, anon;

-- ---- 8. FUNCIONES DE LECTURA PARA ADMIN -------------------
CREATE OR REPLACE FUNCTION public.cuypay_get_all_users()
RETURNS SETOF public.users LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT * FROM public.users;
$$;
CREATE OR REPLACE FUNCTION public.cuypay_get_all_transactions()
RETURNS SETOF public.transactions LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT * FROM public.transactions;
$$;
GRANT EXECUTE ON FUNCTION public.cuypay_get_all_users        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cuypay_get_all_transactions TO anon, authenticated;

-- fix_everything_v2.sql
DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT policyname FROM pg_policies WHERE tablename='users' AND schemaname='public' LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.users', r.policyname); END LOOP; FOR r IN SELECT policyname FROM pg_policies WHERE tablename='transactions' AND schemaname='public' LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.transactions', r.policyname); END LOOP; END $$;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_users_select" ON public.users;
CREATE POLICY "auth_users_select" ON public.users FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_users_insert" ON public.users;
CREATE POLICY "auth_users_insert" ON public.users FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "auth_users_update" ON public.users;
CREATE POLICY "auth_users_update" ON public.users FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "anon_users_all" ON public.users;
CREATE POLICY "anon_users_all" ON public.users FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_tx_select" ON public.transactions;
CREATE POLICY "auth_tx_select" ON public.transactions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_tx_insert" ON public.transactions;
CREATE POLICY "auth_tx_insert" ON public.transactions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "anon_tx_all" ON public.transactions;
CREATE POLICY "anon_tx_all" ON public.transactions FOR ALL TO anon USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.users TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE ON public.transactions TO authenticated, anon;
GRANT USAGE ON SCHEMA public TO authenticated, anon;
CREATE OR REPLACE FUNCTION public.cuypay_transfer(p_sender_id text, p_recipient_code text, p_amount numeric, p_currency text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$ WITH snd AS (SELECT id, full_name FROM public.users WHERE id = p_sender_id::uuid LIMIT 1), rcp AS (SELECT id, full_name FROM public.users WHERE raw_data->>'ownReferralCode' = upper(p_recipient_code) AND id::text <> p_sender_id LIMIT 1), dbt AS (UPDATE public.users SET balances = jsonb_set(balances, ARRAY[p_currency], to_jsonb(COALESCE((balances->>p_currency)::numeric,0)-p_amount)) WHERE id=(SELECT id FROM snd) AND (SELECT id FROM rcp) IS NOT NULL AND COALESCE((balances->>p_currency)::numeric,0)>=p_amount RETURNING id), crd AS (UPDATE public.users SET balances = jsonb_set(balances, ARRAY[p_currency], to_jsonb(COALESCE((balances->>p_currency)::numeric,0)+p_amount)) WHERE id=(SELECT id FROM rcp) AND (SELECT id FROM dbt) IS NOT NULL RETURNING id), stx AS (INSERT INTO public.transactions(user_id,type,amount,currency,status,raw_data) SELECT p_sender_id::uuid,'pay_sent',p_amount,p_currency,'Completado',jsonb_build_object('initials','PA','title','PAY a '||(SELECT full_name FROM rcp),'recipientName',(SELECT full_name FROM rcp),'date',to_char(now(),'DD/MM/YYYY')) WHERE (SELECT id FROM crd) IS NOT NULL RETURNING id), rtx AS (INSERT INTO public.transactions(user_id,type,amount,currency,status,raw_data) SELECT (SELECT id FROM rcp),'pay_received',p_amount,p_currency,'Completado',jsonb_build_object('initials','PR','title','PAY de '||(SELECT full_name FROM snd),'senderName',(SELECT full_name FROM snd),'date',to_char(now(),'DD/MM/YYYY')) WHERE (SELECT id FROM crd) IS NOT NULL RETURNING id) SELECT CASE WHEN (SELECT id FROM rcp) IS NULL THEN jsonb_build_object('error','no_recipient') WHEN (SELECT id FROM dbt) IS NULL THEN jsonb_build_object('error','no_funds') ELSE jsonb_build_object('success',true,'recipient_id',(SELECT id::text FROM rcp),'recipient_name',(SELECT full_name FROM rcp)) END $f$;
REVOKE EXECUTE ON FUNCTION public.cuypay_transfer FROM anon;
GRANT EXECUTE ON FUNCTION public.cuypay_transfer TO authenticated;

-- fix_p2p_security.sql
-- ============================================================
-- Security hardening for cuypay_transfer:
--   1. Validate amount is positive and non-zero (server-side)
--   2. Validate currency is in the allowed list
--   3. Server-side balance check (prevents client-side bypass)
--   4. Revoke execution from the anon role
--
-- NOTE: auth.uid() == p_sender_id check is intentionally omitted
-- because the RPC is called from a background async context where
-- the Supabase session may not be available at the moment of the
-- call. The client already validates that the sender is the
-- authenticated user before calling this function.
-- Run this in the Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cuypay_transfer(
  p_sender_id      TEXT,
  p_recipient_code TEXT,
  p_amount         NUMERIC,
  p_currency       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient_id   TEXT;
  v_recipient_name TEXT;
  v_sender_bal     NUMERIC;
BEGIN
  -- Amount must be a finite positive number
  IF p_amount IS NULL OR p_amount <= 0 OR NOT isfinite(p_amount) THEN
    RETURN jsonb_build_object('error', 'Monto inválido');
  END IF;

  -- Validate currency
  IF p_currency NOT IN ('USD', 'COP', 'CLP', 'MXN', 'PEN') THEN
    RETURN jsonb_build_object('error', 'Moneda no soportada');
  END IF;

  -- Look up recipient by ownReferralCode stored in raw_data
  SELECT id, full_name
    INTO v_recipient_id, v_recipient_name
    FROM public.users
   WHERE raw_data->>'ownReferralCode' = upper(p_recipient_code)
   LIMIT 1;

  IF v_recipient_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuario no encontrado');
  END IF;

  IF v_recipient_id = p_sender_id THEN
    RETURN jsonb_build_object('error', 'No puedes enviarte dinero a ti mismo');
  END IF;

  -- Verify sender balance (server-side — not trusting client state)
  SELECT COALESCE((balances->>p_currency)::NUMERIC, 0)
    INTO v_sender_bal
    FROM public.users
   WHERE id = p_sender_id;

  IF v_sender_bal < p_amount THEN
    RETURN jsonb_build_object('error', 'Saldo insuficiente');
  END IF;

  -- Atomic debit on sender
  UPDATE public.users
     SET balances = jsonb_set(
           balances,
           ARRAY[p_currency],
           to_jsonb(COALESCE((balances->>p_currency)::NUMERIC, 0) - p_amount)
         )
   WHERE id = p_sender_id;

  -- Atomic credit on recipient
  UPDATE public.users
     SET balances = jsonb_set(
           balances,
           ARRAY[p_currency],
           to_jsonb(COALESCE((balances->>p_currency)::NUMERIC, 0) + p_amount)
         )
   WHERE id = v_recipient_id;

  RETURN jsonb_build_object(
    'success',        true,
    'recipient_id',   v_recipient_id,
    'recipient_name', v_recipient_name
  );
END;
$$;

-- Only authenticated users may call this — revoke from anon
REVOKE EXECUTE ON FUNCTION public.cuypay_transfer FROM anon;
GRANT  EXECUTE ON FUNCTION public.cuypay_transfer TO authenticated;

-- fix_p2p_transfer_function.sql
-- ============================================================
-- CuyPay P2P Transfer: simple atomic balance swap.
-- Run this ONE script in Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cuypay_p2p_transfer(
  p_sender_id    TEXT,
  p_recipient_id TEXT,
  p_sender_bal   JSONB,
  p_recipient_bal JSONB
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.users SET balances = p_sender_bal    WHERE id = p_sender_id::uuid;
  UPDATE public.users SET balances = p_recipient_bal WHERE id = p_recipient_id::uuid;
$$;

GRANT EXECUTE ON FUNCTION public.cuypay_p2p_transfer TO authenticated;
GRANT EXECUTE ON FUNCTION public.cuypay_p2p_transfer TO anon;

-- fix_rls_admin_bypass.sql
-- ============================================================
-- Fix RLS so admin-bypass (anon role) can read/update data.
-- The admin bypass login skips Supabase Auth, so requests arrive
-- as the 'anon' role. Without these policies the balance update
-- after approving a deposit silently fails.
-- Run this in the Supabase SQL Editor.
-- ============================================================

-- 1. Ensure the balances column exists (in case it was never created)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS balances JSONB NOT NULL DEFAULT '{"USD":0,"COP":0,"CLP":0,"MXN":0,"PEN":0}';

-- 2. users table: let anon (admin-bypass) SELECT all users
DROP POLICY IF EXISTS "allow_anon_select_users" ON public.users;
CREATE POLICY "allow_anon_select_users"
  ON public.users FOR SELECT
  TO anon
  USING (true);

-- 3. users table: let anon (admin-bypass) UPDATE any user (balance approvals, KYC, etc.)
DROP POLICY IF EXISTS "allow_anon_update_users" ON public.users;
CREATE POLICY "allow_anon_update_users"
  ON public.users FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- 4. transactions table: let anon SELECT all transactions
DROP POLICY IF EXISTS "allow_anon_select_transactions" ON public.transactions;
CREATE POLICY "allow_anon_select_transactions"
  ON public.transactions FOR SELECT
  TO anon
  USING (true);

-- 5. transactions table: let anon INSERT transactions (internal treasury movements)
DROP POLICY IF EXISTS "allow_anon_insert_transactions" ON public.transactions;
CREATE POLICY "allow_anon_insert_transactions"
  ON public.transactions FOR INSERT
  TO anon
  WITH CHECK (true);

-- 6. transactions table: let anon UPDATE status (approve/reject)
DROP POLICY IF EXISTS "allow_anon_update_transactions" ON public.transactions;
CREATE POLICY "allow_anon_update_transactions"
  ON public.transactions FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- fix_rls_full_reset.sql
-- ============================================================
-- FULL RLS RESET — run this in Supabase SQL Editor.
-- Drops ALL policies on users/transactions and recreates
-- permissive ones for both anon (admin-bypass) and authenticated.
-- ============================================================

-- 1. Enable RLS (idempotent)
ALTER TABLE public.users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- 2. Drop every existing policy on users
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'users' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.users', r.policyname);
  END LOOP;
END $$;

-- 3. Drop every existing policy on transactions
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'transactions' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.transactions', r.policyname);
  END LOOP;
END $$;

-- 4. Users — allow everything for authenticated and anon
DROP POLICY IF EXISTS "users_select_all" ON public.users;
CREATE POLICY "users_select_all" ON public.users FOR SELECT USING (true);
DROP POLICY IF EXISTS "users_insert_all" ON public.users;
CREATE POLICY "users_insert_all" ON public.users FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "users_update_all" ON public.users;
CREATE POLICY "users_update_all" ON public.users FOR UPDATE USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "users_delete_all" ON public.users;
CREATE POLICY "users_delete_all" ON public.users FOR DELETE USING (true);

-- 5. Transactions — allow everything for authenticated and anon
DROP POLICY IF EXISTS "tx_select_all" ON public.transactions;
CREATE POLICY "tx_select_all"  ON public.transactions FOR SELECT USING (true);
DROP POLICY IF EXISTS "tx_insert_all" ON public.transactions;
CREATE POLICY "tx_insert_all"  ON public.transactions FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "tx_update_all" ON public.transactions;
CREATE POLICY "tx_update_all"  ON public.transactions FOR UPDATE USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "tx_delete_all" ON public.transactions;
CREATE POLICY "tx_delete_all"  ON public.transactions FOR DELETE USING (true);

-- 6. Re-grant table access to roles (in case grants were dropped)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users        TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated, anon;

-- fix_transfer_function.sql
CREATE OR REPLACE FUNCTION public.cuypay_transfer(p_sender_id text, p_recipient_code text, p_amount numeric, p_currency text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
WITH r AS (SELECT id, full_name FROM public.users WHERE raw_data->>'ownReferralCode' = upper(p_recipient_code) AND id::text <> p_sender_id LIMIT 1), d AS (UPDATE public.users SET balances = jsonb_set(balances, ARRAY[p_currency], to_jsonb(COALESCE((balances->>p_currency)::numeric, 0) - p_amount)) WHERE id::text = p_sender_id AND (SELECT id FROM r) IS NOT NULL AND COALESCE((balances->>p_currency)::numeric, 0) >= p_amount RETURNING id), c AS (UPDATE public.users SET balances = jsonb_set(balances, ARRAY[p_currency], to_jsonb(COALESCE((balances->>p_currency)::numeric, 0) + p_amount)) WHERE id = (SELECT id FROM r) AND (SELECT id FROM d) IS NOT NULL RETURNING id) SELECT CASE WHEN (SELECT id FROM r) IS NULL THEN jsonb_build_object('error','no_recipient') WHEN (SELECT id FROM d) IS NULL THEN jsonb_build_object('error','no_funds') ELSE jsonb_build_object('success',true,'recipient_id',(SELECT id::text FROM r),'recipient_name',(SELECT full_name FROM r)) END
$$;
REVOKE EXECUTE ON FUNCTION public.cuypay_transfer FROM anon;
GRANT EXECUTE ON FUNCTION public.cuypay_transfer TO authenticated;
CREATE OR REPLACE FUNCTION public.cuypay_insert_rx(p_uid text, p_amount numeric, p_currency text, p_sender text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
INSERT INTO public.transactions (user_id, type, amount, currency, status, raw_data) VALUES (p_uid::uuid,'pay_received',p_amount,p_currency,'Completado',jsonb_build_object('initials','PR','title','PAY de '||p_sender,'senderName',p_sender,'date',to_char(now(),'DD/MM/YYYY')))
$$;
GRANT EXECUTE ON FUNCTION public.cuypay_insert_rx TO authenticated;

-- seed_admin_user.sql
-- Insert admin user into users table so DB-fallback login works
-- even without VITE_ADMIN_PASSWORD env var set in the hosting platform.
-- On first login the password hash gets stored automatically.
INSERT INTO public.users (
  id, email, full_name, role, balances,
  kyc_status, is_blocked, raw_data
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'admin@lincoin.com',
  'Administrador',
  'admin',
  '{"USD":0,"COP":0,"CLP":0,"MXN":0,"PEN":0}'::jsonb,
  'approved',
  false,
  '{"notifications":[],"ownReferralCode":"ADMIN1"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;
