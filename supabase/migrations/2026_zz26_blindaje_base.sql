-- ════════════════════════════════════════════════════════
--  Blindaje de la base: lo que el navegador hace directo contra PostgREST.
--
--  Correr DESPUÉS de 2026_zz25_tesoreria_blindaje_2fa.sql (sus funciones de
--  Tesorería ya marcan rpc_confiable, que esto necesita). Idempotente.
--
--  1. ADMIN EN LA BASE = DUEÑO CON 2FA. Para las políticas RLS y los
--     guardianes, "admin" era cualquier cuenta con users.role = 'admin'.
--     Todo el equipo tiene ese rol (los permisos finos viven en
--     admin_miembros y los exige el servidor), así que cualquier miembro
--     —"Solo lectura", un colaborador con una sola casilla, uno dado de baja,
--     uno sin 2FA— podía, con su token, hacer PATCH directo a
--     /rest/v1/users o /rest/v1/transactions sobre filas ajenas: saldos,
--     estados, raw_data. El panel del equipo trabaja por admin-data (llave de
--     servicio), que es donde están los permisos. En la base, admin queda
--     solo el dueño activo con la sesión verificada con 2FA (o cualquier
--     admin si el equipo todavía no está configurado, como en admin-data).
--     Los admins de Personas (admin_role) no cambian.
--
--  2. IDENTIDAD DE LA EMPRESA. Razón social, NIT, documento y representante
--     no estaban entre las columnas protegidas: una empresa ya verificada
--     (KYB aprobado) se los cambiaba con un PATCH a su propia fila, y con eso
--     salían la llave Bre-B, las facturas y los reportes de cumplimiento con
--     otra identidad. Ahora, aprobado el KYB, la app no los cambia (se
--     conserva el valor; los cambia el servidor o el dueño).
--
--  3. cuypay_insert_rx: SECURITY DEFINER, ejecutable por anon, sin uso en el
--     código. Dejaba a cualquiera escribir un "pago recibido" en el historial
--     de cualquier usuario (y el aviso por correo salía desde Lincoin).
--
--  4. Vistas de totales (currency_balances, bank_account_balances) sin
--     security_invoker: saltaban la RLS de transactions y mostraban los
--     totales de toda la plataforma a cualquiera.
--
--  5. Un cliente podía insertar un movimiento propio con owner_user_id de
--     otra persona, que lo veía en su historial.
--
--  6. La analítica del sitio la leía cualquier usuario logueado.
-- ════════════════════════════════════════════════════════

-- ── 1. Admin en la base ─────────────────────────────────────────────────

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

-- Dueño del equipo: su fila activa con rol 'dueno', o el equipo sin
-- configurar (tabla vacía), igual que accesoDe en _shared/equipo.ts.
create or replace function public._es_dueno_equipo()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.admin_miembros m where m.id = auth.uid() and m.activo and m.rol = 'dueno')
      or not exists (select 1 from public.admin_miembros);
$$;
revoke all on function public._es_dueno_equipo() from public, anon, authenticated;

create or replace function public.is_any_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.users u
     where u.id = auth.uid()
       and nullif(to_jsonb(u) ->> 'admin_role', '') is not null
  )
  or (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
    and public._es_dueno_equipo()
    and public._sesion_admin_con_2fa() is null
  );
$$;

create or replace function public.is_admin_with_role(variadic roles text[])
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.users u
     where u.id = auth.uid()
       and (to_jsonb(u) ->> 'admin_role') = any(roles)
  )
  or (
    'super_admin' = any(roles)
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
    and public._es_dueno_equipo()
    and public._sesion_admin_con_2fa() is null
  );
$$;

-- ── 2. Identidad de la empresa tras el KYB ──────────────────────────────

create or replace function public.guard_users_identidad_kyb()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $kyb$
declare
  vieja jsonb := to_jsonb(OLD);
  nueva jsonb := to_jsonb(NEW);
  oldraw jsonb := coalesce(OLD.raw_data, '{}'::jsonb);
  newraw jsonb := coalesce(NEW.raw_data, '{}'::jsonb);
  k text;
  privilegiado boolean := false;
