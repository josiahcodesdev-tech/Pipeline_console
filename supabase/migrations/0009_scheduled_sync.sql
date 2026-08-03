-- Pull the CareerCraft feed into the tracker every morning, unattended.
--
-- Until now the sync only ran while somebody had the console open. Nobody opens
-- it on a Saturday, so Monday's tracker was missing the weekend's tenders until
-- the first page load — and a deadline can pass in that gap.
--
-- Timing: 02:00 UTC is 05:00 in Nairobi (EAT, UTC+3, no DST). Postgres cron
-- schedules are UTC on Supabase, same as Vercel's, so the offset is baked in.
-- CareerCraft scrapes at 01:30 UTC (04:30 EAT), half an hour ahead, so this
-- picks up the same morning's notices rather than yesterday's.
--
-- BEFORE RUNNING: replace both placeholders below.
--   <PROJECT_REF>  your project ref (the subdomain of your Supabase URL)
--   <SERVICE_ROLE_KEY>  Project Settings -> API -> service_role
--
-- The service-role key sits in the job definition, readable by anyone with
-- database access. That is the same trust boundary as the key itself, but it is
-- the reason this job is worth deleting if you ever hand out DB credentials.
--
-- Run in the Supabase SQL Editor after 0008. Safe to re-run.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Unschedule first so re-running this file replaces the job rather than
-- stacking a second copy that would double every morning's work.
do $$
begin
  perform cron.unschedule('sync-opportunities-daily');
exception
  when others then null; -- not scheduled yet
end;
$$;

select cron.schedule(
  'sync-opportunities-daily',
  '0 2 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-opportunities',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb,
    -- The feed can carry 500 rows across several users; the default 5s is not
    -- enough and a timeout here would look like a silent no-op.
    timeout_milliseconds := 120000
  );
  $$
);

-- Check it registered:
--   select jobid, schedule, jobname, active from cron.job;
-- And what happened on the last runs:
--   select start_time, status, return_message
--     from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'sync-opportunities-daily')
--    order by start_time desc limit 10;
