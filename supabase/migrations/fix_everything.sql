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
CREATE POLICY "auth_select_own" ON public.users FOR SELECT
  TO authenticated USING (auth.uid() = id);
CREATE POLICY "auth_insert_own" ON public.users FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "auth_update_own" ON public.users FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Rol anon (admin-bypass): acceso total para operaciones administrativas
CREATE POLICY "anon_select_users"  ON public.users FOR SELECT  TO anon USING (true);
CREATE POLICY "anon_insert_users"  ON public.users FOR INSERT  TO anon WITH CHECK (true);
CREATE POLICY "anon_update_users"  ON public.users FOR UPDATE  TO anon USING (true) WITH CHECK (true);

-- ---- 4. POLÍTICAS PARA transactions -----------------------
CREATE POLICY "auth_select_own_tx" ON public.transactions FOR SELECT
  TO authenticated USING (user_id = auth.uid()::text);
CREATE POLICY "auth_insert_own_tx" ON public.transactions FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "anon_select_tx"  ON public.transactions FOR SELECT  TO anon USING (true);
CREATE POLICY "anon_insert_tx"  ON public.transactions FOR INSERT  TO anon WITH CHECK (true);
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
        p_sender_id,
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
        (SELECT id::text FROM recipient_row),
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
