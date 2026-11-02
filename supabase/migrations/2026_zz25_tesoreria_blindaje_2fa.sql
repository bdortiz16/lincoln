-- ════════════════════════════════════════════════════════
--  Tesorería: vuelven los controles que se perdieron y se exige el 2FA.
--
--  1. REGRESIÓN. 2026_zz11_blindaje.sql había blindado aprobar y rechazar
--     retiros: solo filas 'send', y si la fila la insertó el CLIENTE (el
--     guardián la marca insertadoPorCliente y le quita 'debitado'), no se
--     completa ni se le devuelve plata, porque nunca se le descontó.
--     2026_zz18 y 2026_zz19 reescribieron las cuatro funciones a partir de una
--     versión anterior (zz8) y esos controles desaparecieron. Con zz19 vigente,
--     un cliente podía insertar una "solicitud de retiro" falsa por cualquier
--     monto y, si Tesorería la RECHAZABA —la reacción natural ante algo raro—,
--     la base le abonaba ese monto sin haberle descontado nada.
--
--  2. 2FA. El panel llama estas funciones DIRECTO a la base (no pasan por
--     admin-data), así que el "esta sesión pasó el 2FA" que admin-data exige
--     para mover plata no se aplicaba: con la contraseña de alguien de
--     Tesorería, sin el código, se aprobaban cargues. La base ahora lo revisa
--     ella misma con lo mismo que usa el servidor: el session_id del token y
--     las sesiones verificadas que se guardan en users.raw_data.mfaSessions.
--     Una cuenta sin 2FA activo no opera Tesorería.
--
--  Mismos cuerpos que zz19 (equipo, país, resueltoPor), más todo lo anterior.
--  Idempotente.
-- ════════════════════════════════════════════════════════

create or replace function public._sesion_admin_con_2fa()
returns text
language plpgsql stable security definer set search_path = public
as $$
declare v_raw jsonb; v_sid text; v_ok boolean;
begin
  select raw_data into v_raw from public.users where id = auth.uid();
  if coalesce(v_raw ->> 'mfaEnabled', '') <> 'true' then return 'sin_2fa'; end if;
  v_sid := auth.jwt() ->> 'session_id';
  if v_sid is null then return 'sesion_sin_2fa'; end if;
  select exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(v_raw -> 'mfaSessions') = 'array' then v_raw -> 'mfaSessions' else '[]'::jsonb end) e
     where e ->> 'sid' = v_sid
       and coalesce(e ->> 'stage', 'full') = 'full'
       and (e ->> 'at')::timestamptz > now() - interval '24 hours'
  ) into v_ok;
  return case when coalesce(v_ok, false) then null else 'sesion_sin_2fa' end;
exception when others then
  return 'sesion_sin_2fa';
end;
$$;
revoke all on function public._sesion_admin_con_2fa() from public, anon, authenticated;

