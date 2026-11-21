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
  if v_tx.status <> 'Pendiente' then return jsonb_build_object('error', 'no_pendiente', 'status', v_tx.status); end if;
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
