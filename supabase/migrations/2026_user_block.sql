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
