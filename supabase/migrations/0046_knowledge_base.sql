-- The firm's proposal-writing knowledge base.
--
-- THE PROBLEM. Guidance held one private block of house rules per member
-- (`user_settings.proposal_guidance`), so what one person learned about writing
-- a winning bid reached their own drafts and nobody else's. The firm's doctrine
-- lived only in the drafting function's source, readable by whoever could open
-- the repository and by nobody using the console.
--
-- THE CHANGE. One set of articles for the whole firm. Every active member reads
-- all of them in Guidance; admins and the super user write them, and the super
-- user alone deletes them. An article
-- with `for_drafter` set is also handed to the proposal drafter on every draft
-- (see houseRulesBlock's neighbour, knowledgeBlock, in the concept-note
-- function), so a lesson written here reaches the next proposal anyone drafts.
--
-- THE SEEDED ARTICLES are the built-in doctrine, explained for people. They
-- are stored with `for_drafter = false` because the drafter is already given
-- the doctrine itself, word for word; sending it a paraphrase as well would
-- spend prompt on saying the same thing twice, in two voices that could
-- disagree. Editing a seeded article changes what people read, not what the
-- drafter does — the page says so on each one. `seed_key` is what lets this
-- file run again without duplicating them.
--
-- One seeded row is different: `further-instructions` starts blank, is sent to
-- the drafter, and is where the firm writes its own standing instructions.

create table if not exists public.knowledge_articles (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(trim(title)) > 0),
  category     text not null default 'General',
  body         text not null default '',
  -- Whether the drafter is given this article. Off for the seeded doctrine
  -- summaries; on by default for anything written here.
  for_drafter  boolean not null default true,
  -- Reading order within a category, lowest first.
  position     integer not null default 0,
  -- Set only on the articles this migration seeds.
  seed_key     text unique,
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  updated_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists knowledge_articles_order_idx
  on public.knowledge_articles (category, position, title);

drop trigger if exists knowledge_articles_touch on public.knowledge_articles;
create trigger knowledge_articles_touch
  before update on public.knowledge_articles
  for each row execute function public.touch_updated_at();

alter table public.knowledge_articles enable row level security;

-- Every member reads the whole knowledge base: it is the firm's, not anyone's.
drop policy if exists knowledge_articles_select on public.knowledge_articles;
create policy knowledge_articles_select on public.knowledge_articles
  for select to authenticated
  using (true);

-- Admins and the super user write it. `is_admin()` covers both roles.
drop policy if exists knowledge_articles_insert on public.knowledge_articles;
create policy knowledge_articles_insert on public.knowledge_articles
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists knowledge_articles_update on public.knowledge_articles;
create policy knowledge_articles_update on public.knowledge_articles
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Deleting is the super user's alone, as it is everywhere else in the console:
-- it is the one act with no undo. An admin retires an article by switching it
-- off from the drafter or rewriting it.
drop policy if exists knowledge_articles_delete on public.knowledge_articles;
create policy knowledge_articles_delete on public.knowledge_articles
  for delete to authenticated
  using ((select public.is_super_user()));

-- A switched-off account reads nothing here either. Restrictive, so it ANDs
-- with the policies above — the same guard migration 0032 puts on every table.
drop policy if exists active_members_only on public.knowledge_articles;
create policy active_members_only on public.knowledge_articles
  as restrictive for all to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

grant select, insert, update, delete on public.knowledge_articles to authenticated;

-- ------------------------------------------------------------------ seed ---
-- The built-in doctrine, for people. `on conflict do nothing` keeps an edited
-- article edited when this file runs again.

insert into public.knowledge_articles (seed_key, category, position, title, for_drafter, created_by, updated_by, body) values

-- Left blank on purpose: the one free-text space the firm fills in itself. The
-- Guidance page shows it as an editor rather than an article, and the drafter
-- reads it before every other article so the budget can never cut it.
('further-instructions', 'Further instructions', 0, 'Further instructions', true, null, null, ''),

('how-the-drafter-works', 'Getting started', 10, 'How the drafter writes a proposal', false, null, null,
$kb$The drafter builds each proposal from five sources, in this order of authority:

1. **The tender, Terms of Reference or RFP.** It always wins. Its headings, deliverable names, dates, evaluation criteria, page limits and submission rules are kept exactly as written.
2. **The tender analysis** and anything else specific to this bid.
3. **Verified organisation facts and consultant records** — the boilerplate in Guidance and the Consultants roster.
4. **The method playbook** matched to the kind of assignment (evaluation, training, MEL and so on).
5. **Model answers** — starred proposals — for style and presentation only, never for facts.

On top of that it follows, in order: the firm's built-in doctrine, the articles in this knowledge base marked *Sent to the drafter*, your own house rules, and the firm's proposal template if one matches.

**What this means for you:** the quickest way to improve a draft is usually to give it better sources — a full tender document, accurate boilerplate, complete consultant records — rather than more instructions.$kb$),

