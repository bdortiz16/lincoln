-- Notificaciones push: a que aparatos hay que avisarle.
--
-- Una fila = UN aparato (un navegador en un telefono), no un usuario. La misma
-- persona puede tener el iPhone y el escritorio, y cuando entra un cierre hay
-- que sonar en los dos.
--
-- endpoint es la direccion que da el navegador y es la identidad real de la
-- suscripcion: UNIQUE sobre el, porque re-suscribir el mismo aparato devuelve
-- el mismo endpoint y no debe duplicar la fila.
--
-- p256dh y auth son las claves con las que el navegador descifra el aviso. Sin
-- ellas el push no se puede armar; por eso son NOT NULL.
--
-- fallos: cuantas veces seguidas el servicio del navegador rechazo el envio.
-- iOS tira la suscripcion sin avisar si la app no se abre por semanas, y una
-- suscripcion muerta responde 404/410 para siempre. Se borra al primer
-- rechazo definitivo; el contador es para los errores dudosos.
--
-- Solo las escribe el servidor via la edge push. GRANT explicito: el
-- service_role se salta la RLS pero NO los permisos de tabla.

CREATE TABLE IF NOT EXISTS public.push_subs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL,
  endpoint    text        NOT NULL UNIQUE,
  p256dh      text        NOT NULL,
  auth        text        NOT NULL,
  ua          text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_ok_at  timestamptz,
  fallos      int         NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS push_subs_user_idx ON public.push_subs (user_id);

ALTER TABLE public.push_subs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.push_subs FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.push_subs TO service_role;

NOTIFY pgrst, 'reload schema';
