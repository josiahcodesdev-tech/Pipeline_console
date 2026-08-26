/**
 * Edge Function: concept-note
 *
 * Drafts either a concept note (for a lead) or a proposal (for an RFP). This
 * exists so the model API key stays server-side — the browser sends structured
 * context, never a prompt and never a key.
 *
 * Deploy with either key. Anthropic writes the better proposal and is used when
 * present; OpenAI is the fallback. See ./drafters.ts.
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *   supabase secrets set OPENAI_API_KEY=sk-proj-...
 *   supabase functions deploy concept-note
 *
 * The platform verifies JWT syntax and this function also resolves the bearer
 * token to a real, active user. The public anon key is therefore not enough to
 * spend drafting tokens.
 *
 * The prompt doctrine lives in ./prompts.ts and the assignment-specific method
 * in ./playbooks.ts. House rules, boilerplate and model answers arrive from the
 * client (they are the author's own settings) and are size-capped here
 * regardless.
 */

import {
  CONCEPT_NOTE_PROMPT,
  PERFORMANCE_REPORT_PROMPT,
  TENDER_ANALYSIS_PROMPT,
} from './prompts.ts'
import {
  PROPOSAL_PROMPT,
  proposalTemplate,
  selectUploadedTemplate,
  uploadedTemplateBlock,
} from './proposal-prompt.ts'
import { UPLOADED_TEMPLATES } from './templates.generated.ts'
import { fetchNotice } from './notice.ts'
import { selectPlaybooks } from './playbooks.ts'
import { describeDraftFailure, selectDrafter } from './drafters.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

interface DraftContext {
  kind?: unknown
  /** Assemble the prompt and return it instead of drafting. See below. */
  preview?: unknown
  org?: unknown
  segment?: unknown
  country?: unknown
  contactRole?: unknown
  notes?: unknown
  rfpTitle?: unknown
  deadline?: unknown
  serviceAreas?: unknown
  guidance?: unknown
  boilerplate?: unknown
  examples?: unknown
  /** The people available to staff the bid; see rosterBlock. */
  consultants?: unknown
  /** Text of the tender document, extracted from a PDF by the client. */
  tenderText?: unknown
  /** Opt in to the newline-delimited JSON stream instead of a buffered reply. */
  stream?: unknown
  /**
   * One section of a designed template to fill, with its slots.
   *
   * Present only for kind 'proposal-section'. The client owns the template —
   * it parses it, holds the markup and writes the answers back — so what
   * reaches here is just the words that need writing and how much room each
   * has. See src/documents/template-slots.ts.
   */
  section?: unknown
  slots?: unknown
}

/**
 * Ceilings on the caller-supplied training material. The client already caps
 * these, but the client is a browser — a hand-rolled request could otherwise
 * push a multi-megabyte prompt through this function on the project's key.
 */
const MAX_GUIDANCE_CHARS = 8_000
const MAX_BOILERPLATE_CHARS = 6_000
const MAX_EXEMPLARS = 2

/**
 * How many consultants reach the prompt, and how much of each.
 *
 * The roster is ranked by relevance before it is cut, so a small team all
 * arrives and a larger one arrives shortlisted. Eight is well above the roster
 * this was built for — it is a ceiling that stops a growing team from crowding
 * out the model answers, not a filter meant to bite today.
 */
const MAX_CONSULTANTS = 8
const MAX_CONSULTANT_CHARS = 1_500

/**
 * How much of an attached tender document reaches the prompt.
 *
 * The client already caps extraction at the same figure; this is the server
 * refusing to be talked past it. Sixty thousand characters is roughly fifteen
 * thousand tokens — a large slice of the budget, but a tender the model has
 * actually read is worth more than anything else that could occupy it.
 */
const MAX_TENDER_CHARS = 60_000
const MAX_EXEMPLAR_CHARS = 12_000
const MAX_REQUEST_BYTES = 350_000

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function text(value: unknown, limit = 4_000): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

/**
 * The author's own house rules, layered over the base doctrine.
 *
 * These win on structure, length and emphasis — that is the point of writing
 * them. They deliberately do *not* win on evidence discipline: a rule saying
 * "claim ISO certification" must not override the instruction never to invent
 * credentials.
 */
