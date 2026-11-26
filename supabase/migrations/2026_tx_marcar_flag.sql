create or replace function public.tx_marcar_flag(p_tx uuid, p_flag text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.transactions
     set raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(p_flag, true)
   where id = p_tx
     and (raw_data ->> p_flag) is null;
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.tx_marcar_flag(uuid, text) from public, anon, authenticated;
grant execute on function public.tx_marcar_flag(uuid, text) to service_role;
