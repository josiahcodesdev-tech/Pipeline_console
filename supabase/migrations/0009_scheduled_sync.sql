-- Pull consultancy and training opportunities into the tracker every morning,
-- unattended.
--
-- Sources are World Bank, UNDP, UNGM, IUCN and AfDB, with ReliefWeb waiting on
-- an approved appname. They are configured in the Edge Function itself, not
-- here — this file only decides WHEN it runs, so adding a source later needs no
-- database change.
--
-- Without this the sync only runs while somebody has the console open. Nobody
-- opens it on a Saturday, so Monday's tracker would be missing the weekend's
-- notices until the first page load — and a deadline can pass in that gap.
--
-- Timing: 02:00 UTC is 05:00 in Nairobi (EAT, UTC+3, no DST). Postgres cron
-- schedules are UTC on Supabase, so the offset is baked into the expression.
--
-- BEFORE RUNNING: replace both placeholders below.
--   <PROJECT_REF>  your project ref (the subdomain of your Supabase URL)
--   <SERVICE_ROLE_KEY>  Project Settings -> API -> service_role
--
-- The service-role key sits in the job definition, readable by anyone with
-- database access. That is the same trust boundary as the key itself, but it is
-- the reason this job is worth deleting if you ever hand out DB credentials.
-- It is also what tells the function to sync EVERY user rather than one: the
-- in-app "Check now" button presents a user token instead and syncs only the
-- person who pressed it.
--
-- Deploy the function first, or the first run 404s:
--   supabase functions deploy sync-opportunities
--
-- Run in the Supabase SQL Editor after 0008. Safe to re-run.
--
-- To stop the morning run without touching the app:
--   select cron.unschedule('sync-opportunities-daily');

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
    -- Six sources are fetched concurrently, but UNGM pages through its results
    -- one request at a time and the insert runs once per user. The default 5s
    -- is nowhere near enough, and a timeout here would look like a silent
    -- no-op rather than a failure.
    timeout_milliseconds := 180000
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
--
-- The function returns a per-source breakdown in its response body, so a run
-- that succeeded overall while one scrape broke is visible there rather than
-- only in the function logs.
