-- ════════════════════════════════════════════════════════
--  Caja de Lincoin: apertura, foto diaria y cierre.
--
--  En Mouv y en Finity se mueve plata por fuera de Lincoin, así que "bolsa −
--  saldos de los clientes" no es lo que es de Lincoin. La caja separa:
--      bolsa = clientes + Lincoin + (movimientos externos) ± diferencia
--  · Apertura: el día que empieza la caja, todo lo que sobra en cada bolsa
--    se toma como de Lincoin. El dueño la puede corregir.
--  · Lincoin esperado = apertura + utilidad de los cargues desde entonces
--    (los retiros y movimientos externos entran cuando exista su registro).
--  · Foto diaria a las 23:59 de Colombia: bolsa, clientes y Lincoin esperado,
--    para cerrar cualquier periodo con saldo inicial y final.
--
--  Solo el backend (admin-data, service_role) lee y escribe estas tablas.
-- ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.caja_apertura (
  proveedor   text PRIMARY KEY CHECK (proveedor IN ('Mouv', 'Finity')),
  abierta_at  timestamptz NOT NULL DEFAULT now(),
  bolsa       numeric NOT NULL,
  clientes    numeric NOT NULL,
  lincoin     numeric NOT NULL,          -- bolsa − clientes, o lo que fije el dueño
  nota        text,
  editado_por jsonb,                     -- { id, email, nombre } de quien la fijó o corrigió
  editado_at  timestamptz
);

CREATE TABLE IF NOT EXISTS public.caja_cierres (
  fecha            date NOT NULL,        -- día en Colombia
  proveedor        text NOT NULL CHECK (proveedor IN ('Mouv', 'Finity')),
  bolsa            numeric,              -- null si el proveedor no respondió
  clientes         numeric NOT NULL,
  lincoin_esperado numeric NOT NULL,
  diferencia       numeric,              -- bolsa − clientes − Lincoin esperado
  creado_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fecha, proveedor)
);

ALTER TABLE public.caja_apertura ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caja_cierres  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.caja_apertura FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.caja_cierres  FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.caja_apertura TO service_role;
GRANT ALL ON public.caja_cierres  TO service_role;

-- Foto diaria: la toma admin-data (lee las bolsas de Mouv y Finity con la
-- llave de servicio). Mismo patrón que sarblock_barrido / facturas_al_dia.
CREATE OR REPLACE FUNCTION public.caja_foto()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $caja$
DECLARE v_url text; v_sec text;
BEGIN
  SELECT value INTO v_url FROM private_config WHERE key = 'supabase_url';
  SELECT value INTO v_sec FROM private_config WHERE key = 'aviso_secret';
  IF v_url IS NULL OR v_sec IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := v_url || '/functions/v1/admin-data',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_sec),
    body := jsonb_build_object('action', 'caja_foto'),
    timeout_milliseconds := 120000);
END $caja$;

REVOKE ALL ON FUNCTION public.caja_foto() FROM PUBLIC, anon, authenticated;

-- 23:59 de Colombia = 04:59 UTC (Colombia no tiene horario de verano).
SELECT cron.unschedule('caja-foto') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'caja-foto');
SELECT cron.schedule('caja-foto', '59 4 * * *', $cron_caja$SELECT public.caja_foto()$cron_caja$);