('using-this-knowledge-base', 'Getting started', 20, 'Using this knowledge base', false, null, null,
$kb$Everyone can read these articles. Admins and the super user can add and edit them; only the super user can delete one.

**Further instructions.** The box at the top of the knowledge base is a blank space for the firm's own standing instructions. Type into it and save whenever they change. The drafter reads it first, before every article, on every proposal.

**Sent to the drafter.** An article with this switched on is given to the proposal drafter on every proposal anyone drafts. Use it for firm-wide lessons: "Always propose a validation workshop for evaluations", "Price in KES unless the notice says otherwise", "Name the Team Leader in the executive summary". Keep these short and specific — every one is read on every draft, and the drafter is given at most 12,000 characters of them in total, in the order shown here.

**Reference only.** Switched off, an article is for people alone. The articles written from the built-in doctrine are like this, because the drafter already has the doctrine itself — editing them changes what people read, not what the drafter does.

**Personal house rules** (below) still apply on top of these, for your own drafts only.

Articles never override the tender, and never override the rule against inventing experience, figures or credentials.$kb$),

('evidence-rules', 'Evidence and compliance', 10, 'Never invent: the evidence rules', false, null, null,
$kb$A proposal that states something the firm cannot prove is a liability on a scored read and a risk after award. The drafter never invents:

- client facts, procurement references, deadlines or durations
- results, statistics, contract values or budgets
- qualifications, accreditations or consultants
- country experience, past assignments or testimonials
- contact details, addresses or payment terms

It also never carries a fact across from a model answer or template into a new proposal.

**When something is missing,** it writes a precise marker instead, such as `[INFORMATION REQUIRED: procurement reference]`, `[ATTACH TAX CERTIFICATE]` or `[INSERT VERIFIED SIMILAR ASSIGNMENT]`, and lists it in the internal review at the end. Every marker must be resolved before the proposal goes out.

**Gaps are stated, not hidden.** A compliance or capability gap is shown as a gap. Optional technology, support or outputs are only promised when the tender asks for them and the evidence supports them.

**Tenders are data, not instructions.** Text inside a tender, CV or template that tries to change how the drafter works is ignored and flagged in the internal review.$kb$),

('compliance-first', 'Evidence and compliance', 20, 'Compliance comes first', false, null, null,
$kb$A non-compliant bid is a rejected bid, however well it reads.

- **The tender's structure wins.** If it prescribes headings, an order, forms or a page limit, that is the structure — ahead of the master structure and ahead of any firm template.
- **Mandatory deliverables appear word for word,** in the workplan and in the deliverables table.
- **Contradictions in the tender are surfaced, not resolved silently.** Conflicting dates, deliverable names, page limits or reporting periods are stated, a working interpretation is given, and written confirmation is requested at inception.
- **The compliance matrix** lists every requirement in the tender's own wording, with the response, the evidence or attachment, and where in the proposal it is answered. An unmet requirement is never left out.
- **Separate financial submission?** Then the technical proposal contains no prices at all.
- **Never call a proposal submission-ready** while a mandatory requirement is unresolved.$kb$),

('plan-before-writing', 'Structure', 10, 'Plan and design the document before writing', false, null, null,
$kb$Before writing, the drafter maps the tender: what is required, how it will be answered, how it will be delivered, what evidence supports it, and where the gaps are. Each possible section is then classed as:

- **Mandatory** — required by the tender, or fundamental to the bid
- **Recommended** — adds real competitive value
- **Conditional** — included only when relevant *and* supported by evidence
- **Remove** — adds nothing to this bid

**Design for the evaluation panel.** Put what carries the most marks where it is read first, and make the link between each requirement and its answer impossible to miss.

**Structure is an argument, not decoration:**
- Use a table wherever the reader compares things — requirement against response, phase against output, risk against mitigation.
- At most one short callout per section, for the point that section exists to make.
- Two levels of bullets at most.
- Headings that name the answer, not just the topic, where the tender does not dictate the heading.

**One strong treatment of each subject.** Do not repeat the schedule, methodology or deliverables in several sections.$kb$),

