/**
 * Edge Function: concept-note
 *
 * Drafts a concept note for a lead or an RFP. This exists so the Anthropic API
 * key stays server-side — the browser sends structured context, never a prompt
 * and never a key.
 *
 * Deploy:
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *   supabase functions deploy concept-note
 *
 * JWT verification is left ON (the Supabase default), so only signed-in users
 * of this project can spend tokens here.
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0'

interface ConceptNoteContext {
  kind?: unknown
  org?: unknown
  segment?: unknown
  country?: unknown
  contactRole?: unknown
  notes?: unknown
  rfpTitle?: unknown
  deadline?: unknown
}

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

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return json(
      { error: 'ANTHROPIC_API_KEY is not set on this function.' },
      500,
    )
  }

  let context: ConceptNoteContext
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
  const segment = text(context.segment) || 'Government'
  const country = text(context.country)
  const contactRole = text(context.contactRole)
  const notes = text(context.notes)
  const rfpTitle = text(context.rfpTitle)
  const deadline = text(context.deadline)

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

  const client = new Anthropic({ apiKey })

  try {
    const message = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 8000,
      // A short, well-scoped writing task — low effort keeps it fast and cheap.
      output_config: { effort: 'low' },
      // Recover automatically if a safety classifier declines the request.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: isProposal ? PROPOSAL_PROMPT : CONCEPT_NOTE_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Draft a ${isProposal ? 'proposal' : 'concept note'} using this context:\n\n${details}`,
        },
      ],
    })

    // Check the stop reason before touching content — a refusal leaves it
    // empty (or partial), so indexing straight into content[0] would throw.
    if (message.stop_reason === 'refusal') {
      return json(
        {
          error:
            'The drafting service declined this request. Try rephrasing the notes for this record.',
        },
        422,
      )
    }

    const draft = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n\n')
      .trim()

    if (!draft) {
      return json({ error: 'The drafting service returned an empty note.' }, 502)
    }

    return json({ text: draft }, 200)
  } catch (cause) {
    console.error('concept-note failed', cause)
    const detail = cause instanceof Error ? cause.message : String(cause)
    return json({ error: `Drafting failed: ${detail}` }, 502)
  }
})
