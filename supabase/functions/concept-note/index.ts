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
}

/**
 * Ceilings on the caller-supplied training material. The client already caps
 * these, but the client is a browser — a hand-rolled request could otherwise
 * push a multi-megabyte prompt through this function on the project's key.
 */
const MAX_GUIDANCE_CHARS = 8_000
const MAX_BOILERPLATE_CHARS = 6_000
const MAX_EXEMPLARS = 2
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
    examplesBlock(examples),
  ]
    .filter(Boolean)
    .join('\n\n')

  // The bid team is working from a notice, not the full tender pack, so say so
  // plainly — otherwise the model treats a thin brief as a complete one and
  // stops flagging what it was never given.
  const task = isProposal
    ? `Draft a proposal responding to this tender.

You have the published notice only — not the full RFP document, evaluation matrix, company profile, CVs or reference letters. Work from what is here, mark everything else as a placeholder, and list what the bid team must supply in the bid readiness notes.

${details}`
    : `Draft a ${what} using this context:\n\n${details}`

  const client = new OpenAI({ apiKey })

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
      max_tokens: isProposal ? 8000 : 2000,
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
