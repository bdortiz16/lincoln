-- ════════════════════════════════════════════════════════
-- 'kumplo' pasa a ser una clave de raw_data que SOLO el servidor escribe.
--
-- Ahí vive el veredicto AML (riesgo bajo/medio/alto) y el id de la persona
-- en Kumplo. Si un cliente pudiera escribirlo por PATCH directo a su propio
-- raw_data, se pondría "riesgo bajo" a sí mismo y el control de lavado de
-- activos dejaría de existir — sería una casilla de preferencias, no un
-- veredicto de cumplimiento.
--
-- Este archivo NO redefine el trigger: agrega la clave a la lista que ya
-- vive en 2026_guard_raw_data_server_keys.sql. Hay que correr ese primero.
-- ════════════════════════════════════════════════════════

-- Se vuelve a crear la función con 'kumplo' añadido al arreglo protegido.
-- (La definición completa vive en 2026_guard_raw_data_server_keys.sql; si esa
--  cambia, este archivo hay que regenerarlo desde ella.)
DO $$
DECLARE
  cuerpo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO cuerpo
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'guard_raw_data_server_keys' AND n.nspname = 'public'
  LIMIT 1;

  IF cuerpo IS NULL THEN
    RAISE EXCEPTION 'Falta guard_raw_data_server_keys: corre antes 2026_guard_raw_data_server_keys.sql';
  END IF;

  IF position('''kumplo''' in cuerpo) > 0 THEN
    RAISE NOTICE 'kumplo ya estaba protegido; no hay nada que hacer.';
    RETURN;
  END IF;

  -- Se inserta 'kumplo' al final del arreglo de claves protegidas.
  cuerpo := replace(cuerpo, '''mfaSessions''' || E'\n  ];', '''mfaSessions'',' || E'\n    -- El veredicto AML de Kumplo. Escribirlo desde el cliente seria\n    -- ponerse "riesgo bajo" uno mismo.\n    ''kumplo''' || E'\n  ];');

  EXECUTE cuerpo;
END $$;

-- Comprobación: debe devolver true.
SELECT position('''kumplo''' in pg_get_functiondef(p.oid)) > 0 AS kumplo_protegido
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'guard_raw_data_server_keys' AND n.nspname = 'public';
