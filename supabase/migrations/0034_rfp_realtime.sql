-- Keep open dashboards aligned when an admin refreshes the firm-wide pool.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'rfps'
  ) then
    alter publication supabase_realtime add table public.rfps;
  end if;
end;
$$;
