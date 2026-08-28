-- ════════════════════════════════════════════════════════
-- CORREOS AUTOMÁTICOS AL CLIENTE por cada movimiento.
--
-- Dispara la edge function 'notify-transaction' (que manda el correo por
-- Resend) en DOS momentos, para CUALQUIER camino que cree/actualice una
-- transacción (cliente, gasfree, finity, admin):
--
--   1. AL CREAR la operación (INSERT)            → correo "en proceso / recibido"
--   2. AL COMPLETARSE (UPDATE, status='Completado') → correo "se completó"
--
-- Cubre: conversión (convert), envío (send), cargue/depósito (load),
-- pagos entre usuarios (pay_sent/pay_received) y OTC. La propia función
-- filtra los tipos que no aplican y deduplica con flags en raw_data
-- (notified / notified_completed), así que nunca manda un correo repetido.
--
-- ⚠️ Antes de correr esto:
--   • Reemplaza <ANON_KEY> por tu VITE_SUPABASE_ANON_KEY
--     (Supabase → Project Settings → API → anon public).
--   • Asegúrate de que los secrets RESEND_API_KEY y FROM_EMAIL estén
--     configurados en Edge Functions (si no, la función no envía).
--
-- Para APAGARLO: DROP TRIGGER IF EXISTS trg_cuypay_notify_tx ON public.transactions;
-- ════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.cuypay_notify_tx()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Notificar en:
  --   • INSERT (siempre)  → la función decide "creado" vs "completado" por el estado
  --   • UPDATE solo cuando el estado CAMBIÓ a 'Completado' (evita re-disparos
  --     por la propia escritura de los flags de dedup, que no tocan status)
  IF (TG_OP = 'INSERT')
     OR (TG_OP = 'UPDATE'
         AND NEW.status IS DISTINCT FROM OLD.status
         AND NEW.status = 'Completado') THEN
    PERFORM net.http_post(
      url     := 'https://afaysiaontmhgrjnoene.supabase.co/functions/v1/notify-transaction',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', '<ANON_KEY>',
        'Authorization', 'Bearer <ANON_KEY>'
      ),
      body    := jsonb_build_object(
        'type', TG_OP,
        'table', 'transactions',
        'record', to_jsonb(NEW)
      )
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cuypay_notify_tx ON public.transactions;
CREATE TRIGGER trg_cuypay_notify_tx
  AFTER INSERT OR UPDATE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.cuypay_notify_tx();
