# Antes de correr cualquier migración: comprobá EN QUÉ BASE estás

Hay más de un proyecto de Supabase en esta cuenta. Las migraciones de esta
carpeta van **a la base que usan la app y las edge functions**, y no es la única
que aparece en el selector del dashboard.

## Cómo saber cuál es

El proyecto correcto es el que tiene configurado el secreto
`SUPABASE_PROJECT_REF` del workflow `.github/workflows/deploy-edge-functions.yml`
— el mismo al que apunta `VITE_SUPABASE_URL` en Vercel.

Tres formas de comprobarlo, de la más rápida a la más lenta:

1. **Vercel → Settings → Environment Variables → `VITE_SUPABASE_URL`.** El
   subdominio de esa URL es el proyecto.
2. **Admin → Cumplimiento → Lincoin Risk.** Si el padrón falla, el panel dice
   las cuatro primeras letras de la base a la que le preguntó el servidor.
3. **El log del despliegue**, paso "Check secrets": imprime los cuatro primeros
   caracteres del project ref.

El número de proyecto va en la URL del dashboard:
`supabase.com/dashboard/project/<AQUÍ>/sql/...`

## Por qué está escrito esto

El 17 de septiembre de 2026 se corrió un día entero de migraciones —cierre de
RLS, los triggers de cumplimiento, el padrón de Lincoin Risk— **en el proyecto
equivocado**. El dashboard estaba abierto en otro proyecto de la misma cuenta y
nada en la pantalla lo desmentía: las tablas se crearon, las comprobaciones
dieron todas `true`, y la app seguía fallando exactamente igual.

Se perdieron horas persiguiendo la caché de esquema de PostgREST y los permisos
de `service_role` —que efectivamente faltaba uno, pero en la base que no era—
porque las tres causas posibles se leen igual desde afuera:

- la migración no se corrió,
- la tabla existe pero sin permiso para el servidor,
- el servidor está mirando otra base.

**Una comprobación que da `true` no dice nada si se corrió en la base
equivocada.** Confirmá el proyecto ANTES, no después.