create or replace function public.admin_approve_deposit(p_tx_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_tx record; v_2fa text;
begin
  if not public.is_app_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  v_2fa := public._sesion_admin_con_2fa();
  if v_2fa is not null then return jsonb_build_object('error', v_2fa); end if;
  select * into v_tx from public.transactions where id = p_tx_id for update;
  if not found then return jsonb_build_object('error', 'tx_not_found'); end if;
  if not public.admin_equipo_permite_tesoreria(v_tx.currency) then return jsonb_build_object('error', 'forbidden'); end if;
  -- Pasados los controles, esta función escribe saldo y estado con su propia
  -- autoridad: los guardianes de users/transactions no la tratan como "la
  -- app" (2026_zz26 deja de considerar admin en la base a quien no es dueño).
  perform set_config('lincoin.rpc_confiable', 'on', true);
  if v_tx.status <> 'Pendiente' then return jsonb_build_object('error', 'no_pendiente', 'status', v_tx.status); end if;
  if v_tx.type is distinct from 'load' then return jsonb_build_object('error', 'no_es_cargue'); end if;
  perform public._credit_user_balance(v_tx.user_id, v_tx.currency, v_tx.amount::numeric);
  update public.transactions
     set status = 'Completado',
         raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object('resueltoPor', public._autor_admin())
   where id = p_tx_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_reject_deposit(p_tx_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_tx record; v_2fa text;
begin
  if not public.is_app_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  v_2fa := public._sesion_admin_con_2fa();
  if v_2fa is not null then return jsonb_build_object('error', v_2fa); end if;
  select * into v_tx from public.transactions where id = p_tx_id for update;
  if not found then return jsonb_build_object('error', 'tx_not_found'); end if;
  if not public.admin_equipo_permite_tesoreria(v_tx.currency) then return jsonb_build_object('error', 'forbidden'); end if;
  -- Pasados los controles, esta función escribe saldo y estado con su propia
  -- autoridad: los guardianes de users/transactions no la tratan como "la
  -- app" (2026_zz26 deja de considerar admin en la base a quien no es dueño).
  perform set_config('lincoin.rpc_confiable', 'on', true);
  if v_tx.status <> 'Pendiente' then return jsonb_build_object('error', 'no_pendiente', 'status', v_tx.status); end if;
  if v_tx.type is distinct from 'load' then return jsonb_build_object('error', 'no_es_cargue'); end if;
  update public.transactions
     set status = 'Rechazado',
         raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object('resueltoPor', public._autor_admin())
   where id = p_tx_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_complete_withdrawal(p_tx_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_tx record; v_2fa text;
begin
  if not public.is_app_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  v_2fa := public._sesion_admin_con_2fa();
  if v_2fa is not null then return jsonb_build_object('error', v_2fa); end if;
  select * into v_tx from public.transactions where id = p_tx_id for update;
  if not found then return jsonb_build_object('error', 'tx_not_found'); end if;
  if not public.admin_equipo_permite_tesoreria(v_tx.currency) then return jsonb_build_object('error', 'forbidden'); end if;
  -- Pasados los controles, esta función escribe saldo y estado con su propia
  -- autoridad: los guardianes de users/transactions no la tratan como "la
  -- app" (2026_zz26 deja de considerar admin en la base a quien no es dueño).
  perform set_config('lincoin.rpc_confiable', 'on', true);
  if v_tx.status <> 'Pendiente' then return jsonb_build_object('error', 'no_pendiente', 'status', v_tx.status); end if;
  if v_tx.type is distinct from 'send' then return jsonb_build_object('error', 'no_es_retiro'); end if;
  if coalesce(v_tx.raw_data ->> 'insertadoPorCliente', '') = 'true' and coalesce(v_tx.raw_data ->> 'debitado', '') <> 'true' then
    return jsonb_build_object('error', 'sin_debito');
  end if;
  update public.transactions
     set status = 'Completado',
         raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object('resueltoPor', public._autor_admin())
   where id = p_tx_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_reject_withdrawal(p_tx_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_tx record; v_2fa text; v_col text; v_devuelve boolean;
begin
  if not public.is_app_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  v_2fa := public._sesion_admin_con_2fa();
  if v_2fa is not null then return jsonb_build_object('error', v_2fa); end if;
  select * into v_tx from public.transactions where id = p_tx_id for update;
  if not found then return jsonb_build_object('error', 'tx_not_found'); end if;
  if not public.admin_equipo_permite_tesoreria(v_tx.currency) then return jsonb_build_object('error', 'forbidden'); end if;
  -- Pasados los controles, esta función escribe saldo y estado con su propia
  -- autoridad: los guardianes de users/transactions no la tratan como "la
  -- app" (2026_zz26 deja de considerar admin en la base a quien no es dueño).
  perform set_config('lincoin.rpc_confiable', 'on', true);
  if v_tx.status <> 'Pendiente' then return jsonb_build_object('error', 'no_pendiente', 'status', v_tx.status); end if;
  if v_tx.type is distinct from 'send' then return jsonb_build_object('error', 'no_es_retiro'); end if;
  v_devuelve := coalesce(v_tx.raw_data ->> 'debitado', '') = 'true'
             or coalesce(v_tx.raw_data ->> 'insertadoPorCliente', '') <> 'true';
  if v_devuelve then
    v_col := coalesce(nullif(v_tx.raw_data ->> 'debitadoCol', ''), v_tx.currency);
    perform public._credit_user_balance(v_tx.user_id, v_col, v_tx.amount::numeric);
  end if;
  update public.transactions
     set status = 'Rechazado',
         raw_data = coalesce(raw_data, '{}'::jsonb)
                    || jsonb_build_object('rejectReason', coalesce(p_reason, 'Rechazado por administración'),
                                          'reembolsado', v_devuelve,
                                          'resueltoPor', public._autor_admin())
   where id = p_tx_id;
  return jsonb_build_object('ok', true, 'reembolsado', v_devuelve);
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
