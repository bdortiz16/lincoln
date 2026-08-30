-- ============================================================
-- Promover la cuenta de admin a role='admin' (login seguro con JWT).
--
-- PASOS:
--   1. En Supabase → Authentication → Users → "Add user":
--        Email:    admin@lincoin.com   (o tu ADMIN_EMAIL)
--        Password: (una fuerte, NUEVA — NO 'lincoin1234')
--        Marca "Auto Confirm User".
--   2. Corre este script en el SQL Editor (ajusta el correo si es otro).
--   3. Entra a la app con ese correo y contraseña: ahora el admin usa una
--      sesión REAL de Supabase (JWT), no la contraseña incrustada en el
--      navegador. El AdminBypass viejo sigue como respaldo hasta la Fase 2.
--
-- Idempotente: se puede correr varias veces sin problema.
-- ============================================================

-- (a) Si ya existe la fila en public.users para ese auth user, marcarla admin.
UPDATE public.users u
   SET role = 'admin'
  FROM auth.users a
 WHERE a.id::text = u.id
   AND lower(a.email) = lower('admin@lincoin.com');

-- (b) Si NO existía la fila, crearla como admin.
INSERT INTO public.users (id, email, role, full_name, kyc_status)
SELECT a.id::text, a.email, 'admin', 'Administrador', 'approved'
  FROM auth.users a
 WHERE lower(a.email) = lower('admin@lincoin.com')
   AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = a.id::text);

-- Verificación: debe devolver una fila con role='admin'.
SELECT u.id, u.email, u.role
  FROM public.users u
  JOIN auth.users a ON a.id::text = u.id
 WHERE lower(a.email) = lower('admin@lincoin.com');
