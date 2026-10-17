create or replace function public.raw_data_merge(p_user uuid, p_patch jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update public.users
     set raw_data = coalesce(raw_data, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb)
   where id = p_user;
$$;

create or replace function public.raw_data_set_path(p_user uuid, p_path text[], p_value jsonb, p_merge boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  i int;
  n int := coalesce(array_length(p_path, 1), 0);
  v jsonb := p_value;
begin
  if n = 0 then return; end if;
  select coalesce(raw_data, '{}'::jsonb) into r from public.users where id = p_user for update;
  if not found then return; end if;
  for i in 1 .. n - 1 loop
    if jsonb_typeof(r #> p_path[1:i]) is distinct from 'object' then
      r := jsonb_set(r, p_path[1:i], '{}'::jsonb, true);
    end if;
  end loop;
  if p_merge and jsonb_typeof(r #> p_path) = 'object' and jsonb_typeof(v) = 'object' then
    v := (r #> p_path) || v;
  end if;
  r := jsonb_set(r, p_path, v, true);
  update public.users set raw_data = r where id = p_user;
end;
$$;

create or replace function public.raw_data_merge_self(p_patch jsonb)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then return false; end if;
  update public.users
     set raw_data = coalesce(raw_data, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb)
   where id = auth.uid();
  return found;
end;
$$;

revoke all on function public.raw_data_merge(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.raw_data_set_path(uuid, text[], jsonb, boolean) from public, anon, authenticated;
grant execute on function public.raw_data_merge(uuid, jsonb) to service_role;
grant execute on function public.raw_data_set_path(uuid, text[], jsonb, boolean) to service_role;
revoke all on function public.raw_data_merge_self(jsonb) from public, anon;
grant execute on function public.raw_data_merge_self(jsonb) to authenticated;