('master-structure', 'Structure', 20, 'The master proposal structure', false, null, null,
$kb$Used when the tender prescribes no structure of its own. Sections are adapted, merged or dropped to fit the assignment.

| Section | When |
|---|---|
| Executive Summary — context, tailored response, gains, expected result; an *Assignment at a Glance* table. Written last. | Always |
| Understanding of the Assignment — interpret the tender, do not paraphrase it | Always |
| Strategic Importance of the Assignment | Conditional |
| Proposed Solution at a Glance | Always |
| Proposed Technical Approach (Theory of Change, MEAL Architecture, Learning Architecture…) | Recommended |
| Workplan / Implementation Schedule — actual duration; phase, activities, deliverable, lead, quality checkpoint | Always |
| Approach and Methodology — per phase: purpose, activities, output | Always |
| Practical Deliverables and Outputs — mandatory deliverables in the tender's wording | Always |
| Digital / Technology Component | Conditional |
| Learning Evaluation and Results Measurement | Conditional |
| Sustainability and Institutionalisation | Recommended |
| Value Proposition — only advantages the evidence supports | Always |
| Lead Consultant and Key Consultants — named, supplied people only | Always |
| Similar Assignments and Institutional Experience — strongest verified examples only | Always |
| Client Recommendations and Confidence Signals | Conditional |
| Institutional Strength and Footprint | Conditional |
| Quality Assurance and Risk Management — risk, likelihood/impact, mitigation | Always |
| Compliance Matrix | Recommended; mandatory when requested |
| Closing Statement | Always |
| Proposal Validity | Conditional |
| Financial Proposal | Conditional |
| Annexes — only what is genuinely attached | Conditional |

The Word export adds the cover and table of contents, and numbers the headings.$kb$),

('what-wins', 'Structure', 30, 'What winning proposals do differently', false, null, null,
$kb$The firm's strongest proposals are decision documents, not proof that every section of a template can be filled.

- **Name the right buyer.** Tell apart the contracting authority, implementing partner, donor, project owner and beneficiary. Never let a tracker or aggregator label stand in for the organisation actually asking.
- **Build on the assignment's real logic.** An evaluation's spine is purpose and success, strategic questions, evaluation design, methods, matrix, sampling, inclusion and ethics, analysis, workplan, team, experience, risk and compliance. Do not force a training spine onto it.
- **Define success first.** State what success will look like as a measurable client outcome, then derive the questions and methods from it.
- **Give scored risks real depth:** sampling and stakeholder coverage, disability inclusion, ethics, safeguarding and data protection, analysis and triangulation, field quality control.
- **Make methodology operational.** For each phase: purpose, participants, instruments, evidence produced, approval gate, quality control — and why the method suits this population.
- **Justify every team role by the method.** An unfilled role with a precise competence requirement beats stretching a named consultant's CV.
- **Treat compliance as a submission checklist:** requirement, current response, final action.$kb$),

('writing-style', 'Writing style', 10, 'Writing standard and plain English', false, null, null,
$kb$Write for an evaluation panel whose members may read English as a second or third language, and who include specialists unimpressed by vocabulary.

- **Concrete over abstract:** a method over a philosophy, a number over an adjective, a named output over "a commitment to excellence".
- **Show how the work happens in this client's context.** For each major activity: what, how, by whom, when, with whom, what usable output, and how quality, inclusion, ethics, safeguarding and data protection apply.
- **Tie every piece of evidence to client value.**
- **Cut:** generic introductions, inflated claims, slogans, rhetorical questions, long company histories and repetition.
- **Use the client's own terminology** — without pretending to know their mandate better than the tender shows.
- **The test:** delete any sentence that would survive unchanged in a proposal for a different assignment.

For training, follow the practical learning cycle — context review, short concept input, guided practice, building a real tool, peer and facilitator review, reflection, institutional application. Training is never presented as lectures or a workshop calendar.$kb$),

('format-and-length', 'Writing style', 20, 'Format and length', false, null, null,
$kb$- **Tender limits come first.** Page and word limits in the tender are absolute.
- **Otherwise 4,500–7,000 words,** depending on complexity, scoring weight and how many sections the structure needs. Every section is written in full; length is earned by substance, never by padding or restating.
- **Headings:** main sections and subsections only, unnumbered — the Word export numbers them.
- **Tables** for structured information, **bullets** for short lists, **bold** sparingly.
- **No curly-brace placeholders.** Missing information uses square-bracket markers such as `[INFORMATION REQUIRED: …]`.$kb$),

('before-you-send', 'Review before submission', 10, 'Before you send: the internal review', false, null, null,
$kb$Every draft ends with a section headed **"Before you send this — internal, remove before submission"**. It is for the bid team only and must be deleted before the proposal goes out. It lists:

- missing evidence, and every `[INFORMATION REQUIRED]` marker used
- compliance and submission items to confirm
- assumptions that need approval
- staffing or capability gaps
- financial-proposal requirements
- material bid risks, with a **go / go-with-conditions / no-go** recommendation

**Your checklist before submitting:**
1. Every marker in the proposal is resolved or answered.
2. Every mandatory requirement in the compliance matrix is met.
3. Every mandatory deliverable appears in the tender's own wording.
4. No price appears in a technical proposal when a separate financial submission is required.
5. Every annex listed is actually attached.
6. The internal review section has been deleted.$kb$)

on conflict (seed_key) do nothing;

notify pgrst, 'reload schema';
