-- Drop the "CareerCraft · " prefix from already-synced rows.
--
-- The source column should name where an opportunity came from — "undp",
-- "reliefweb" — not how it reached the console. Prefixing every row with
-- CareerCraft made the column repeat itself and pushed the useful half out of
-- sight. New rows are written unprefixed; this brings existing ones in line,
-- since the sync deliberately does not overwrite rows it already holds.
--
-- Run in the Supabase SQL Editor after 0005. Safe to re-run: the WHERE clause
-- makes it a no-op once applied.

update public.rfps
set source = btrim(substring(source from char_length('CareerCraft · ') + 1))
where source like 'CareerCraft · %';