function houseRulesBlock(guidance: string, boilerplate: string): string {
  const parts: string[] = []

  if (guidance) {
    parts.push(`## House rules

The author of this document has written the following rules. Follow them over
the default structure, tone and length above wherever the two disagree. They do
not override the evidence discipline — if a rule asks you to state something you
have not been given as fact, insert a placeholder instead.

${guidance}`)
  }

  if (boilerplate) {
    parts.push(`## Organisation facts

Supplied by the author and safe to state as fact. Use what is relevant; do not
paste the whole block in verbatim, and do not extrapolate beyond it. Anything
not in here — statistics, accreditations, countries served — is still subject to
the evidence discipline.

${boilerplate}`)
  }

  return parts.join('\n\n')
}

interface RosterEntry {
  name?: unknown
  title?: unknown
  coreExpertise?: unknown
  yearsExperience?: unknown
  sectors?: unknown
  countries?: unknown
  qualifications?: unknown
  taskFit?: unknown
  projectExperience?: unknown
  languages?: unknown
  availability?: unknown
  shortBio?: unknown
}

/**
 * Ranks the roster against the assignment before it is cut to MAX_CONSULTANTS.
 *
 * Deliberately crude — a word-overlap score, not a classifier. It only has to
 * decide who is *most* worth sending when the roster is bigger than the budget;
 * the model does the real matching once they arrive. `taskFit` is weighted
 * highest because it is written in the language of the work rather than of the
 * person, which is exactly what the notice is too.
 */
function rankRoster(roster: RosterEntry[], assignment: string): RosterEntry[] {
  const words = new Set(
    assignment
      .toLowerCase()
      .split(/[^a-z0-9&]+/)
      .filter((word) => word.length > 3),
  )
  if (words.size === 0) return roster.slice(0, MAX_CONSULTANTS)

  const score = (person: RosterEntry) => {
    const weighted = [
      [text(person.taskFit), 3],
      [text(person.coreExpertise), 3],
      [text(person.sectors), 2],
      [text(person.title), 2],
      [text(person.projectExperience), 1],
      [text(person.countries), 1],
    ] as const
    let total = 0
    for (const [field, weight] of weighted) {
      const seen = new Set(field.toLowerCase().split(/[^a-z0-9&]+/))
      for (const word of words) if (seen.has(word)) total += weight
    }
    return total
  }

  return roster
    .map((person, index) => ({ person, score: score(person), index }))
    // Ties keep their original order — the roster arrives sorted by name, and a
    // stable result is easier to reason about than an arbitrary one.
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_CONSULTANTS)
    .map((entry) => entry.person)
}

/**
 * The people available to staff the bid.
 *
 * Without this the team-composition section is written entirely in
 * placeholders. The warning about not inventing people matters as much as the
 * roster does: a model given four consultants and asked for six will invent two
 * more, complete with plausible degrees.
 */
function rosterBlock(roster: RosterEntry[]): string {
  if (roster.length === 0) return ''

  const people = roster
    .map((person) => {
      const lines = [
        `**${text(person.name)}**${text(person.title) ? ` — ${text(person.title)}` : ''}`,
        // Years arrives as a number, which `text` would drop on the floor.
        typeof person.yearsExperience === 'number'
          ? `Years of experience: ${person.yearsExperience}`
          : '',
        text(person.coreExpertise) ? `Core expertise: ${text(person.coreExpertise)}` : '',
        text(person.sectors) ? `Sectors: ${text(person.sectors)}` : '',
        text(person.countries) ? `Countries: ${text(person.countries)}` : '',
        text(person.qualifications) ? `Qualifications: ${text(person.qualifications)}` : '',
        text(person.taskFit) ? `Suited to: ${text(person.taskFit)}` : '',
        text(person.projectExperience) ? `Experience: ${text(person.projectExperience)}` : '',
        text(person.languages) ? `Languages: ${text(person.languages)}` : '',
        text(person.availability) ? `Availability: ${text(person.availability)}` : '',
        text(person.shortBio) ? `Bio: ${text(person.shortBio)}` : '',
      ].filter(Boolean)
      return lines.join('\n').slice(0, MAX_CONSULTANT_CHARS)
    })
    .filter(Boolean)
    .join('\n\n')

  return `## Available consultants

These are the people who can actually be staffed on this assignment. Supplied by
the author and safe to state as fact.

Build the team composition section from them. Match each to the workstreams their
stated expertise and suitability fit, and say why that person fits that role.

Never invent a consultant, a qualification, a degree, an employer or a year that
does not appear below, and never move one person's experience onto another. If the
assignment needs a competence nobody here has, say so plainly: name the role, state
the competence it requires, and list it in the bid readiness notes as a position to
fill. An honest gap with a recruitment plan scores; a fabricated CV loses the
contract and the relationship.

${people}`
}

