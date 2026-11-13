-- ════════════════════════════════════════════════════════
--  Aprobar / rechazar cargues y retiros: por UUID y según el rol del equipo.
--
--  DOS PROBLEMAS, UNA MIGRACION
--  1. En producción seguían las funciones con id BIGINT. Los movimientos
--     tienen UUID, así que aprobar o rechazar desde Tesorería fallaba siempre
--     ("la base tiene la versión vieja"). 2026_zz8_tesoreria_uuid.sql las
--     corregía pero nunca se aplicó. Esta migración la reemplaza: trae los
--     mismos cuerpos, por UUID.
--  2. El panel las llama directo desde el navegador, sin pasar por
--     admin-data, y solo miraban users.role = 'admin'. Un miembro de "Solo
--     lectura" o de Cumplimiento podía aprobar un retiro. Ahora exigen el rol
--     del equipo (dueño, operaciones o tesorería) y el país del movimiento,
--     la misma regla de _shared/equipo.ts.
-- ════════════════════════════════════════════════════════

-- ¿Quien llama puede resolver un movimiento de esta moneda en Tesorería?
--
-- Sin equipo configurado (tabla vacía) todo admin sigue como antes. Con el
-- equipo configurado, una cuenta sin fila no resuelve nada: admin-data ya le
-- crea su fila al dueño cuando agrega al primer miembro.
create or replace function public.admin_equipo_permite_tesoreria(p_currency text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_rol text; v_paises text[]; v_activo boolean; v_pais text; v_hay int;
begin
  if not public.is_app_admin() then return false; end if;

  select rol, paises, activo into v_rol, v_paises, v_activo
    from public.admin_miembros where id = auth.uid();
  if not found then
    select count(*) into v_hay from public.admin_miembros;
    return v_hay = 0;
  end if;

  if not v_activo then return false; end if;
  if v_rol = 'dueno' then return true; end if;
  if v_rol not in ('operaciones', 'tesoreria') then return false; end if;

  -- El país sale de la moneda, igual que paisDeMovimiento en admin-data. Lo
  -- que no tiene país se deja ver a quien tenga al menos uno.
  v_pais := case upper(coalesce(p_currency, ''))
    when 'COP' then 'CO' when 'COP_BREB' then 'CO' when 'COP_ACH' then 'CO'
    when 'BRL' then 'BR' when 'MXN' then 'MX'
    when 'USD' then 'US' when 'USDT' then 'US' when 'USDT_TRON' then 'US'
    when 'USDC' then 'US' when 'EURC' then 'US'
    else null end;
  if coalesce(array_length(v_paises, 1), 0) = 0 then return false; end if;
  return v_pais is null or v_pais = any(v_paises);
end;
$$;

revoke all on function public.admin_equipo_permite_tesoreria(text) from public, anon, authenticated;

drop function if exists public.admin_approve_deposit(bigint);
drop function if exists public.admin_reject_deposit(bigint);
drop function if exists public.admin_complete_withdrawal(bigint);
drop function if exists public.admin_reject_withdrawal(bigint, text);

create or replace function public.admin_approve_deposit(p_tx_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_tx record;
begin
  if not public.is_app_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select * into v_tx from public.transactions where id = p_tx_id for update;
  if not found then return jsonb_build_object('error', 'tx_not_found'); end if;
  if not public.admin_equipo_permite_tesoreria(v_tx.currency) then return jsonb_build_object('error', 'forbidden'); end if;
  if v_tx.status <> 'Pendiente' then return jsonb_build_object('error', 'no_pendiente', 'status', v_tx.status); end if;
  perform public._credit_user_balance(v_tx.user_id, v_tx.currency, v_tx.amount::numeric);
  update public.transactions set status = 'Completado' where id = p_tx_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_reject_deposit(p_tx_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_tx record;
begin
  if not public.is_app_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select * into v_tx from public.transactions where id = p_tx_id for update;
  if not found then return jsonb_build_object('error', 'tx_not_found'); end if;
  if not public.admin_equipo_permite_tesoreria(v_tx.currency) then return jsonb_build_object('error', 'forbidden'); end if;
  if v_tx.status <> 'Pendiente' then return jsonb_build_object('error', 'no_pendiente', 'status', v_tx.status); end if;
  update public.transactions set status = 'Rechazado' where id = p_tx_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_complete_withdrawal(p_tx_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_tx record;
begin
  if not public.is_app_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select * into v_tx from public.transactions where id = p_tx_id for update;
  if not found then return jsonb_build_object('error', 'tx_not_found'); end if;
  if not public.admin_equipo_permite_tesoreria(v_tx.currency) then return jsonb_build_object('error', 'forbidden'); end if;
  if v_tx.status <> 'Pendiente' then return jsonb_build_object('error', 'no_pendiente', 'status', v_tx.status); end if;
  update public.transactions set status = 'Completado' where id = p_tx_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_reject_withdrawal(p_tx_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_tx record;
begin
  if not public.is_app_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select * into v_tx from public.transactions where id = p_tx_id for update;
  if not found then return jsonb_build_object('error', 'tx_not_found'); end if;
  if not public.admin_equipo_permite_tesoreria(v_tx.currency) then return jsonb_build_object('error', 'forbidden'); end if;
  if v_tx.status <> 'Pendiente' then return jsonb_build_object('error', 'no_pendiente', 'status', v_tx.status); end if;
  -- Devuelve lo debitado al solicitar el retiro.
  perform public._credit_user_balance(v_tx.user_id, v_tx.currency, v_tx.amount::numeric);
  update public.transactions
     set status = 'Rechazado',
         raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object('rejectReason', coalesce(p_reason, 'Rechazado por administración'))
   where id = p_tx_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_approve_deposit(uuid) from public, anon;
revoke all on function public.admin_reject_deposit(uuid) from public, anon;
revoke all on function public.admin_complete_withdrawal(uuid) from public, anon;
revoke all on function public.admin_reject_withdrawal(uuid, text) from public, anon;
grant execute on function public.admin_approve_deposit(uuid) to authenticated;
grant execute on function public.admin_reject_deposit(uuid) to authenticated;
grant execute on function public.admin_complete_withdrawal(uuid) to authenticated;
grant execute on function public.admin_reject_withdrawal(uuid, text) to authenticated;

notify pgrst, 'reload schema';
