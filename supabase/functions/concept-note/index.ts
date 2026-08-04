/**
 * Edge Function: concept-note
 *
 * Drafts either a concept note (for a lead) or a proposal (for an RFP). This
 * exists so the OpenAI API key stays server-side — the browser sends
 * structured context, never a prompt and never a key.
 *
 * Deploy:
 *   supabase secrets set OPENAI_API_KEY=sk-proj-...
 *   supabase functions deploy concept-note
 *
 * JWT verification is left ON (the Supabase default). Note that this is weaker
 * than it sounds: the project's *anon* key is a valid JWT, so anyone who reads
 * it out of the shipped bundle can call this. Tightening it means rejecting
 * `role: 'anon'` here — not yet done.
 *
 * The prompt doctrine lives in ./prompts.ts and the assignment-specific method
 * in ./playbooks.ts. House rules, boilerplate and model answers arrive from the
 * client (they are the author's own settings) and are size-capped here
 * regardless.
 */

import OpenAI from 'npm:openai@6.45.0'
import { CONCEPT_NOTE_PROMPT, PROPOSAL_PROMPT } from './prompts.ts'
import { selectPlaybooks } from './playbooks.ts'

/**
 * Proposals go into live bids against a full compliance-and-scoring doctrine,
 * so they get the stronger model; concept notes are short outreach and do not
 * justify the cost. Both are one-word changes.
 */
const PROPOSAL_MODEL = 'gpt-4o'
const CONCEPT_NOTE_MODEL = 'gpt-4o-mini'

/**
 * Output ceiling for a proposal.
 *
 * Raised from 8,000, which was capping documents at roughly eight pages while
 * the proposals actually sent run to eighteen. The model was not being brief;
 * it was being cut off. 16,000 is just under gpt-4o's 16,384-token maximum
 * output, and output tokens bill only when produced, so a ceiling that is
 * rarely reached costs nothing.
 */
const PROPOSAL_MAX_TOKENS = 16_000

interface DraftContext {
  kind?: unknown
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

  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    return json({ error: 'OPENAI_API_KEY is not set on this function.' }, 500)
  }

  let context: DraftContext
  try {
    context = await request.json()
  } catch {
    return json({ error: 'Request body must be JSON.' }, 400)
  }

  const org = text(context.org)
  if (!org) {
    return json({ error: 'An organization name is required.' }, 400)
  }

  const isProposal = text(context.kind) === 'proposal'
  const what = isProposal ? 'proposal' : 'concept note'

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
  const roster = isProposal && Array.isArray(context.consultants)
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
  const playbooks = isProposal
    ? selectPlaybooks(`${rfpTitle} ${serviceAreas} ${notes} ${segment}`)
    : []

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
    isProposal ? PROPOSAL_PROMPT : CONCEPT_NOTE_PROMPT,
    ...playbooks.map((playbook) => playbook.body),
    houseRulesBlock(guidance, boilerplate),
    rosterBlock(roster),
    examplesBlock(examples),
  ]
    .filter(Boolean)
    .join('\n\n')

  // Only proposals carry a tender document; a lead has no scope to attach yet.
  const tender = isProposal ? text(context.tenderText, MAX_TENDER_CHARS) : ''

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

You have the published notice only — not the full RFP document, evaluation matrix, company profile, CVs or reference letters. Work from what is here, mark everything else as a placeholder, and list what the bid team must supply in the bid readiness notes.

${details}`
    : `Draft a ${what} using this context:\n\n${details}`

  const client = new OpenAI({ apiKey })

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

          const completion = await client.chat.completions.create({
            model: isProposal ? PROPOSAL_MODEL : CONCEPT_NOTE_MODEL,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: task },
            ],
            temperature: 0.7,
            max_tokens: isProposal ? PROPOSAL_MAX_TOKENS : 2000,
            stream: true,
          })

          let finishReason: string | null = null
          let produced = false

          for await (const chunk of completion) {
            const choice = chunk.choices[0]
            const delta = choice?.delta?.content
            if (delta) {
              produced = true
              controller.enqueue(line({ type: 'delta', text: delta }))
            }
            if (choice?.finish_reason) finishReason = choice.finish_reason
          }

          if (finishReason === 'content_filter') {
            controller.enqueue(line({
              type: 'error',
              message:
                'The drafting service declined this request. Try rephrasing the notes on this record.',
            }))
          } else if (!produced) {
            controller.enqueue(line({
              type: 'error',
              message: `The drafting service returned an empty ${what}.`,
            }))
          } else {
            // Truncation is reported rather than hidden — a proposal that stops
            // mid-sentence should be visibly incomplete, not quietly wrong.
            controller.enqueue(line({ type: 'done', truncated: finishReason === 'length' }))
          }
        } catch (cause) {
          console.error('concept-note stream failed', cause)
          const detail = cause instanceof Error ? cause.message : String(cause)
          // Reported in-band. The response status was already committed as 200
          // the moment the first byte went out, so a thrown error here would
          // otherwise reach the client as nothing but a truncated document.
          controller.enqueue(line({ type: 'error', message: detail }))
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
    const completion = await client.chat.completions.create({
      model: isProposal ? PROPOSAL_MODEL : CONCEPT_NOTE_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task },
      ],
      temperature: 0.7,
      // A full technical proposal with work plan, team, risk and QA tables runs
      // well past the 700 words the old outline aimed at. Output tokens are
      // only billed when produced, so the ceiling costs nothing unused.
      max_tokens: isProposal ? PROPOSAL_MAX_TOKENS : 2000,
    })

    const choice = completion.choices[0]

    if (choice?.finish_reason === 'content_filter') {
      return json(
        {
          error: `The drafting service declined this request. Try rephrasing the notes on this record.`,
        },
        422,
      )
    }

    const draft = choice?.message?.content?.trim() ?? ''
    if (!draft) {
      return json({ error: `The drafting service returned an empty ${what}.` }, 502)
    }

    // Truncation is reported rather than hidden — a proposal that stops
    // mid-sentence should be visibly incomplete, not quietly wrong.
    return json(
      {
        text: draft,
        truncated: choice?.finish_reason === 'length',
        // Surfaced so the author can see which method the draft was written
        // against, and correct the tender's service areas if it picked wrong.
        playbooks: playbooks.map((playbook) => playbook.label),
      },
      200,
    )
  } catch (cause) {
    console.error('concept-note failed', cause)
    const detail = cause instanceof Error ? cause.message : String(cause)
    return json({ error: `Drafting failed: ${detail}` }, 502)
  }
})