/**
 * Worked examples, shown as style references rather than source material.
 *
 * The explicit warning matters: past proposals are full of real client names,
 * budgets and team members, and a model shown one will happily carry them into
 * a document for a different buyer — which is precisely the fabrication the
 * doctrine forbids.
 */
function examplesBlock(examples: string[]): string {
  if (examples.length === 0) return ''

  const body = examples
    .map(
      (example, index) =>
        `<example index="${index + 1}">\n${example}\n</example>`,
    )
    .join('\n\n')

  return `## Model answers

Below are documents the author considers good. Imitate their structure, register
and level of detail.

Treat their *content* as off limits: the clients, figures, dates, staff names and
past engagements in them belong to other assignments. Never carry any of those
into this document. Only the writing style transfers.

${body}`
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return json({ error: 'Request body is too large.' }, 413)
  }

  const auth = request.headers.get('authorization') ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim() ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')?.trim() ?? ''
  if (!auth || !supabaseUrl || !anonKey) return json({ error: 'Unauthorized' }, 401)

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return json({ error: 'Unauthorized' }, 401)

  const { data: profile } = await supabase
    .from('profiles')
    .select('active')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile?.active) return json({ error: 'This account does not have access.' }, 403)

  const drafter = selectDrafter()
  if (!drafter) {
    return json(
      { error: 'No drafting key is set on this function. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.' },
      500,
    )
  }

  let context: DraftContext
  try {
    const raw = await request.text()
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return json({ error: 'Request body is too large.' }, 413)
    }
    context = JSON.parse(raw)
  } catch {
    return json({ error: 'Request body must be JSON.' }, 400)
  }

  const org = text(context.org)
  // A performance report is about the author, not about a client.
  if (!org && text(context.kind) !== 'performance-report') {
    return json({ error: 'An organization name is required.' }, 400)
  }

  const kind = text(context.kind)
  const isProposal = kind === 'proposal'
  // A report on the author's own period rather than a document for a client.
  // It takes no playbook, no roster and no tender: its content is the figures
  // block, and anything it cannot read there it must not claim.
  const isPerformanceReport = kind === 'performance-report'
  const isAnalysis = kind === 'tender-analysis'
  /**
   * Filling one section of a designed template rather than writing a document.
   *
   * Shares everything above the task with a proposal — the same doctrine, the
   * same house rules, the same roster and the same refusal to treat a
   * template's figures as evidence — because it is the same bid written into a
   * different container. Only the instruction at the end differs, and the reply
   * comes back as values rather than prose.
   */
  const isSection = kind === 'proposal-section'
  /**
   * Show the assembled prompt instead of writing anything with it.
   *
   * For troubleshooting a draft that came out wrong. The prompt is built from
   * four sources that live in different places — the doctrine in this repo, the
   * playbooks matched from the tender's own words, the house rules and
   * boilerplate typed into Settings, and the starred exemplars — so "why did it
   * say that?" is not answerable by reading any one of them. This returns
   * exactly what the model would have been sent.
   *
   * No model call and no quota: a preview that cost one of the ten hourly
   * proposals would be a preview nobody could afford to use while debugging.
   */
  const isPreview = context.preview === true

  const quotaAction = isSection ? 'proposal-section' : isProposal ? 'proposal' : isAnalysis ? 'tender-analysis' : isPerformanceReport ? 'performance-report' : 'concept-note'
  // A designed proposal is one document and roughly nineteen calls, one per
  // section. Counted at the ordinary rate it would exhaust the hour halfway
  // through the second one, and the failure arrives mid-document — eleven
  // sections written, eight refused, nothing usable. The allowance is per call
  // so it has to be raised to match: this is about six documents an hour,
  // including a retry or two, rather than six times the work.
  const quotaMax = isSection ? 120 : isProposal ? 10 : isPerformanceReport ? 10 : 30
  if (!isPreview) {
    const { data: quotaAllowed, error: quotaError } = await supabase.rpc('consume_api_quota', {
      quota_action: quotaAction,
      max_calls: quotaMax,
      window_seconds: 3600,
    })
    if (quotaError) return json({ error: 'Could not verify the drafting allowance.' }, 503)
    if (!quotaAllowed) return json({ error: `The hourly ${quotaAction} limit has been reached. Try again later.` }, 429)
  }
  const what = isProposal
    ? 'proposal'
    : isPerformanceReport
      ? 'performance report'
      : isAnalysis
        ? 'tender analysis'
        : 'concept note'

  const segment = text(context.segment) || 'Government'
  const country = text(context.country)
  const contactRole = text(context.contactRole)
  const notes = text(context.notes)
  const rfpTitle = text(context.rfpTitle)
  const deadline = text(context.deadline)
  const serviceAreas = text(context.serviceAreas, 500)

  const guidance = text(context.guidance, MAX_GUIDANCE_CHARS)
  const boilerplate = text(context.boilerplate, MAX_BOILERPLATE_CHARS)
  const examples = (Array.isArray(context.examples) ? context.examples : [])
    .map((example) => text(example, MAX_EXEMPLAR_CHARS))
    .filter(Boolean)
    .slice(0, MAX_EXEMPLARS)

  // Proposals only: a concept note has no scope to staff against yet.
  const roster = (isProposal || isSection) && Array.isArray(context.consultants)
    ? rankRoster(
        context.consultants.filter(
          (entry): entry is RosterEntry =>
            typeof entry === 'object' && entry !== null && Boolean(text((entry as RosterEntry).name)),
        ),
        `${rfpTitle} ${serviceAreas} ${notes}`,
      )
    : []

  // Only proposals get a playbook — a concept note is outreach, not a response
  // to a scope, so there is no assignment type to match against yet.
  const playbooks = isProposal || isSection
    ? selectPlaybooks(`${rfpTitle} ${serviceAreas} ${notes} ${segment}`)
    : []

  // The stored reading of the tender, when one has been produced. A proposal
  // written from this rather than from a 99-character title is the difference
  // the analysis pass exists to make.
  const analysis = isProposal || isSection ? text(context.analysis, 8000) : ''

  // Select one template from the assignment's own language. Multiple complete
  // structures in one prompt compete with each other and become less reliable
  // as the library grows.
  const selectedTemplates = isProposal
    ? selectUploadedTemplate(
        UPLOADED_TEMPLATES,
        [org, segment, rfpTitle, serviceAreas, notes, analysis, text(context.tenderText, MAX_TENDER_CHARS)]
          .filter(Boolean)
          .join('\n'),
      )
    : []

  if (isProposal && selectedTemplates.length === 0) {
    return json(
      {
        error:
          'No compiled proposal template is available. Add a supported file to proposal-templates and deploy the concept-note function.',
      },
      500,
    )
  }

  const details = [
    `${isProposal ? 'Issuing organization' : 'Recipient organization'}: ${org}`,
    `Sector / segment: ${segment}`,
    country ? `Country: ${country}` : null,
    contactRole ? `Likely recipient role: ${contactRole}` : null,
    rfpTitle ? `RFP / tender title: ${rfpTitle}` : null,
    serviceAreas ? `Service areas: ${serviceAreas}` : null,
    deadline ? `Submission deadline: ${deadline}` : null,
    `Context notes: ${notes || 'None provided.'}`,
  ]
    .filter(Boolean)
    .join('\n')

  // Doctrine first, then the matched playbook, then the author's rules, then
  // the examples — each layer is more specific than the last, so it reads as
  // refinement rather than contradiction.
  const systemPrompt = [
    isAnalysis
      ? TENDER_ANALYSIS_PROMPT
      : isPerformanceReport
        ? PERFORMANCE_REPORT_PROMPT
        : isProposal || isSection
          ? PROPOSAL_PROMPT
          : CONCEPT_NOTE_PROMPT,
    ...playbooks.map((playbook) => playbook.body),
    houseRulesBlock(guidance, boilerplate),
    // After the house rules on purpose. A template is the firm's document
    // format and the most specific structural statement there is short of the
    // tender itself, so it should be the last word on headings — and each layer
    // here reads as a refinement of the one above it.
    isProposal ? uploadedTemplateBlock(selectedTemplates) : '',
    // Deliberately not in section mode. There the template is the container
    // being written into, not a structure to imitate, and handing the drafter
    // its prose again is an invitation to lift from it.
    rosterBlock(roster),
    examplesBlock(examples),
  ]
    .filter(Boolean)
    .join('\n\n')

  // The notice itself, fetched here because these portals send no CORS header
  // and a browser cannot read them at all. Only for an analysis: it is a
  // network round trip per call, and a proposal is written from the analysis
  // rather than from the raw page.
  let noticeText = ''
  let noticeProblem: string | null = null
  if (isAnalysis) {
    const link = text(context.link, 2000)
    const fetched = await fetchNotice(link)
    noticeText = fetched.text
    noticeProblem = fetched.problem
  }

  // Only proposals carry a tender document; a lead has no scope to attach yet.
  // Read for an analysis as well as a proposal. It was proposal-only, which
  // meant the reading pass could never see an uploaded ToR — the one source
  // that outranks the notice — and reported "no ToR is stored" while holding it.
  const tender =
    isProposal || isAnalysis || isSection ? text(context.tenderText, MAX_TENDER_CHARS) : ''

  // What the model has been given changes what it should do about the gaps, so
  // this is stated either way rather than assuming the thin case. Getting it
  // wrong in the generous direction is the expensive one: told it has the full
  // pack when it does not, the model stops flagging what it was never given and
  // the bid readiness notes go quiet exactly when they matter most.
  const task = isProposal
    ? tender
      ? `Draft a proposal responding to this tender.

The full tender document is reproduced below, after the summary. It is the authority: take the scope, deliverables, evaluation criteria, timelines, mandatory requirements and the buyer's own terminology from it rather than from the summary or from your own assumptions. Where the two disagree, the tender document wins.

Read it for compliance as well as content — page limits, submission method, validity period, required attachments and forms — and list anything it demands that you cannot satisfy from the information supplied in the bid readiness notes.

${details}
---

## Tender document

${tender}`
      : `Draft a proposal responding to this tender.

${
  analysis
    ? 'You do not have the full RFP document, but the notice has been read and analysed for you — that reading is below and is what you should write against. Where it says "Not stated", the notice genuinely does not say: mark it as a placeholder rather than inventing an answer.'
    : 'You have the published notice only — not the full RFP document, evaluation matrix, company profile, CVs or reference letters, and nobody has analysed it. You are working from a title and an organisation name, so say so in the bid readiness notes and keep every specific you cannot evidence as a marked placeholder.'
}

${details}
${analysis ? `\n---\n\n## What this assignment is, as already read\n\n${analysis}` : ''}`
    : isPerformanceReport
      ? `Write a performance report covering the period below.

The figures block is the only source you have. Every number in the report must come from it. Where the block says something is not held, that is a placeholder for the author to supply — never a number to estimate.

${text(context.notes, 12_000) || "No figures were supplied, which makes this report impossible to write honestly. Say so and stop."}`
      : isAnalysis
      ? `Read this opportunity and report what the assignment is.

${details}

${
  tender
    ? `## Uploaded Terms of Reference (authoritative)\n\n${tender}`
    : noticeText
      ? `## The published notice, fetched from its link\n\n${noticeText}`
      : `## No notice text

The notice could not be read${noticeProblem ? `: ${noticeProblem}` : '.'} You have the summary above and nothing more. Say so in your first sentence and answer "Not stated" wherever the summary does not answer the question — do not infer a scope from the title.`
}`
    : `Draft a ${what} using this context:\n\n${details}`

  /**
   * The slots this call has to write, when filling a designed template.
   *
   * Capped because the request arrives from a browser. One section of a real
   * template runs to a few dozen; a hand-rolled request asking for thousands
   * would spend the project's key on one call.
   */
  const slotBriefs = Array.isArray(context.slots)
    ? (context.slots as Array<Record<string, unknown>>).slice(0, 120).map((slot) => ({
        id: text(slot.id, 80),
        kind: text(slot.kind, 40) || 'body',
        original: text(slot.original, 2_000),
        budget: Math.min(4_000, Math.max(24, Number(slot.budget) || 200)),
      }))
    : []

  const sectionTask = `Write one section of the firm's designed proposal template for this tender.

