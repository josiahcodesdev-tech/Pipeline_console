-- Atomic per-user limits for paid AI operations.

create table if not exists public.api_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);

create index if not exists api_usage_user_action_time_idx
  on public.api_usage (user_id, action, created_at desc);

alter table public.api_usage enable row level security;
-- No direct policies: callers can consume a quota through the function but
-- cannot inspect, insert or erase the accounting rows themselves.

create or replace function public.consume_api_quota(
  quota_action text,
  max_calls integer,
  window_seconds integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  used integer;
begin
  if caller is null or not public.is_active_user() then
    return false;
  end if;
  if quota_action is null or length(quota_action) > 64
     or max_calls < 1 or max_calls > 1000
     or window_seconds < 60 or window_seconds > 86400 then
    raise exception 'Invalid quota parameters.' using errcode = '22023';
  end if;

  -- Serialize the count-and-insert for this user/action so simultaneous calls
  -- cannot all observe the same remaining slot.
  perform pg_advisory_xact_lock(hashtext(caller::text), hashtext(quota_action));

  select count(*) into used
  from public.api_usage u
  where u.user_id = caller
    and u.action = quota_action
    and u.created_at >= now() - make_interval(secs => window_seconds);

  if used >= max_calls then return false; end if;
  insert into public.api_usage (user_id, action) values (caller, quota_action);
  return true;
end;
$$;

revoke all on function public.consume_api_quota(text, integer, integer) from public;
grant execute on function public.consume_api_quota(text, integer, integer) to authenticated;

notify pgrst, 'reload schema';