begin
  if session_user in ('postgres', 'supabase_admin') then privilegiado := true; end if;
  begin
    if auth.role() = 'service_role' then privilegiado := true; end if;
  exception when others then null; end;
  if current_setting('lincoin.rpc_confiable', true) = 'on' then privilegiado := true; end if;
  if not privilegiado then
    begin
      if public.is_any_admin() then privilegiado := true; end if;
    exception when others then null; end;
  end if;
  -- Antes de la aprobación el cliente sí completa sus datos.
  if privilegiado or coalesce(vieja ->> 'kyc_status', '') not in ('approved', 'verified') then
    return NEW;
  end if;
  -- Se conserva el valor (no se lanza error): la pantalla del perfil
  -- reenvía estas columnas en cada guardado y un error lo rompería entero.
  foreach k in array array['company_name', 'full_name', 'name', 'tax_id', 'tax_id_type', 'doc_type', 'doc_number',
    'doc_country', 'rep_legal_name', 'rep_first_name', 'rep_last_name', 'rep_doc_type', 'rep_doc_number',
    'rep_doc_country', 'is_pep', 'documents'] loop
    if nueva ? k then nueva := jsonb_set(nueva, array[k], coalesce(vieja -> k, 'null'::jsonb)); end if;
  end loop;
  if jsonb_typeof(newraw) = 'object' then
    foreach k in array array['companyName', 'nit', 'taxId', 'taxIdType', 'documentNumber', 'documentType',
      'document', 'repLegalName', 'repDocType', 'repDocNumber'] loop
      if oldraw ? k then newraw := jsonb_set(newraw, array[k], oldraw -> k); else newraw := newraw - k; end if;
    end loop;
    nueva := jsonb_set(nueva, array['raw_data'], newraw);
  end if;
  NEW := jsonb_populate_record(NEW, nueva);
  return NEW;
end
$kyb$;
revoke all on function public.guard_users_identidad_kyb() from public, anon, authenticated;

drop trigger if exists trg_guard_users_identidad_kyb on public.users;
create trigger trg_guard_users_identidad_kyb
  before update on public.users
  for each row execute function public.guard_users_identidad_kyb();

-- ── 3. cuypay_insert_rx (todas sus firmas) ──────────────────────────────

do $sin_rx$
declare r record;
begin
  for r in
    select p.oid::regprocedure as firma
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'cuypay_insert_rx'
  loop
    execute format('drop function if exists %s', r.firma);
  end loop;
end $sin_rx$;

-- ── 4. Vistas de totales con la RLS de quien consulta ───────────────────

do $vistas$
begin
  if to_regclass('public.currency_balances') is not null then
    execute 'alter view public.currency_balances set (security_invoker = true)';
    execute 'revoke all on public.currency_balances from anon';
  end if;
  if to_regclass('public.bank_account_balances') is not null then
    execute 'alter view public.bank_account_balances set (security_invoker = true)';
    execute 'revoke all on public.bank_account_balances from anon';
  end if;
end $vistas$;

-- ── 5. Movimientos a nombre de otro ─────────────────────────────────────

do $tx_insert$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'transactions' and column_name = 'owner_user_id') then
    execute 'drop policy if exists tx_insert_own_or_admin on public.transactions';
    execute $p$
      create policy tx_insert_own_or_admin on public.transactions
        for insert to authenticated
        with check (
          public.is_any_admin()
          or (user_id is not null and user_id::text = auth.uid()::text
              and (owner_user_id is null or owner_user_id::text = auth.uid()::text)
              and type not in ('dispersion', 'rail_move'))
        )
    $p$;
  end if;
end $tx_insert$;

-- ── 6. Analítica del sitio: solo la lee el dueño ────────────────────────

do $sitio$
begin
  if to_regclass('public.site_events') is not null then
    execute 'drop policy if exists site_events_read on public.site_events';
    execute 'create policy site_events_read on public.site_events for select to authenticated using (public.is_any_admin())';
  end if;
end $sitio$;

-- ── Higiene ──────────────────────────────────────────────────────────────

do $aml$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'evaluate_aml_rules' and p.pronargs = 0) then
    execute 'alter function public.evaluate_aml_rules() set search_path = public, pg_temp';
  end if;
end $aml$;

notify pgrst, 'reload schema';
