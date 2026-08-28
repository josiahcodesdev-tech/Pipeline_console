-- One consultant roster for the firm, readable by every member.
--
-- THE PROBLEM. `consultants` was private per member: `select` was
-- `auth.uid() = user_id`, so each account had its own roster. In practice the
-- firm has one. Dr. Benson Kiarie, Edwin Wekesa Wafula and the rest are the
-- people this business puts forward, named in proposals that have already gone
-- out — not one member's address book.
--
-- What that produced in the live database at the time of this migration:
--
--     super_user     5 consultants
--     admin          1
--     Josiah         1
--     Regina         0
--     Austin         0
--     Hannah         0
--
-- Three of six members had none. The drafter is handed the roster to staff a
-- bid with, so those three were drafting proposals that could name no team at
-- all, and nothing said so — an empty roster and a roster nobody has filled in
-- look identical from inside the prompt.
--
-- THE CHANGE IS READ ONLY. Every active member may now read every consultant.
-- Writes are untouched and were already sensibly scoped: insert and update are
-- your own rows, delete is the super user alone. Sharing a roster is a
-- different act from letting six people edit each other's records, and only the
-- first was asked for.
--
-- `active_members_only` still applies over the top. It is RESTRICTIVE, so it
-- ANDs with everything here: a deactivated account reads nothing, whatever the
-- policies below say.
--
-- WHY NOT COPY THE ROWS TO EACH ACCOUNT INSTEAD. Because then there are six
-- Dr. Benson Kiaries, five of them going stale the moment the first is
-- corrected. The roster is one list; it should be stored as one list.

-- Both previous names. The original from 0010 and the widened one a later
-- migration replaced it with — leaving either in place would OR with the new
-- policy to the same result while telling the next reader that select is
-- admin-or-own, which it is not.
drop policy if exists consultants_select_own on public.consultants;
drop policy if exists consultants_select on public.consultants;

create policy consultants_select_firm on public.consultants
  for select
  to authenticated
  using (true);

comment on policy consultants_select_firm on public.consultants is
  'The consultant roster is a firm asset: every member reads all of it, because every member drafts proposals that must name a team. Writes remain owner-scoped — see migration 0044.';

-- The photograph and CV that go with each consultant.
--
-- These had to move with the rows. A member who can read a consultant record
-- but not its photograph gets a broken image and a CV link that 404s, which
-- reads as data loss rather than as a permission boundary. The write policies
-- are untouched: a file still lands in, and is still removed from, the folder
-- named for whoever owns the consultant.
drop policy if exists consultant_files_select_own on storage.objects;

create policy consultant_files_select_firm on storage.objects
  for select
  to authenticated
  using (bucket_id = 'consultants');

notify pgrst, 'reload schema';
