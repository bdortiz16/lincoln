-- ════════════════════════════════════════════════════════
--  Colaboradores: el equipo interno con funciones por sección.
--
--  QUE CAMBIA
--    Hasta ahora cada miembro tenía un rol fijo (operaciones, cumplimiento,
--    lectura, tesorería). Un colaborador tiene el rol 'colaborador' y una
--    lista de FUNCIONES: las secciones del panel que puede usar (clientes,
--    billetera, tesoreria, otc, coinsenda, fallos, reportes, contabilidad,
--    cumplimiento…). El servidor deriva de esa lista qué acciones le deja
--    pedir; lo que no está marcado se niega.
--
--  LA BASE TAMBIEN LO EXIGE
--    Aprobar o rechazar cargues y retiros pasa por RPCs que el panel llama
--    directo (admin_equipo_permite_tesoreria). Un colaborador solo resuelve
--    ahí si tiene la función 'tesoreria'. Sin esto, el permiso de la casilla
--    se exigiría en admin-data y no en la base, y un permiso que se exige en
--    una sola puerta no es un permiso.
--
--  Idempotente: se puede volver a correr en el SQL Editor.
-- ════════════════════════════════════════════════════════

ALTER TABLE public.admin_miembros
  ADD COLUMN IF NOT EXISTS funciones text[] NOT NULL DEFAULT '{}';

-- Invitación pendiente: cuándo se mandó el último correo para crear la
-- contraseña. Solo informativo (el panel muestra "Invitación enviada").
ALTER TABLE public.admin_miembros
  ADD COLUMN IF NOT EXISTS invitado_at timestamptz;

ALTER TABLE public.admin_miembros DROP CONSTRAINT IF EXISTS admin_miembros_rol_check;
ALTER TABLE public.admin_miembros ADD CONSTRAINT admin_miembros_rol_check
  CHECK (rol IN ('dueno', 'operaciones', 'cumplimiento', 'lectura', 'tesoreria', 'colaborador'));

create or replace function public.admin_equipo_permite_tesoreria(p_currency text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_rol text; v_paises text[]; v_activo boolean; v_funciones text[]; v_pais text; v_hay int;
begin
  if not public.is_app_admin() then return false; end if;

  select rol, paises, activo, funciones into v_rol, v_paises, v_activo, v_funciones
    from public.admin_miembros where id = auth.uid();
  if not found then
    select count(*) into v_hay from public.admin_miembros;
    return v_hay = 0;
  end if;

  if not v_activo then return false; end if;
  if v_rol = 'dueno' then return true; end if;
  if v_rol = 'colaborador' then
    if not ('tesoreria' = any(coalesce(v_funciones, '{}'))) then return false; end if;
  elsif v_rol not in ('operaciones', 'tesoreria') then
    return false;
  end if;

  v_pais := case upper(coalesce(p_currency, ''))
    when 'COP' then 'CO' when 'COP_BREB' then 'CO' when 'COP_ACH' then 'CO'
    when 'COP_C3' then 'CO' when 'COP_C4' then 'CO'
    when 'BRL' then 'BR' when 'MXN' then 'MX'
    when 'USD' then 'US' when 'USDT' then 'US' when 'USDT_TRON' then 'US'
    when 'USDC' then 'US' when 'EURC' then 'US'
    else null end;
  if coalesce(array_length(v_paises, 1), 0) = 0 then return false; end if;
  return v_pais is null or v_pais = any(v_paises);
end;
$$;

revoke all on function public.admin_equipo_permite_tesoreria(text) from public, anon, authenticated;
