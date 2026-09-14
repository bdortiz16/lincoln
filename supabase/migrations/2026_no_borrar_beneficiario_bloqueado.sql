-- ============================================================================
-- Un beneficiario bloqueado por cumplimiento NO se borra
-- ============================================================================
--
-- El problema: la lista de beneficiarios vive en raw_data.mouvContacts y la
-- escribe el navegador (es la lista del usuario, tiene que poder editarla).
-- Borrar uno es mandar la lista sin esa fila.
--
-- Eso significaba que quien inscribia a una persona sancionada podia, al ver
-- el bloqueo en rojo, borrar la ficha y dejar la lista limpia. El veredicto
-- de TusDatos si quedaba guardado -- raw_data.tusdatos esta protegida por
-- guard_raw_data_server_keys -- pero se perdia la prueba de a quien se le
-- habia intentado transferir, que es justamente lo que hay que conservar.
--
-- Este trigger lo impide: si una entrada de mouvContacts desaparece y su
-- documento tiene un veredicto bloqueante guardado, la entrada se devuelve a
-- la lista. No falla la operacion -- el resto de los cambios del usuario se
-- guardan igual -- simplemente esa ficha no se va.
--
-- Un veredicto es bloqueante cuando la consulta TERMINO y ademas:
--   - operable = false        (el servidor dijo que no se puede operar), o
--   - categoria = 'alto'      (hallazgos de riesgo alto), o
--   - nombreCoincide = false  (el nombre no es el del documento), o
--   - documentoVigente = false
--
-- Una consulta a medias NO bloquea el borrado: la ausencia de resultado no es
-- una condena, y no se le va a impedir a alguien limpiar su lista porque una
-- consulta se quedo colgada.
--
-- El service_role (edge functions) y los admins pasan sin restriccion: hay
-- que poder corregir un caso desde el panel.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_beneficiario_bloqueado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  is_privileged boolean := FALSE;
  oldraw  jsonb := COALESCE(OLD.raw_data, '{}'::jsonb);
  newraw  jsonb := COALESCE(NEW.raw_data, '{}'::jsonb);
  fichas  jsonb;
  vieja   jsonb;
  nueva   jsonb;
  item    jsonb;
  doc     text;
  v       jsonb;
  repuestos jsonb := '[]'::jsonb;
BEGIN
  -- Via libre para el servidor y los administradores.
  BEGIN
    IF auth.role() = 'service_role' THEN is_privileged := TRUE; END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF NOT is_privileged THEN
    BEGIN
      IF public.is_any_admin() THEN is_privileged := TRUE; END IF;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  IF is_privileged THEN
    RETURN NEW;
  END IF;

  vieja := COALESCE(oldraw -> 'mouvContacts', '[]'::jsonb);
  nueva := COALESCE(newraw -> 'mouvContacts', '[]'::jsonb);

  -- Nada que cuidar: la lista no cambio, o no es una lista, o no hay fichas
  -- de antecedentes guardadas.
  IF vieja IS NOT DISTINCT FROM nueva
     OR jsonb_typeof(vieja) <> 'array'
     OR jsonb_typeof(nueva) <> 'array' THEN
    RETURN NEW;
  END IF;

  fichas := COALESCE(oldraw #> '{tusdatos,beneficiarios}', '{}'::jsonb);
  IF jsonb_typeof(fichas) <> 'object' OR fichas = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  -- Por cada beneficiario que YA NO esta en la lista nueva, mirar su veredicto.
  FOR item IN SELECT value FROM jsonb_array_elements(vieja) LOOP
    CONTINUE WHEN item IS NULL OR jsonb_typeof(item) <> 'object';

    -- Sigue en la lista -> no se borro. Se compara por id; las fichas viejas
    -- que no tienen id se comparan por documento + numero de cuenta.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(nueva) n
      WHERE (item ->> 'id' IS NOT NULL AND n ->> 'id' = item ->> 'id')
         OR (item ->> 'id' IS NULL
             AND COALESCE(n ->> 'docNumber', '') = COALESCE(item ->> 'docNumber', '')
             AND COALESCE(n ->> 'accountNumber', '') = COALESCE(item ->> 'accountNumber', ''))
    );

    -- Solo digitos, igual que lo hace el resto del sistema.
    doc := regexp_replace(COALESCE(item ->> 'docNumber', ''), '[^0-9]', '', 'g');
    CONTINUE WHEN doc = '';

    v := fichas -> doc;
    CONTINUE WHEN v IS NULL OR jsonb_typeof(v) <> 'object';

    -- Consulta a medias: no bloquea el borrado.
    CONTINUE WHEN COALESCE(v ->> 'estado', '') <> 'finalizado';

    IF (v ->> 'operable') = 'false'
       OR COALESCE(v ->> 'categoria', '') = 'alto'
       OR (v ->> 'nombreCoincide') = 'false'
       OR (v ->> 'documentoVigente') = 'false' THEN
      repuestos := repuestos || jsonb_build_array(item);
    END IF;
  END LOOP;

  IF jsonb_array_length(repuestos) > 0 THEN
    NEW.raw_data := jsonb_set(newraw, '{mouvContacts}', nueva || repuestos, true);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_beneficiario_bloqueado() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_guard_beneficiario_bloqueado ON public.users;
CREATE TRIGGER trg_guard_beneficiario_bloqueado
  BEFORE UPDATE OF raw_data ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_beneficiario_bloqueado();

NOTIFY pgrst, 'reload schema';

-- Comprobacion: las dos columnas deben decir true.
SELECT
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'guard_beneficiario_bloqueado' AND n.nspname = 'public'
  ) AS funcion_creada,
  EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgname = 'trg_guard_beneficiario_bloqueado' AND NOT t.tgisinternal
  ) AS trigger_puesto;
