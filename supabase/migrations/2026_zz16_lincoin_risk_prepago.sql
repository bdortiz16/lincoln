-- ════════════════════════════════════════════════════════════════════
-- Lincoin Risk prepago — idempotente, no toca datos existentes.
--
-- Lincoin compra consultas a Sarblock (la CAJA, risk_caja) y se las vende a
-- las empresas por paquetes. Cada empresa tiene su bolsillo de consultas
-- (risk_saldos) y cada consulta manual descuenta 1, salga de Sarblock o del
-- padrón. La AML de beneficiarios NO descuenta de aquí.
--
-- El historial no se borra: consultas, búsquedas, compras y movimientos no
-- aceptan DELETE (y los tres últimos tampoco UPDATE). Un ajuste del admin es
-- un movimiento más, con su motivo.
--
-- Saldo y compra van en funciones con bloqueo de fila: dos consultas al
-- mismo tiempo con saldo 1 no pueden gastar 2, y la compra debita los pesos
-- (adjust_balances) y acredita las consultas en la MISMA transacción.
--
-- Precio, mínimo, IVA, medios de pago, vigencia y avisos viven en
-- system_config (clave risk_venta_config), los edita el admin.
--
-- Deny-all: solo el service_role (la función sarblock) toca estas tablas.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.risk_saldos (
  user_id        uuid PRIMARY KEY,
  saldo          integer NOT NULL DEFAULT 0 CHECK (saldo >= 0),
  actualizado_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.risk_movimientos (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  uuid NOT NULL,
  at       timestamptz NOT NULL DEFAULT now(),
  tipo     text NOT NULL CHECK (tipo IN ('compra', 'consumo', 'devolucion', 'ajuste')),
  cantidad integer NOT NULL,
  saldo    integer NOT NULL,
  detalle  text,
  por      text,
  ref      text
);
CREATE INDEX IF NOT EXISTS risk_movimientos_user_idx ON public.risk_movimientos (user_id, at DESC);

CREATE TABLE IF NOT EXISTS public.risk_compras (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  cantidad    integer NOT NULL CHECK (cantidad > 0),
  precio_unit numeric NOT NULL,
  subtotal    numeric NOT NULL,
  iva         numeric NOT NULL DEFAULT 0,
  total       numeric NOT NULL,
  bolsillo    text NOT NULL,
  por         text
);
CREATE INDEX IF NOT EXISTS risk_compras_user_idx ON public.risk_compras (user_id, at DESC);

CREATE TABLE IF NOT EXISTS public.risk_consultas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  at             timestamptz NOT NULL DEFAULT now(),
  por            text,
  por_id         uuid,
  tipo_persona   text NOT NULL DEFAULT 'natural',
  tipo_documento text NOT NULL,
  documento      text NOT NULL,
  nombre_escrito text,
  nombre_oficial text,
  categoria      text,
  operable       boolean,
  de_cache       boolean NOT NULL DEFAULT false,
  estado         text NOT NULL DEFAULT 'consultando' CHECK (estado IN ('consultando', 'lista', 'fallida')),
  check_id       text,
  ficha          jsonb,
  -- Para filtrar y pintar el mapa sin leer la ficha entera de cada fila.
  riesgos        text[] NOT NULL DEFAULT '{}',
  despachos      text[] NOT NULL DEFAULT '{}',
  actualizado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS risk_consultas_user_idx ON public.risk_consultas (user_id, at DESC);
CREATE INDEX IF NOT EXISTS risk_consultas_doc_idx  ON public.risk_consultas (user_id, tipo_documento, documento, at DESC);
CREATE INDEX IF NOT EXISTS risk_consultas_check_idx ON public.risk_consultas (check_id) WHERE check_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.risk_busquedas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  at             timestamptz NOT NULL DEFAULT now(),
  por            text,
  tipo_documento text NOT NULL,
  documento      text NOT NULL,
  nombre         text,
  resultado      text NOT NULL CHECK (resultado IN ('nueva', 'existente', 'renovada', 'sin_saldo')),
  consulta_id    uuid
);
CREATE INDEX IF NOT EXISTS risk_busquedas_user_idx ON public.risk_busquedas (user_id, at DESC);

