-- Asignación ATÓMICA del índice HD de wallets GasFree.
-- Reemplaza el patrón read-then-write (no atómico) del edge function, que
-- permitía que dos usuarios tomaran el MISMO índice → la MISMA wallet GasFree
-- (colisión de direcciones observada entre XATECH y MEXITECH).
--
-- Devuelve el índice recién asignado (== nuevo valor del contador). El primer
-- llamado sin contador previo devuelve 1 (los clientes arrancan en el índice 1;
-- el índice 0 queda reservado a la recaudadora).
create or replace function next_gasfree_index()
returns integer
language plpgsql
as $$
declare
  v integer;
begin
  insert into system_config(key, value)
  values ('gasfree_hd_counter', '1')
  on conflict (key)
  do update set value = ((coalesce(nullif(system_config.value, ''), '0'))::int + 1)::text
  returning value::int into v;
  return v;
end;
$$;

grant execute on function next_gasfree_index() to anon, authenticated, service_role;

-- Refrescar el caché de PostgREST para exponer la RPC de inmediato.
notify pgrst, 'reload schema';
