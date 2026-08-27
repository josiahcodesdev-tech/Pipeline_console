-- Remove expired tenders nobody touched, on a rule rather than by hand.
--
-- WHY THIS EXISTS. The sync adds every notice matching the capability map to
-- every member's tracker. Most are never opened. Nothing removed them, so the
-- tracker only grew: 2,256 rows by the time this was written, of which 691 had
-- already closed and 640 of those had never been touched by anybody. A source
-- of rows with no sink is a source of noise, and the noise is what makes the
-- signal hard to find.
--
-- WHY A FUNCTION AND NOT A DELETE FROM THE CLIENT. The rule is six `not exists`
-- subqueries, which PostgREST cannot express as a filter. Writing it in the
-- Edge Function would mean fetching candidate ids and deleting by id -- two
-- round trips with a gap in the middle where a member could claim a tender that
-- is about to be deleted anyway. Here the test and the delete are one statement.
--
-- WHY IT IS SAFE TO DELETE RATHER THAN HIDE. The sync connectors filter to open
-- notices, so a pruned tender is not re-added by the next morning's run. And
-- `rfps` has no recycle bin -- proposals get thirty days, these get none -- so
-- the guard below is deliberately generous: any sign at all that a person did
-- something keeps the row forever.

create or replace function public.prune_expired_rfps(grace_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed integer;
begin
  -- Refuse a grace of zero. A tender that closed this morning is one a bid team
  -- may still be reading, and a caller passing 0 -- or a null that used to
  -- default to it -- would take the whole week's closures with it.
  if grace_days is null or grace_days < 1 then
    raise exception 'prune_expired_rfps: grace_days must be at least 1, got %', grace_days;
  end if;

  delete from public.rfps r
  where r.deadline is not null
    and r.deadline < current_date - (grace_days || ' days')::interval
    and not (
         -- Somebody put it in a pipeline.
         r.in_pipeline
         -- Somebody moved it past Watching: Preparing, Submitted, Won or Lost.
      or r.status <> 'Watching'
         -- Somebody attached the Terms of Reference, or had them read.
      or coalesce(r.tender_text, '') <> ''
      or coalesce(r.tender_file_name, '') <> ''
         -- Somebody claimed it, firm-wide.
      or exists (
           select 1 from public.rfp_claims c where c.external_id = r.external_id
         )
         -- Somebody wrote a proposal against it.
      or exists (select 1 from public.proposals p where p.rfp_id = r.id)
         -- Somebody logged a call, an email or a note against it.
      or exists (select 1 from public.activities a where a.rfp_id = r.id)
         -- Somebody shared it with a colleague.
      or exists (select 1 from public.rfp_shares s where s.rfp_id = r.id)
    );

  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.prune_expired_rfps(integer) is
  'Deletes tenders whose deadline passed more than grace_days ago and which nobody has claimed, worked, documented, proposed against, logged activity on or shared. Returns the count. Service role only — see the grants below.';

/**
 * Who may run it.
 *
 * `security definer` means this deletes across every member's rows regardless
 * of who calls it, which is exactly what a nightly tidy-up needs and exactly
 * what no browser session should be able to do. The default grant on a new
 * function is EXECUTE to public, so it is revoked and given back only to the
 * service role the sync runs as.
 */
revoke all on function public.prune_expired_rfps(integer) from public;
revoke all on function public.prune_expired_rfps(integer) from anon, authenticated;
grant execute on function public.prune_expired_rfps(integer) to service_role;

notify pgrst, 'reload schema';
