-- Insert admin user into users table so DB-fallback login works
-- even without VITE_ADMIN_PASSWORD env var set in the hosting platform.
-- On first login the password hash gets stored automatically.
INSERT INTO public.users (
  id, email, full_name, role, balances,
  kyc_status, is_blocked, raw_data
)
VALUES (
  'admin-cuypay-001',
  'admin@cuypay.com',
  'Administrador',
  'admin',
  '{"USD":0,"COP":0,"CLP":0,"MXN":0,"PEN":0}'::jsonb,
  'approved',
  false,
  '{"notifications":[],"ownReferralCode":"ADMIN1"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;
