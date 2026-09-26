-- ============================================================================
-- Un beneficiario bloqueado por cumplimiento NO se borra
-- ============================================================================
--
-- La lista de beneficiarios vive en raw_data.mouvContacts y la escribe el
-- navegador (es la lista del usuario, tiene que poder editarla). Borrar uno es
-- mandar la lista sin esa fila.
--
-- Eso significaba que quien inscribia a una persona sancionada podia, al ver
-- el bloqueo en rojo, borrar la ficha y dejar la lista limpia. El veredicto de
-- TusDatos si quedaba guardado, pero se perdia la prueba de a quien se le
-- habia intentado transferir, que es lo que hay que conservar.
--
-- Este trigger lo impide: si una entrada desaparece y su documento tiene un
-- hallazgo grave guardado, la entrada se devuelve a la lista. No falla la
-- operacion -- el resto de los cambios del usuario se guardan igual --
-- simplemente esa ficha no se va.
--
-- NO poder enviar y NO poder borrar son cosas distintas. Un nombre que no
-- corresponde al documento casi siempre es un error de digitacion, y eso se
-- corrige borrando e inscribiendo de nuevo con el nombre bueno: ahi SI se
-- puede borrar. Lo que queda grabado es el hallazgo sobre la PERSONA:
-- categoria alta, o un documento que no esta vigente (una cedula cancelada
-- por muerte recibiendo plata no es un dedazo).
--
-- Se mira la CATEGORIA, no lo que muestre la pantalla: un beneficiario con el
-- nombre mal escrito Y riesgo alto tampoco se puede borrar.
--
-- Una consulta a medias NO bloquea el borrado: la ausencia de resultado no es
-- una condena, y no se le va a trabar la lista a alguien porque una consulta
-- se quedo colgada.
--
-- El service_role (edge functions) y los admins pasan sin restriccion: hay que
-- poder corregir un caso desde el panel.
--
-- NOTA PARA EL EDITOR DE SUPABASE: los comentarios de este archivo no llevan
-- comillas simples a proposito. El editor cuenta comillas para partir el
-- script en sentencias, y una comilla suelta dentro de un comentario lo hace
-- cortar en el sitio equivocado.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_beneficiario_bloqueado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $guard_benef$
DECLARE
  is_privileged boolean := FALSE;
  oldraw    jsonb := COALESCE(OLD.raw_data, '{}'::jsonb);
  newraw    jsonb := COALESCE(NEW.raw_data, '{}'::jsonb);
  fichas    jsonb;
  vieja     jsonb;
  nueva     jsonb;
  item      jsonb;
  doc       text;
  v         jsonb;
  sigue     boolean;
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

  -- Si la lista NUEVA no es un arreglo (llego null, un objeto o una cadena),
  -- se trata como lista vacia: borrar todo mandando basura no puede ser la
  -- forma de saltarse la guardia.
  IF jsonb_typeof(nueva) <> 'array' THEN
    nueva := '[]'::jsonb;
  END IF;

  IF vieja IS NOT DISTINCT FROM nueva OR jsonb_typeof(vieja) <> 'array' THEN
    RETURN NEW;
  END IF;

  fichas := COALESCE(oldraw #> '{tusdatos,beneficiarios}', '{}'::jsonb);
  IF jsonb_typeof(fichas) <> 'object' OR fichas = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  -- Por cada beneficiario que YA NO esta en la lista nueva, mirar su veredicto.
  FOR item IN SELECT value FROM jsonb_array_elements(vieja) LOOP
    IF item IS NULL OR jsonb_typeof(item) <> 'object' THEN
      CONTINUE;
    END IF;

    -- Sigue en la lista? Se compara por id; las fichas viejas sin id se
    -- comparan por documento mas numero de cuenta.
    SELECT EXISTS (
      SELECT 1 FROM jsonb_array_elements(nueva) n
      WHERE (item ->> 'id' IS NOT NULL AND n ->> 'id' = item ->> 'id')
         OR (item ->> 'id' IS NULL
             AND COALESCE(n ->> 'docNumber', '') = COALESCE(item ->> 'docNumber', '')
             AND COALESCE(n ->> 'accountNumber', '') = COALESCE(item ->> 'accountNumber', ''))
    ) INTO sigue;

    IF sigue THEN
      CONTINUE;
    END IF;

    -- Solo digitos, igual que lo hace el resto del sistema.
    doc := regexp_replace(COALESCE(item ->> 'docNumber', ''), '[^0-9]', '', 'g');
    IF doc = '' THEN
      CONTINUE;
    END IF;

    v := fichas -> doc;
    IF v IS NULL OR jsonb_typeof(v) <> 'object' THEN
      CONTINUE;
    END IF;

    -- Consulta a medias: no bloquea el borrado.
    IF COALESCE(v ->> 'estado', '') <> 'finalizado' THEN
      CONTINUE;
    END IF;

    IF COALESCE(v ->> 'categoria', '') = 'alto'
       OR (v ->> 'documentoVigente') = 'false' THEN
      repuestos := repuestos || jsonb_build_array(item);
    END IF;
  END LOOP;

  IF jsonb_array_length(repuestos) > 0 THEN
    NEW.raw_data := jsonb_set(newraw, '{mouvContacts}', nueva || repuestos, true);
  END IF;

  RETURN NEW;
END;
$guard_benef$;

REVOKE ALL ON FUNCTION public.guard_beneficiario_bloqueado() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_guard_beneficiario_bloqueado ON public.users;
CREATE TRIGGER trg_guard_beneficiario_bloqueado
  BEFORE UPDATE OF raw_data ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_beneficiario_bloqueado();

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- La comprobacion esta en 2026_zz_verificacion.sql y se corre APARTE. Pegada
-- aca abajo seria peligrosa: el editor de Supabase corre todo el script en una
-- sola transaccion, asi que un error en la consulta de comprobacion revierte
-- tambien el DDL que si habia funcionado.
-- ============================================================================
