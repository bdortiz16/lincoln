-- ============================================================
-- CUYPAY: transactions table + RLS policies
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Create table
CREATE TABLE IF NOT EXISTS public.transactions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT        NOT NULL,
  type        TEXT        NOT NULL,
  amount      NUMERIC     NOT NULL DEFAULT 0,
  currency    TEXT        NOT NULL DEFAULT 'USD',
  status      TEXT        NOT NULL DEFAULT 'Pendiente',
  raw_data    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Enable RLS
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- 3. DROP existing policies if re-running
DROP POLICY IF EXISTS "allow_select_all_transactions"  ON public.transactions;
DROP POLICY IF EXISTS "allow_insert_own_transactions"  ON public.transactions;
DROP POLICY IF EXISTS "allow_update_all_transactions"  ON public.transactions;

-- 4. SELECT: any authenticated user can read all transactions
--    (admin needs to see every request; frontend filters by userId for regular users)
CREATE POLICY "allow_select_all_transactions"
  ON public.transactions FOR SELECT
  TO authenticated
  USING (true);

-- 5. INSERT: authenticated users can insert (user_id matches their auth.uid,
--    OR it's an internal admin/treasury movement)
CREATE POLICY "allow_insert_own_transactions"
  ON public.transactions FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid()::text = user_id
    OR user_id = 'admin'
  );

-- 6. UPDATE: any authenticated user can update status
--    (admin approves/rejects deposits and withdrawals)
CREATE POLICY "allow_update_all_transactions"
  ON public.transactions FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 7. Enable Realtime so the admin panel gets live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;

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
      USING (auth.uid()::text = id)
      WITH CHECK (auth.uid()::text = id);
  END IF;
END $$;
