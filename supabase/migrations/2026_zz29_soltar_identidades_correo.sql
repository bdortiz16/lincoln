-- ════════════════════════════════════════════════════════
--  Al cambiar el correo de acceso, soltar los ingresos de OTRO proveedor
--  (Google…) que estaban atados al correo ANTERIOR.
--
--  Incidente (3 nov): se cambió el correo de una empresa de A a B. La cuenta
--  de acceso quedó con B, pero su ingreso con Google seguía siendo el de A
--  (Google identifica por su propia cuenta, no por el correo). Al crear una
--  cuenta nueva con Google como A, entraba a la empresa vieja en vez de
--  crear una nueva: el correo A no quedaba libre.
--
--  Esta función la llama admin-data (llave de servicio) después de cambiar
--  el correo: borra de auth.identities las identidades que NO son de correo
--  y tienen el correo anterior, y deja la identidad de correo con el nuevo.
--  Solo service_role puede ejecutarla.
--
--  Idempotente.
-- ════════════════════════════════════════════════════════

create or replace function public.lincoin_soltar_identidades(p_user uuid, p_anterior text, p_nuevo text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_soltadas int := 0;
  v_correo int := 0;
  v_ant text := lower(trim(coalesce(p_anterior, '')));
  v_nue text := lower(trim(coalesce(p_nuevo, '')));
begin
  if p_user is null or v_nue = '' then
    return jsonb_build_object('ok', false, 'error', 'faltan_datos');
  end if;
  if v_ant <> '' and v_ant <> v_nue then
    delete from auth.identities
     where user_id = p_user
       and provider <> 'email'
       and lower(coalesce(identity_data->>'email', '')) = v_ant;
    get diagnostics v_soltadas = row_count;
  end if;
  update auth.identities
     set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_nue)),
         updated_at = now()
   where user_id = p_user
     and provider = 'email'
     and lower(coalesce(identity_data->>'email', '')) <> v_nue;
  get diagnostics v_correo = row_count;
  return jsonb_build_object('ok', true, 'soltadas', v_soltadas, 'correoActualizado', v_correo);
end;
$$;

revoke all on function public.lincoin_soltar_identidades(uuid, text, text) from public, anon, authenticated;
grant execute on function public.lincoin_soltar_identidades(uuid, text, text) to service_role;

notify pgrst, 'reload schema';
