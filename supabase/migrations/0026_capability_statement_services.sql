-- Retag existing tenders with the services the Corporate Capability Statement
-- actually names.
--
-- The sync's service-area labels had grown independently of the statement, so
-- the tracker and the document a client is handed gave two different answers to
-- "what does Vantage Africa do?". normalize.ts now uses the statement's own six
-- headings; this brings the 490 already-tagged rows onto the same vocabulary,
-- because the tracker builds its filter from the values on the rows and a
-- half-renamed set would list both generations side by side.
--
-- Two old labels are removed rather than renamed. "Research & Assessment" and
-- "Climate & Environment" are sectors, not services — a climate tender is
-- biddable only if it also wants evaluation or training, in which case it
-- carries that tag too, and if it does not then the tag was inviting work
-- nobody here sells. Rows left with no tag at all are exactly the rows the new
-- filter should not surface.
--
-- Idempotent: every replace is a no-op once applied, and the cleanup only
-- collapses separators it finds.
--
-- Run after 0025.

-- The order matters. "Training & Capacity Building" has to be rewritten before
-- "Training & Facilitation", or the shorter key rewrites half of it and leaves
-- an orphan fragment behind.
update public.rfps set service_areas =
  replace(service_areas, 'Training & Capacity Building', 'Customized Corporate Training')
  where service_areas like '%Training & Capacity Building%';

update public.rfps set service_areas =
  replace(service_areas, 'Training & Facilitation', 'Customized Corporate Training')
  where service_areas like '%Training & Facilitation%';

update public.rfps set service_areas =
  replace(service_areas, 'Leadership & Governance', 'Leadership & Management Development')
  where service_areas like '%Leadership & Governance%';

update public.rfps set service_areas =
  replace(service_areas, 'Institutional Capacity Building', 'Capacity Building & Organizational Development')
  where service_areas like '%Institutional Capacity Building%';

update public.rfps set service_areas =
  replace(service_areas, 'Capacity Building (broad)', 'Capacity Building & Organizational Development')
  where service_areas like '%Capacity Building (broad)%';

update public.rfps set service_areas =
  replace(service_areas, 'Strategy & Policy', 'Capacity Building & Organizational Development')
  where service_areas like '%Strategy & Policy%';

update public.rfps set service_areas =
  replace(service_areas, 'Strategy & Performance', 'Capacity Building & Organizational Development')
  where service_areas like '%Strategy & Performance%';

update public.rfps set service_areas =
  replace(service_areas, 'Proposal Writing & Fundraising', 'Proposal Writing & Resource Mobilization')
  where service_areas like '%Proposal Writing & Fundraising%';

update public.rfps set service_areas =
  replace(service_areas, 'Digital & AI Skills', 'Digital Learning Solutions')
  where service_areas like '%Digital & AI Skills%';

-- "Monitoring & Evaluation" and the bare "M&E" both become the statement's
-- wording. Longest first, again, so "M&E" cannot eat the longer label — and it
-- cannot, because "Monitoring & Evaluation (MEL)" contains no "M&E" substring:
-- the long form spaces its ampersand and the short form does not.
--
-- The first statement is the one rename in this file whose replacement contains
-- its own search term, so it needs the guard or a second run appends a second
-- "(MEL)". Every other rename here is safe unguarded because no target string
-- contains its source.
--
-- The second is deliberately unguarded. An earlier version skipped rows that
-- already carried the long label, which left a bare "M&E" stranded on any row
-- tagged with both. Replacing unconditionally can produce the service twice
-- instead, and the dedupe at the foot of this file collapses that. It stays
-- idempotent because "Monitoring & Evaluation (MEL)" contains no "M&E"
-- substring — the long form spaces its ampersand and the short form does not.
update public.rfps set service_areas =
  replace(service_areas, 'Monitoring & Evaluation', 'Monitoring & Evaluation (MEL)')
  where service_areas like '%Monitoring & Evaluation%'
    and service_areas not like '%Monitoring & Evaluation (MEL)%';

update public.rfps set service_areas =
  replace(service_areas, 'M&E', 'Monitoring & Evaluation (MEL)')
  where service_areas like '%M&E%';

-- Folded into their nearest service by the same reasoning as normalize.ts:
-- the words still find work, they just no longer claim a practice of their own.
update public.rfps set service_areas =
  replace(service_areas, 'Data & Analysis', 'Monitoring & Evaluation (MEL)')
  where service_areas like '%Data & Analysis%';

update public.rfps set service_areas =
  replace(service_areas, 'Project Management', 'Customized Corporate Training')
  where service_areas like '%Project Management%';

-- Sectors, not services. Dropped outright.
update public.rfps set service_areas =
  replace(replace(service_areas, 'Research & Assessment', ''), 'Climate & Environment', '')
  where service_areas like '%Research & Assessment%'
     or service_areas like '%Climate & Environment%';

-- The renames above can leave a row tagged with the same service twice — a
-- notice that matched both "Strategy & Policy" and "Institutional Capacity
-- Building" now names one service, listed twice — and the drops leave stray
-- separators. Rebuild each list from its distinct parts.
update public.rfps r
   set service_areas = coalesce(cleaned.value, '')
  from (
    select id,
           (select string_agg(distinct trim(part), ', ' order by trim(part))
              from unnest(string_to_array(service_areas, ',')) as part
             where trim(part) <> '') as value
      from public.rfps
     where service_areas <> ''
  ) as cleaned
 where r.id = cleaned.id
   and r.service_areas is distinct from coalesce(cleaned.value, '');

comment on column public.rfps.service_areas is
  'Services this notice touches, comma-separated. The vocabulary is section 4 of the Corporate Capability Statement — see CAPABILITIES in sync-opportunities/normalize.ts, which is the only writer.';
