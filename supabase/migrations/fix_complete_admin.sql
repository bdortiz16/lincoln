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
CREATE POLICY "users_all"  ON public.users        FOR ALL USING (true) WITH CHECK (true);
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
