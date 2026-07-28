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
 * House rules, boilerplate and model answers arrive from the client (they are
 * the author's own settings) and are size-capped here regardless.
 */

import OpenAI from 'npm:openai@6.45.0'

/**
 * Matches careercraft-pro's convention. Proposals go into live bids, so if
 * they need more depth, `gpt-4o` is a one-word change here — at roughly 15x
 * the cost per call.
 */
const MODEL = 'gpt-4o-mini'

interface DraftContext {
  kind?: unknown
  org?: unknown
  segment?: unknown
  country?: unknown
  contactRole?: unknown
  notes?: unknown
  rfpTitle?: unknown
  deadline?: unknown
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

const ORGANISATION = `Vantage Africa School of Leadership is a Pan-African institution offering leadership training, Monitoring & Evaluation (M&E), project management, data analysis, and proposal writing training and consultancy to governments, NGOs, corporates, state-owned enterprises, universities and development partners across Africa.`

const HONESTY = `Never invent specific past client names, figures, dates, team members, or credentials that were not supplied to you. Where a detail would strengthen the document but you were not given it, write around it — or mark it clearly as a placeholder in [square brackets] for the author to complete. Do not present a placeholder as fact.

Return only the document itself — no preamble, no commentary, no markdown code fences.`

/** Unsolicited outreach: has to earn attention and justify its own relevance. */
const CONCEPT_NOTE_PROMPT = `You draft business development concept notes for ${ORGANISATION}

Write 350-450 words in a professional, consultative tone — never salesy.

Structure the note as:
1. A brief opening on relevance to the recipient's sector and mandate.
2. A proposed training or consultancy focus area.
3. What Vantage Africa brings (accredited programmes, pan-African delivery footprint, and the Eval360 M&E platform where relevant).
4. A suggested next step, such as a short scoping call.

${HONESTY}`

/**
 * Response to a tender that already exists. Unlike a concept note it does not
 * need to argue for its own relevance — the buyer has already stated the need,
 * so it leads with the response and is structured for evaluators scoring it
 * against criteria.
 */
const PROPOSAL_PROMPT = `You draft proposals responding to RFPs and tenders on behalf of ${ORGANISATION}

Write 500-700 words as a proposal outline the bid team can build on. The buyer has already published a requirement, so do not spend paragraphs justifying why they might need this — respond to what was asked.

Structure it as:
1. Understanding of the requirement — restate what the assignment calls for, in your own words, showing you have read it.
2. Proposed approach and methodology — the phases or workstreams, and what each produces.
3. Deliverables and indicative timeline, keyed to the submission deadline where one is given.
4. Relevant capability — what Vantage Africa brings (accredited programmes, pan-African delivery footprint, the Eval360 M&E platform where relevant).
5. Why Vantage Africa — a short, specific closing tied to this assignment.

Write for an evaluation panel scoring against criteria, not for a general reader. Be concrete about method. Where the RFP title implies a technical requirement you have not been given detail on, flag it in [square brackets] as something the bid team must confirm rather than guessing at it.

${HONESTY}`

function text(value: unknown, limit = 4_000): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

/**
 * The author's own house rules, layered over the base prompt.
 *
 * These win on structure, length and tone — that is the point of writing them.
 * They deliberately do *not* win on honesty: a rule saying "claim ISO
 * certification" must not override the instruction never to invent credentials.
 */
function houseRulesBlock(guidance: string, boilerplate: string): string {
  const parts: string[] = []

  if (guidance) {
    parts.push(`## House rules

The author of this document has written the following rules. Follow them over
the default structure and tone above wherever the two disagree. They do not
override the honesty instructions — if a rule asks you to state something you
have not been given as fact, treat it as a placeholder instead.

${guidance}`)
  }

  if (boilerplate) {
    parts.push(`## Organisation facts

Supplied by the author and safe to state as fact. Use what is relevant; do not
paste the whole block in verbatim, and do not extrapolate beyond it.

${boilerplate}`)
  }

  return parts.join('\n\n')
}

/**
 * Worked examples, shown as style references rather than source material.
 *
 * The explicit warning matters: past proposals are full of real client names,
 * budgets and team members, and a model shown one will happily carry them into
 * a document for a different buyer.
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

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
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

  const guidance = text(context.guidance, MAX_GUIDANCE_CHARS)
  const boilerplate = text(context.boilerplate, MAX_BOILERPLATE_CHARS)
  const examples = (Array.isArray(context.examples) ? context.examples : [])
    .map((example) => text(example, MAX_EXEMPLAR_CHARS))
    .filter(Boolean)
    .slice(0, MAX_EXEMPLARS)

  const details = [
    `${isProposal ? 'Issuing organization' : 'Recipient organization'}: ${org}`,
    `Sector / segment: ${segment}`,
    country ? `Country: ${country}` : null,
    contactRole ? `Likely recipient role: ${contactRole}` : null,
    rfpTitle ? `RFP / tender title: ${rfpTitle}` : null,
    deadline ? `Submission deadline: ${deadline}` : null,
    `Context notes: ${notes || 'None provided.'}`,
  ]
    .filter(Boolean)
    .join('\n')

  // Base prompt first, then the author's rules, then the examples — later
  // sections are the specific ones, and specific should read as refinement of
  // general rather than the other way round.
  const systemPrompt = [
    isProposal ? PROPOSAL_PROMPT : CONCEPT_NOTE_PROMPT,
    houseRulesBlock(guidance, boilerplate),
    examplesBlock(examples),
  ]
    .filter(Boolean)
    .join('\n\n')

  const client = new OpenAI({ apiKey })

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Draft a ${what} using this context:\n\n${details}` },
      ],
      temperature: 0.7,
      // A 700-word proposal is roughly 1,000 tokens; the headroom keeps a long
      // one from being cut mid-sentence. House rules routinely ask for more
      // structure than the default prompt, so they get more room — output
      // tokens are only billed if they are actually produced.
      max_tokens: guidance ? 4000 : 2000,
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
      { text: draft, truncated: choice?.finish_reason === 'length' },
      200,
    )
  } catch (cause) {
    console.error('concept-note failed', cause)
    const detail = cause instanceof Error ? cause.message : String(cause)
    return json({ error: `Drafting failed: ${detail}` }, 502)
  }
})
