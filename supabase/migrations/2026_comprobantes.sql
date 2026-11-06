-- ════════════════════════════════════════════════════════
--  comprobantes — uno por operación completada, con número consecutivo,
--  emitido solo, en el momento en que la operación se completa.
--
--  QUÉ ES Y QUÉ NO ES
--    Es el COMPROBANTE de la operación: número, fecha, tipo, monto, moneda,
--    contraparte y el estado con que se emitió. Se guarda acá y se manda por
--    correo al cliente apenas la operación pasa a Completado.
--
--    NO es una factura electrónica. Una factura en Colombia la valida la
--    DIAN a través de un proveedor tecnológico (Siigo, Alegra, …), lleva
--    CUFE y resolución, y la emite Lincoin por lo que Lincoin cobra —la
--    comisión—, no por la plata del cliente que pasa por acá. Ese paso es una
--    integración aparte con credenciales del proveedor, y esta tabla deja
--    las columnas listas para enlazarla (factura_numero, factura_cufe,
--    factura_proveedor) sin inventar hoy un documento que no existe.
--
--  POR QUÉ SE EMITE DESDE EL SERVIDOR
--    El comprobante que el cliente descarga hoy se dibuja en su navegador,
--    cuando él quiere. Un consecutivo tiene que nacer en un solo lugar y en
--    orden: si lo numerara el navegador, dos clientes podrían tener el mismo
--    número y un cliente podría "emitir" dos veces la misma operación. El
--    número lo da la base (folio bigserial) y la operación va UNIQUE: una
--    operación, un comprobante, aunque el webhook llegue cinco veces.
--
--  QUIÉN LO DISPARA
--    notify-transaction, que ya recibe el webhook de `transactions` en cada
--    INSERT y en cada UPDATE que pasa a Completado. Ahí mismo, antes de armar
--    el correo, se emite el comprobante y su número va en el correo.
-- ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.comprobantes (
  folio           bigserial PRIMARY KEY,
  -- LC-000123. Se calcula del folio: no se puede escribir a mano.
  numero          text GENERATED ALWAYS AS ('LC-' || lpad(folio::text, 6, '0')) STORED,

  -- Una operación, un comprobante.
  transaction_id  uuid NOT NULL UNIQUE REFERENCES public.transactions(id) ON DELETE RESTRICT,
  user_id         uuid REFERENCES public.users(id) ON DELETE SET NULL,

  tipo            text NOT NULL,          -- send | dispersion | load | convert | …
  -- El monto como TEXTO, nunca float: "1500000.00" tiene que seguir siendo eso.
  monto           text NOT NULL,
  moneda          text NOT NULL,
  contraparte     text,                   -- beneficiario, banco, red, o "COP→USD"
  estado_al_emitir text NOT NULL,         -- con qué estado se emitió (Completado)

  emitido_at      timestamptz NOT NULL DEFAULT now(),
  -- Cuándo salió el correo y a dónde. NULL = no salió (correo apagado por el
  -- cliente, o Resend falló). El comprobante existe igual: es contable, no
  -- depende de que el correo llegue.
  enviado_at      timestamptz,
  correo          text,

  -- La operación tal como estaba al emitir. Si después alguien la toca, el
  -- comprobante sigue diciendo lo que decía.
  detalle         jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Enlace a la factura electrónica, cuando exista esa integración.
  factura_proveedor text,
  factura_numero    text,
  factura_cufe      text,
  factura_at        timestamptz
);

CREATE INDEX IF NOT EXISTS comprobantes_user_idx ON public.comprobantes (user_id, emitido_at DESC);

ALTER TABLE public.comprobantes ENABLE ROW LEVEL SECURITY;

-- El cliente ve SUS comprobantes. Nadie escribe desde el navegador: los
-- emite el servidor.
DROP POLICY IF EXISTS comprobantes_propios ON public.comprobantes;
CREATE POLICY comprobantes_propios ON public.comprobantes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.comprobantes FROM anon, PUBLIC;
GRANT SELECT ON public.comprobantes TO authenticated;
-- service_role saltea RLS pero NO los GRANT: sin esto, la función no la ve.
GRANT ALL ON public.comprobantes TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.comprobantes_folio_seq TO service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- OJO CON EL DISPARADOR.
--   La migración 2026_notify_tx_trigger.sql apunta a
--   https://afaysiaontmhgrjnoene.supabase.co — ese es el proyecto de CUYPAY,
--   no el de Lincoin. Si el trigger de Lincoln se creó copiando ese archivo,
--   los webhooks están llegando al proyecto equivocado y NINGÚN correo de
--   "se completó" —ni este comprobante— sale.
--
--   Comprobalo en otra pestaña:
--     SELECT pg_get_functiondef('public.cuypay_notify_tx'::regproc);
--   Tiene que decir wqleypebmfiaygrurnrc. Si dice afaysiaontmhgrjnoene, o no
--   existe, recreá la función con la URL correcta y TU anon key:
--
--   CREATE OR REPLACE FUNCTION public.cuypay_notify_tx() RETURNS trigger
--   LANGUAGE plpgsql SECURITY DEFINER AS $$
--   BEGIN
--     IF (TG_OP = 'INSERT') OR (TG_OP = 'UPDATE'
--         AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'Completado') THEN
--       PERFORM net.http_post(
--         url := 'https://wqleypebmfiaygrurnrc.supabase.co/functions/v1/notify-transaction',
--         headers := jsonb_build_object('Content-Type','application/json',
--                      'apikey','<ANON_KEY>','Authorization','Bearer <ANON_KEY>'),
--         body := jsonb_build_object('type',TG_OP,'table','transactions','record',to_jsonb(NEW)));
--     END IF;
--     RETURN NEW;
--   END $$;
--   DROP TRIGGER IF EXISTS trg_cuypay_notify_tx ON public.transactions;
--   CREATE TRIGGER trg_cuypay_notify_tx AFTER INSERT OR UPDATE ON public.transactions
--     FOR EACH ROW EXECUTE FUNCTION public.cuypay_notify_tx();
-- ============================================================================