-- Lo que Lincoin le compra a Sarblock.
CREATE TABLE IF NOT EXISTS public.risk_caja (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at          timestamptz NOT NULL DEFAULT now(),
  unidades    integer NOT NULL CHECK (unidades > 0),
  costo_total numeric NOT NULL CHECK (costo_total >= 0),
  nota        text,
  por         text
);

-- ── El historial no se borra ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.risk_sin_borrar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El historial de Lincoin Risk no se puede % (%).', lower(TG_OP), TG_TABLE_NAME;
END $$;

DO $triggers$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['risk_movimientos', 'risk_compras', 'risk_busquedas', 'risk_caja'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_inmutable', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.risk_sin_borrar()', t || '_inmutable', t);
  END LOOP;
  -- Una consulta sí cambia (de "consultando" a "lista"), pero no se borra.
  DROP TRIGGER IF EXISTS risk_consultas_sin_borrar ON public.risk_consultas;
  CREATE TRIGGER risk_consultas_sin_borrar BEFORE DELETE ON public.risk_consultas FOR EACH ROW EXECUTE FUNCTION public.risk_sin_borrar();
END;
$triggers$;

-- ── Mover el saldo de consultas (con bloqueo de fila) ────────────────
CREATE OR REPLACE FUNCTION public.risk_mover(
  p_user_id  uuid,
  p_tipo     text,
  p_cantidad integer,
  p_detalle  text DEFAULT NULL,
  p_por      text DEFAULT NULL,
  p_ref      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v integer;
BEGIN
  INSERT INTO public.risk_saldos (user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT saldo INTO v FROM public.risk_saldos WHERE user_id = p_user_id FOR UPDATE;
  IF v + p_cantidad < 0 THEN RETURN jsonb_build_object('error', 'sin_saldo', 'saldo', v); END IF;
  UPDATE public.risk_saldos SET saldo = v + p_cantidad, actualizado_at = now() WHERE user_id = p_user_id;
  INSERT INTO public.risk_movimientos (user_id, tipo, cantidad, saldo, detalle, por, ref)
    VALUES (p_user_id, p_tipo, p_cantidad, v + p_cantidad, p_detalle, p_por, p_ref);
  RETURN jsonb_build_object('ok', true, 'saldo', v + p_cantidad);
END $$;

-- ── Compra: debita los pesos y acredita las consultas, todo o nada ───
CREATE OR REPLACE FUNCTION public.risk_comprar(
  p_user_id     uuid,
  p_cantidad    integer,
  p_bolsillo    text,
  p_precio_unit numeric,
  p_subtotal    numeric,
  p_iva         numeric,
  p_total       numeric,
  p_por         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE r jsonb; v_id uuid;
BEGIN
  IF p_cantidad <= 0 OR p_total < 0 THEN RETURN jsonb_build_object('error', 'cantidad'); END IF;
  r := public.adjust_balances(p_user_id, jsonb_build_object(p_bolsillo, -p_total), '{}'::jsonb);
  IF r ? 'error' THEN RETURN r; END IF;
  INSERT INTO public.risk_compras (user_id, cantidad, precio_unit, subtotal, iva, total, bolsillo, por)
    VALUES (p_user_id, p_cantidad, p_precio_unit, p_subtotal, p_iva, p_total, p_bolsillo, p_por)
    RETURNING id INTO v_id;
  r := public.risk_mover(p_user_id, 'compra', p_cantidad, format('Compra de %s consultas', p_cantidad), p_por, v_id::text);
  RETURN r || jsonb_build_object('compra_id', v_id);
END $$;

REVOKE ALL ON FUNCTION public.risk_mover(uuid, text, integer, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.risk_comprar(uuid, integer, text, numeric, numeric, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.risk_mover(uuid, text, integer, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.risk_comprar(uuid, integer, text, numeric, numeric, numeric, numeric, text) TO service_role;

-- ── Deny-all ─────────────────────────────────────────────────────────
-- Ver 2026_lincoin_risk.sql: sin el GRANT al service_role, PostgREST no ve
-- la tabla ("Could not find the table … in the schema cache").
DO $permisos$
DECLARE t text; p record;
BEGIN
  FOREACH t IN ARRAY ARRAY['risk_saldos', 'risk_movimientos', 'risk_compras', 'risk_consultas', 'risk_busquedas', 'risk_caja'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;
  END LOOP;
END;
$permisos$;

NOTIFY pgrst, 'reload schema';
