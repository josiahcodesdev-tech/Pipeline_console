alter table public.proposals
  add column if not exists version_no integer not null default 1,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id);
create index if not exists proposals_archive_expiry_idx on public.proposals (archived_at) where archived_at is not null;

with numbered as (
  select id, row_number() over (partition by rfp_id order by created_at, id) as n from public.proposals
) update public.proposals p set version_no = n.n from numbered n where n.id = p.id;

create or replace function public.assign_proposal_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.rfp_id::text, 0));
  select coalesce(max(version_no), 0) + 1 into new.version_no from public.proposals where rfp_id = new.rfp_id;
  return new;
end $$;
drop trigger if exists proposals_assign_version on public.proposals;
create trigger proposals_assign_version before insert on public.proposals for each row execute function public.assign_proposal_version();

create table if not exists public.audit_log (
  id bigint generated always as identity primary key, actor_id uuid references auth.users(id), owner_id uuid,
  table_name text not null, record_id text not null,
  action text not null check (action in ('created','updated','archived','restored','deleted')),
  changed_fields text[] not null default '{}', old_data jsonb, new_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
alter table public.audit_log enable row level security;
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select using (
  public.is_admin() or actor_id = (select auth.uid()) or owner_id = (select auth.uid())
);

create or replace function public.record_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare old_j jsonb; new_j jsonb; act text; owner uuid; fields text[];
begin
  old_j := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  new_j := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  owner := coalesce((new_j->>'user_id')::uuid, (old_j->>'user_id')::uuid);
  if tg_op = 'INSERT' then act := 'created'; fields := array(select jsonb_object_keys(new_j));
  elsif tg_op = 'DELETE' then act := 'deleted'; fields := '{}';
  else
    fields := array(select key from jsonb_each(new_j) where value is distinct from old_j->key);
    if old_j->>'archived_at' is null and new_j->>'archived_at' is not null then act := 'archived';
    elsif old_j->>'archived_at' is not null and new_j->>'archived_at' is null then act := 'restored';
    else act := 'updated'; end if;
  end if;
  insert into public.audit_log(actor_id, owner_id, table_name, record_id, action, changed_fields, old_data, new_data)
  values ((select auth.uid()), owner, tg_table_name, coalesce(new_j->>'id', old_j->>'id'), act, fields, old_j, new_j);
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array array['leads','rfps','tasks','activities','weekly_reports','proposals','consultants'] loop
    execute format('drop trigger if exists audit_%I on public.%I', t, t);
    execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute function public.record_change()', t, t);
  end loop;
end $$;

create or replace function public.empty_expired_proposal_archive() returns integer
language plpgsql security definer set search_path = public as $$
declare removed integer; begin
  delete from public.proposals where archived_at < now() - interval '30 days';
  get diagnostics removed = row_count; return removed;
end $$;
revoke all on function public.empty_expired_proposal_archive() from public, anon, authenticated;

-- pg_cron is enabled by migration 0009. Replacing the named job keeps this
-- migration idempotent in local and preview environments.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'purge-proposal-recycle-bin') then
    perform cron.unschedule('purge-proposal-recycle-bin');
  end if;
  perform cron.schedule('purge-proposal-recycle-bin', '15 2 * * *',
    'select public.empty_expired_proposal_archive()');
end $$;
comment on column public.proposals.archived_at is 'Recycle-bin timestamp; eligible for permanent deletion after 30 days.';
