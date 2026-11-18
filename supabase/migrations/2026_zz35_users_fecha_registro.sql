-- 2026_zz35 · Fecha de registro de cada cliente (users.created_at)
--
-- 18 nov: en Admin → Clientes la ficha decía "Cliente desde —". La pantalla
-- no copiaba la columna (eso se arregló en el navegador), y además la
-- columna NO tenía valor por defecto: handle_new_user inserta sin
-- created_at, así que las cuentas nacidas por el registro podían quedar con
-- la fecha vacía. Se le pone now() por defecto y las que quedaron vacías se
-- llenan con la fecha en que se creó la cuenta de acceso (auth.users), que
-- es la fecha real de registro.
--
-- Idempotente: se puede pegar en el SQL Editor las veces que haga falta.

ALTER TABLE public.users ALTER COLUMN created_at SET DEFAULT now();

UPDATE public.users u
SET created_at = a.created_at
FROM auth.users a
WHERE a.id = u.id
  AND u.created_at IS NULL;