You are not writing a document. You are replacing the words in a layout that already exists: ${slotBriefs.length} pieces of text, each in a fixed place, each with a fixed amount of room. The design does not reflow — a paragraph written where a three-word label belongs breaks the page it sits on.

## Section
${text((context.section as Record<string, unknown>)?.title, 200) || 'Untitled section'}

## Rules for this call
- Answer with one value per slot id below. Every id, exactly once.
- \`kind\` tells you what sort of text belongs there. A \`stat-value\` is a figure or two or three words. A \`card-title\` is a short label. A \`lead\` opens the section. A \`heading\` names it. A \`table-cell\` is a cell, not a sentence.
- \`budget\` is the room available in characters. Treat it as a ceiling, not a target.
- \`original\` is what the template says for a different client. It is there to show you the register, the rhythm and the job each slot does. Its facts are not yours: no figure, client name, country, accreditation, testimonial or past assignment from it may appear in your answer.
- Where this section needs evidence the bid does not have, write the honest marker — [INFORMATION REQUIRED: ...] or [INSERT VERIFIED ...] — in the slot, at the length the slot allows.
- Plain text only. No Markdown, no HTML: these strings go straight into elements that are already styled.

## The tender
${details}
${tender ? `\n## Tender document (authoritative)\n\n${tender}` : ''}
${analysis ? `\n## What this assignment is, as already read\n\n${analysis}` : ''}

