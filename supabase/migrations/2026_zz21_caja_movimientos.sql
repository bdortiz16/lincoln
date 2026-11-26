-- ════════════════════════════════════════════════════════
--  Movimientos de Lincoin en las bolsas (retiros, externos, aportes).
--
--  En Mouv y Finity se mueve plata por fuera de Lincoin y Lincoin retira su
--  utilidad. Sin registrarlo, el cierre de caja solo puede decir "diferencia
--  sin explicar". Cada movimiento ajusta el Lincoin esperado de su bolsa:
--    retiro  (−)  Lincoin saca su utilidad
--    egreso  (−)  salió plata de la bolsa por fuera de Lincoin
--    ingreso (+)  entró plata a la bolsa por fuera de Lincoin
--    aporte  (+)  Lincoin pone plata en la bolsa
--  No se borran: se anulan (queda quién, cuándo y por qué).
--  Solo el backend (admin-data, service_role) lee y escribe.
-- ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.caja_movimientos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha           date NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('retiro', 'egreso', 'ingreso', 'aporte')),
  proveedor       text NOT NULL CHECK (proveedor IN ('Mouv', 'Finity')),
  monto           numeric NOT NULL CHECK (monto > 0),
  descripcion     text NOT NULL,
  soporte_nombre  text,
  soporte         text,                  -- comprobante (data URL), opcional
  por             jsonb NOT NULL,        -- { id, email, nombre, rol }
  creado_at       timestamptz NOT NULL DEFAULT now(),
  anulado         jsonb                  -- { motivo, por, at } si se anuló
);

CREATE INDEX IF NOT EXISTS caja_movimientos_fecha_idx ON public.caja_movimientos (fecha);

ALTER TABLE public.caja_movimientos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.caja_movimientos FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.caja_movimientos TO service_role;

-- Un movimiento no se borra: se anula.
CREATE OR REPLACE FUNCTION public.caja_movimientos_sin_borrar()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los movimientos de Lincoin no se borran: se anulan.';
END $$;
DROP TRIGGER IF EXISTS caja_movimientos_sin_borrar ON public.caja_movimientos;
CREATE TRIGGER caja_movimientos_sin_borrar BEFORE DELETE ON public.caja_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.caja_movimientos_sin_borrar();
