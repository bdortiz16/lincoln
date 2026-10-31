-- ════════════════════════════════════════════════════════
--  Aprobar / rechazar cargues y retiros: queda quién lo hizo.
--
--  Con el rol Tesorería operando, "aprobado" ya no alcanza: hay que saber
--  POR QUIÉN. Se guarda en raw_data.resueltoPor (id, correo, nombre), igual
--  que los cargues manuales guardan raw_data.por. admin-data solo le muestra
--  el nombre al dueño; a los demás miembros, si fue él o no.
--
--  Mismos cuerpos que 2026_zz18_tesoreria_rpcs_equipo.sql, más el autor.
-- ════════════════════════════════════════════════════════

create or replace function public._autor_admin()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', auth.uid(),
    'email', (select email from public.users where id = auth.uid()),
    'nombre', coalesce((select nombre from public.admin_miembros where id = auth.uid()),
                       (select full_name from public.users where id = auth.uid())),
    'at', now()
  );
$$;
revoke all on function public._autor_admin() from public, anon, authenticated;

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
declare v_tx record;
begin
  if not public.is_app_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select * into v_tx from public.transactions where id = p_tx_id for update;
  if not found then return jsonb_build_object('error', 'tx_not_found'); end if;
  if not public.admin_equipo_permite_tesoreria(v_tx.currency) then return jsonb_build_object('error', 'forbidden'); end if;
  if v_tx.status <> 'Pendiente' then return jsonb_build_object('error', 'no_pendiente', 'status', v_tx.status); end if;
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
declare v_tx record;
begin
  if not public.is_app_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select * into v_tx from public.transactions where id = p_tx_id for update;
  if not found then return jsonb_build_object('error', 'tx_not_found'); end if;
  if not public.admin_equipo_permite_tesoreria(v_tx.currency) then return jsonb_build_object('error', 'forbidden'); end if;
  if v_tx.status <> 'Pendiente' then return jsonb_build_object('error', 'no_pendiente', 'status', v_tx.status); end if;
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
         raw_data = coalesce(raw_data, '{}'::jsonb)
                    || jsonb_build_object('rejectReason', coalesce(p_reason, 'Rechazado por administración'),
                                          'resueltoPor', public._autor_admin())
   where id = p_tx_id;
  return jsonb_build_object('ok', true);
end;
$$;

notify pgrst, 'reload schema';