## Slots
${slotBriefs
  .map((slot) => `- ${slot.id} | kind: ${slot.kind} | room: ${slot.budget} chars | currently: ${JSON.stringify(slot.original)}`)
  .join('\n')}`

  const job = {
    system: systemPrompt,
    task: isSection ? sectionTask : task,
    // Never heavy. A section is a few hundred words spread over short strings,
    // and the effort that makes a full proposal worth waiting for would spend
    // nineteen times over here for no gain.
    heavy: (isProposal || isPerformanceReport) && !isSection,
  }

  // Everything above is assembly; nothing below it is reached in preview mode.
  // Returned as the two separate messages rather than one blob, because which
  // half a stray instruction landed in is usually the answer being looked for.
  if (isPreview) {
    return json(
      {
        preview: true,
        kind: kind || 'concept-note',
        // The headings the drafter must populate, read out of the doctrine
        // itself so this cannot describe a structure it is no longer given.
        template: isProposal ? proposalTemplate() : [],
        // Which uploaded template is overriding that structure, if any. Named
        // rather than merely counted: a draft that came out in the wrong shape
        // should be traceable to the file that shaped it.
        uploadedTemplates: isProposal
          ? selectedTemplates.map((template) => ({
              name: template.name,
              chars: template.body.length,
            }))
          : [],
        model: drafter.label,
        system: systemPrompt,
        // The section brief when that is what would be sent. Previewing the
        // document task while the button writes sections would answer "why did
        // it say that?" with a prompt nothing was written from.
        task: isSection ? sectionTask : task,
        sources: {
          doctrine: isAnalysis
            ? 'TENDER_ANALYSIS_PROMPT'
            : isPerformanceReport
              ? 'PERFORMANCE_REPORT_PROMPT'
              : isSection
                ? 'PROPOSAL_PROMPT (one template section)'
                : isProposal
                  ? 'PROPOSAL_PROMPT'
                  : 'CONCEPT_NOTE_PROMPT',
          playbooks: playbooks.map((playbook) => playbook.label),
          houseRules: guidance.length,
          boilerplate: boilerplate.length,
          exemplars: examples.length,
          consultants: roster.length,
          tenderText: tender.length,
          analysis: analysis.length,
        },
      },
      200,
    )
  }

  const refusedMessage =
    'The drafting service declined this request. Try rephrasing the notes on this record.'

  /**
   * Filling a template section. Values back, not prose.
   *
   * Placed before the streaming branch because it is neither streamed nor
   * buffered text: the answer is a fixed set of short strings the caller writes
   * into elements it already holds. Nothing downstream of here would know what
   * to do with it.
   */
  if (isSection) {
    if (slotBriefs.length === 0) {
      return json({ error: 'No slots were supplied to fill.' }, 400)
    }
    if (!drafter.fillSlots) {
      // Only reachable when the drafting key belongs to a provider without a
      // structured path. Named rather than described as a generic failure: the
      // fix is a key, and saying which turns a support question into a setting.
      return json(
        { error: `${drafter.label} cannot fill a designed template. This needs an Anthropic key.` },
        501,
      )
    }
    try {
      const values = await drafter.fillSlots(job, slotBriefs)
      // Reported rather than reconciled here. The caller holds the template and
      // knows which element each id belongs to; all this can say is which ids
      // came back, and let the filler decide what a gap means.
      const returned = new Set(values.map((value) => value.id))
      const missing = slotBriefs.filter((slot) => !returned.has(slot.id)).map((slot) => slot.id)
      // Which method this was written against, same as the document path
      // reports. A leadership playbook on an evaluation tender means the
      // service areas need correcting, and that is worth knowing before
      // reading nineteen sections.
      return json(
        {
          values,
          missing,
          model: drafter.label,
          playbooks: playbooks.map((playbook) => playbook.label),
        },
        200,
      )
    } catch (cause) {
      const detail = describeDraftFailure(cause, drafter.label)
      console.error(`concept-note section fill failed (${drafter.label})`, cause)
      return json({ error: detail }, 502)
    }
  }

  /**
   * Streaming is opt-in via `stream: true` in the request body.
   *
   * A full proposal is 8,000 tokens and takes the better part of a minute, so
   * the RFP profile asks for it in order to show the document building. The
   * concept-note dialog does not, and keeping the buffered path intact means
   * that caller needed no changes at all.
   *
   * The wire format is newline-delimited JSON rather than SSE: it carries the
   * trailing metadata (truncation, matched playbooks) and mid-stream failures
   * in the same channel as the text, which `data:` framing would not without
   * inventing event names for both.
   */
  if (context.stream === true) {
    const encoder = new TextEncoder()
    const line = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`)

    const body = new ReadableStream({
      async start(controller) {
        try {
          // Sent first so the client can show which method the draft is being
          // written against while the text is still arriving.
          controller.enqueue(line({
            type: 'meta',
            playbooks: playbooks.map((playbook) => playbook.label),
          }))

          let truncated = false
          let refused = false
          let produced = false

          for await (const event of drafter.run(job)) {
            if (event.type === 'text') {
              produced = true
              controller.enqueue(line({ type: 'delta', text: event.text }))
            } else if (event.type === 'progress') {
              // A heartbeat, not content. Claude reasons for a while before the
              // first word of a long proposal, and the runtime drops a response
              // that stays silent for 150s. Older clients ignore unknown event
              // types, so this is safe to send to any of them.
              controller.enqueue(line({ type: 'ping' }))
            } else {
              truncated = event.truncated
              refused = event.refused
            }
          }

          if (refused) {
            controller.enqueue(line({ type: 'error', message: refusedMessage }))
          } else if (!produced) {
            controller.enqueue(line({
              type: 'error',
              message: `The drafting service returned an empty ${what}.`,
            }))
          } else {
            // Truncation is reported rather than hidden — a proposal that stops
            // mid-sentence should be visibly incomplete, not quietly wrong.
            controller.enqueue(line({ type: 'done', truncated }))
          }
        } catch (cause) {
          console.error(`concept-note stream failed (${drafter.label})`, cause)
          // Reported in-band. The response status was already committed as 200
          // the moment the first byte went out, so a thrown error here would
          // otherwise reach the client as nothing but a truncated document.
          controller.enqueue(line({ type: 'error', message: describeDraftFailure(cause) }))
        } finally {
          controller.close()
        }
      },
    })

    return new Response(body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-store',
      },
    })
  }

  try {
    // The same generator the streaming path uses, collected. Driving both from
    // one source is what stops a buffered draft from behaving differently to a
    // streamed one.
    //
    // This path sends nothing until the document is finished, so it is bounded
    // by the runtime's 150-second idle timeout no matter how the model is
    // driven — a long proposal must use `stream: true`. That is why the
    // progress ticks are dropped here rather than turned into anything: there
    // is no open response for them to keep alive.
    const chunks: string[] = []
    let truncated = false
    let refused = false

    for await (const event of drafter.run(job)) {
      if (event.type === 'text') chunks.push(event.text)
      else if (event.type === 'end') {
        truncated = event.truncated
        refused = event.refused
      }
    }

    if (refused) {
      return json({ error: refusedMessage }, 422)
    }

    const draft = chunks.join('').trim()
    if (!draft) {
      return json({ error: `The drafting service returned an empty ${what}.` }, 502)
    }

    // Truncation is reported rather than hidden — a proposal that stops
    // mid-sentence should be visibly incomplete, not quietly wrong.
    return json(
      {
        text: draft,
        truncated,
        // Surfaced so the author can see which method the draft was written
        // against, and correct the tender's service areas if it picked wrong.
        playbooks: playbooks.map((playbook) => playbook.label),
      },
      200,
    )
  } catch (cause) {
    console.error(`concept-note failed (${drafter.label})`, cause)
    return json({ error: describeDraftFailure(cause) }, 502)
  }
})
