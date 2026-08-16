-- What a display name may contain, enforced by the database.
--
-- The console already refuses markup in a name: the sign-in field whitelists
-- what a username is made of, and manage-members validates the pair before it
-- creates an account. Neither covers this table.
--
-- `profiles` is writable directly by its owner — that is the point of the
-- self-service rename in migration 0013 — so a member's own row can be PATCHed
-- straight through PostgREST with whatever the caller likes, without passing
-- through any function this project controls. A check in TypeScript is a
-- message for the person filling in the form; this is the rule.
--
-- Names are otherwise left alone. Apostrophes, accents, hyphens and periods are
-- all ordinary in real names and all permitted; what is refused is the markup
-- and control characters that make a name into something other than a name.
--
-- NOT VALID deliberately: it binds every insert and update from here on without
-- re-checking rows already stored, so applying this can never fail on a name
-- somebody entered before the rule existed. Run VALIDATE CONSTRAINT later if
-- the existing rows are worth confirming.

alter table public.profiles
  drop constraint if exists profiles_full_name_charset;

alter table public.profiles
  add constraint profiles_full_name_charset
  check (full_name !~ '[<>{}\\|`]' and full_name !~ '[\x00-\x1F\x7F]')
  not valid;

comment on constraint profiles_full_name_charset on public.profiles is
  'A display name carries no markup or control characters. Mirrors identityProblem() in supabase/functions/manage-members.';
