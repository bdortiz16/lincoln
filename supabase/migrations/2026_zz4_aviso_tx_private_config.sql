-- ════════════════════════════════════════════════════════
-- AVISO DE OPERACIONES (correo + comprobante + factura) sin llave copiada.
--
-- El trigger viejo (2026_notify_tx_trigger.sql) llevaba una llave escrita en
-- el cuerpo de la función, y su plantilla pedía la ANON key: notify-transaction
-- la rechaza (401), así que las operaciones se completaban sin correo, sin
-- comprobante y sin factura.
--
-- Ahora la base GENERA su propia clave (private_config 'aviso_secret'), la
-- manda en x-webhook-secret, y las funciones la comparan leyendo la misma
-- tabla (cerrada a anon y authenticated). Nadie tiene que copiar una llave.
--
-- Avisa al crear la operación y cuando su estado cambia a Completado,
-- Fallido o Rechazado. Si algo falla al avisar, la operación NO se cae.
-- ════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE IF NOT EXISTS public.private_config (key text PRIMARY KEY, value text NOT NULL);
ALTER TABLE public.private_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.private_config FROM anon, authenticated, PUBLIC;

INSERT INTO public.private_config(key, value)
VALUES ('aviso_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.cuypay_notify_tx()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $aviso$
DECLARE v_url text; v_sec text;
BEGIN
  IF (TG_OP = 'INSERT')
     OR (TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('Completado', 'Fallido', 'Rechazado')) THEN
    BEGIN
      SELECT value INTO v_url FROM private_config WHERE key = 'supabase_url';
      SELECT value INTO v_sec FROM private_config WHERE key = 'aviso_secret';
      IF v_url IS NULL OR v_sec IS NULL THEN
        RAISE WARNING 'cuypay_notify_tx: falta supabase_url o aviso_secret en private_config';
      ELSE
        PERFORM net.http_post(
          url := v_url || '/functions/v1/notify-transaction',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_sec),
          body := jsonb_build_object('type', TG_OP, 'table', 'transactions', 'record', to_jsonb(NEW)),
          timeout_milliseconds := 30000);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'cuypay_notify_tx: no se pudo avisar: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $aviso$;

REVOKE ALL ON FUNCTION public.cuypay_notify_tx() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_cuypay_notify_tx ON public.transactions;
CREATE TRIGGER trg_cuypay_notify_tx AFTER INSERT OR UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.cuypay_notify_tx();

CREATE OR REPLACE FUNCTION public.facturas_al_dia()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fact$
DECLARE v_url text; v_sec text;
BEGIN
  SELECT value INTO v_url FROM private_config WHERE key = 'supabase_url';
  SELECT value INTO v_sec FROM private_config WHERE key = 'aviso_secret';
  IF v_url IS NULL OR v_sec IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := v_url || '/functions/v1/facturacion',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_sec),
    body := jsonb_build_object('action', 'ponerse_al_dia'),
    timeout_milliseconds := 150000);
END $fact$;

REVOKE ALL ON FUNCTION public.facturas_al_dia() FROM PUBLIC, anon, authenticated;
SELECT cron.unschedule('facturas-al-dia') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'facturas-al-dia');
SELECT cron.schedule('facturas-al-dia', '*/15 * * * *', $cron_fact$SELECT public.facturas_al_dia()$cron_fact$);
