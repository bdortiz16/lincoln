-- ════════════════════════════════════════════════════════
--  kyt_registry — el CAMINO, no solo la distancia.
--
--  QUE CAMBIA
--    La V3 del risk_score de MistTrack devuelve `hop_dic`: un diccionario
--    { "1": [direccion...], "2": [...] } donde el salto 1 es la ENTIDAD
--    SENALADA y el ultimo salto es la direccion que preguntamos. O sea, el
--    camino entero, con los intermediarios nombrados uno por uno.
--
--    Ya lo estabamos recibiendo. Lo estabamos tirando.
--
--  POR QUE IMPORTA
--    Hasta hoy, para saber POR DONDE pasaba la plata, el sistema recorria las
--    contrapartes a mano: una consulta pagada por cada una, con un presupuesto
--    de diez. Con doscientas contrapartes se miraban diez, y la pantalla tenia
--    que decir "no hay rutas EN LO QUE MIRAMOS" — que es la verdad, pero es
--    media respuesta.
--
--    hop_dic no tiene ese limite y no cuesta nada aparte: viene con el puntaje
--    que ya se paga.
--
--  LO QUE hop_dic NO DICE
--    El sentido del flujo. No dice si a esa direccion le mandamos o si nos
--    mando. Eso sigue saliendo de transactions_investigation, y por eso las dos
--    fuentes se usan juntas y se cruzan: el camino lo pone una, el sentido lo
--    pone la otra. Cuando una contraparte del camino no aparece entre las
--    revisadas, el flujo queda en NULL y la pantalla dice que no lo sabemos —
--    no "no hubo".
--
--  hop_at NO ES DECORACION
--    Distingue "le preguntamos por el camino y no tiene" de "esta ficha es de
--    antes de que empezaramos a leerlo". Sin esa marca solo quedan dos salidas
--    malas: pagar una consulta de riesgo en cada clic de "Rastrear", o que las
--    fichas viejas nunca muestren un camino que el proveedor si manda.
-- ════════════════════════════════════════════════════════

-- El camino crudo, tal como lo manda el proveedor. Se guarda entero: si su
-- formato cambia, esto sigue siendo la prueba de que dijeron.
ALTER TABLE public.kyt_registry ADD COLUMN IF NOT EXISTS hop_dic jsonb;

-- address_label de la V3: la etiqueta que el proveedor le pone a la direccion.
-- Va tambien a `labels`, pero se guarda aparte porque es de la fuente mas
-- confiable que tenemos y mezclada ahi adentro no se puede volver a distinguir.
ALTER TABLE public.kyt_registry ADD COLUMN IF NOT EXISTS address_label text;

-- Cuando se le pregunto por el camino. NULL = nunca. Ver arriba.
ALTER TABLE public.kyt_registry ADD COLUMN IF NOT EXISTS hop_at timestamptz;

-- El saldo y los movimientos del ESTABLE de la red, aparte del nativo.
--
-- address_overview devuelve la moneda nativa. Una wallet de TRON que movio cien
-- mil dolares en USDT puede tener 0 TRX — y el reporte mostraba ese 0 como si
-- fuera todo el saldo, al lado de 4.954 USD de exposicion. Las dos cosas no
-- podian ser ciertas a la vez.
--
-- Va en su propia columna y no mezclado con `actividad`: son dos activos
-- distintos, y sumarlos o pisar uno con el otro seria inventar un numero.
ALTER TABLE public.kyt_registry ADD COLUMN IF NOT EXISTS token_actividad jsonb;

-- Para encontrar las fichas a las que todavia no se les pidio el camino.
CREATE INDEX IF NOT EXISTS kyt_registry_sin_hop_idx
  ON public.kyt_registry (actualizado_at DESC)
  WHERE hop_at IS NULL;

-- El grant ya estaba, pero se repite: service_role saltea RLS y NO los permisos
-- de tabla, y PostgREST arma su cache solo con lo que algun rol puede tocar.
GRANT ALL ON public.kyt_registry TO service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Comprobacion APARTE, en otra pestana. Pegada aca seria peligrosa: el editor
-- de Supabase corre todo en una transaccion y un error en la consulta de
-- comprobacion revierte tambien el ALTER que si funciono.
--
--   SELECT column_name
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'kyt_registry'
--      AND column_name IN ('hop_dic','address_label','hop_at','token_actividad')
--    ORDER BY column_name;
--   -- Tienen que salir las cuatro.
-- ============================================================================
