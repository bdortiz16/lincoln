drop policy if exists tx_insert_own_or_admin on public.transactions;

create policy tx_insert_own_or_admin on public.transactions
  for insert to authenticated
  with check (
    public.is_any_admin()
    or (user_id is not null and user_id::text = auth.uid()::text and type <> 'dispersion')
  );

notify pgrst, 'reload schema';
