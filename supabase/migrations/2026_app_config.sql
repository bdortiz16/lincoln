-- ════════════════════════════════════════════════════════
--  app_config — la configuración de la app. UNA fila, id = 1.
--
--  POR QUE FALTABA, Y QUE COSTO
--    Esta tabla venía del proyecto anterior (CuyPay) y nunca se creó en el de
--    Lincoin: se dio por existente. Ninguna migración la creaba.
--
--    Lo que pasa sin ella es peor que un error: la app pide la configuración,
--    no encuentra la tabla, y SE QUEDA CON LOS VALORES POR DEFECTO DEL CODIGO
--    sin decir nada. Todo parece funcionar. El admin cambia algo, lo ve
--    aplicado —porque su propio navegador lo guarda— y ningún cliente lo ve
--    nunca.
--
--    Se fue a buscar durante horas por qué "activar Brasil" no llegaba a la
--    app. La respuesta era que no había dónde guardarlo. Y no era solo Brasil:
--    el modo mantenimiento, los cupones, la llave de reCAPTCHA, los bancos
--    disponibles y los saldos de tesorería viven acá. Todos venían corriendo
--    con el valor de fábrica.
--
--  UNA SOLA FILA, A PROPOSITO
--    id = 1 fijo. Todo el código lee y escribe .eq('id', 1); una segunda fila
--    sería configuración fantasma que nadie mira.
-- ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.app_config (
  id         int PRIMARY KEY,
  settings   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Sin fila, el primer guardado tendría que crearla y el primer LEER devolvería
-- vacío. Se siembra con los mismos valores que el código trae por defecto, así
-- crear la tabla NO cambia el comportamiento de nada: solo le da dónde vivir.
INSERT INTO public.app_config (id, settings)
VALUES (1, jsonb_build_object(
  'countryStatus', jsonb_build_object(
    'Colombia', 'on',
    'Estados Unidos', 'on',
    'México', 'soon',
    'Brasil', 'soon'
  )
))
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- LOS CLIENTES NO LA LEEN DIRECTO, Y ES DELIBERADO.
--
-- La leen a través de la edge function get-system-config, que es pública pero
-- FILTRA las claves con pinta de secreto antes de responder. Si el navegador
-- pudiera consultar la tabla de frente, ese filtro se saltearía — y acá adentro
-- se guarda lo que alguien haya puesto, no solo lo que debería.
REVOKE ALL ON public.app_config FROM anon, authenticated, PUBLIC;

-- service_role saltea RLS pero NO los GRANT de tabla: sin esto, ni la edge
-- function ni el guardado del admin la ven.
GRANT ALL ON public.app_config TO service_role;
