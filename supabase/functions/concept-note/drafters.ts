/**
 * Which model actually writes the document.
 *
 * Proposals are written by Claude. OpenAI's flagship GPT model through the
 * Responses API remains an operational fallback when no Anthropic key is
 * configured — see selectDrafter for why the order is what it is.
 *
 * Both providers are driven as a *stream* even when the caller wanted a
 * buffered reply. Two reasons: a 16,000-token document is long enough to hit an
 * HTTP idle timeout on a non-streaming request, and one code path for both
 * callers means the buffered and streamed drafts cannot quietly diverge.
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0'
import OpenAI from 'npm:openai@6.45.0'

/**
 * What the drafter emits, in order. Exactly one `end` closes a run.
 *
 * `progress` carries no content. It exists because Claude thinks before it
 * writes, and the Edge Function runtime kills a response that sends nothing for
 * 150 seconds — so the reasoning phase has to be visible on the wire as
 * *something* or the request is cut off before the document begins.
 */
export type DraftEvent =
  | { type: 'text'; text: string }
  | { type: 'progress' }
  /**
   * `fellBackFrom` and `reason` are set only when the primary provider could
   * not serve and the secondary wrote this draft instead. Optional so every
   * existing consumer keeps working without reading them, and present so one
   * that wants to say "written by GPT because Claude is out of credit" can.
   */
  | {
      type: 'end'
      truncated: boolean
      refused: boolean
      fellBackFrom?: string
      reason?: string
    }

export interface DraftJob {
  system: string
  task: string
  /**
   * True for a proposal. Proposals go into live bids against a full
   * compliance-and-scoring doctrine and get the budget to match; concept notes
   * are short outreach and do not justify it.
   */
  heavy: boolean
}

/** One text slot in a designed template, as the drafter sees it. */
export interface SlotBrief {
  id: string
  /** What sort of text belongs here — a label, a lead, a table cell. */
  kind: string
  /** What the template says today. The voice reference, never the content. */
  original: string
  /** Roughly how many characters the design has room for. */
  budget: number
}

export interface Drafter {
  /** Shown in errors and logs so a bad draft can be traced to a model. */
  readonly label: string
  run(job: DraftJob): AsyncGenerator<DraftEvent>
  /**
   * Writes one section of a designed template, slot by slot.
   *
   * A different shape of work from `run`, and deliberately a different method.
   * `run` streams a document; this returns a fixed set of short strings that
   * have to land in specific elements, so it is a structured call with a schema
   * rather than prose to be parsed afterwards. Asking for JSON in a prose
   * stream and hoping works until a proposal contains a brace.
   *
   * Optional because it is not a capability every provider has to have. A
   * drafter without it fails one feature loudly instead of failing the whole
   * function at import time.
   */
  fillSlots?(job: DraftJob, slots: readonly SlotBrief[]): Promise<Array<{ id: string; text: string }>>
}

/**
 * The shape a slot-filling reply must take.
 *
 * An array of pairs rather than an object keyed by slot id, because slot ids
 * are generated — `executive.14` — and a JSON Schema cannot name properties it
 * has never seen. Strict mode needs every property declared, so the ids travel
 * as values.
 */
const SLOT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['values'],
  properties: {
    values: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text'],
        properties: { id: { type: 'string' }, text: { type: 'string' } },
      },
    },
  },
} as const


// ---------------------------------------------------------------- Anthropic

const CLAUDE_MODEL = 'claude-opus-5'

/**
 * Output ceiling for Claude, covering thinking *and* the document.
 *
 * Claude Opus 5 thinks by default and `max_tokens` caps the two together, so
 * this has to leave room for both the full template-length proposal and its
 * reasoning or the document gets cut off — 20,000 truncated real runs. Opus 5
 * allows up to 128,000 and the draft is always streamed, so no HTTP timeout
 * rides on the size of the ceiling. Output bills only when produced, so
 * headroom that is never used costs nothing.
 */
const CLAUDE_PROPOSAL_MAX_TOKENS = 64_000
const CLAUDE_NOTE_MAX_TOKENS = 4_000

/**
 * Reasoning depth. Higher settings write better proposals and take longer, and
 * this runs inside an Edge Function with a wall clock — a draft that is still
 * being reasoned about when the request is killed is worth nothing, however
 * good it was going to be. Measured: `medium` spent 40 seconds thinking before
 * the first word, `low` spends about 7 and leaves that time for writing
 * instead. Raise it only if drafts start landing well inside the limit.
 */
const CLAUDE_PROPOSAL_EFFORT = 'low'
const CLAUDE_NOTE_EFFORT = 'low'

/**
 * Two betas were tried here and both are deliberately gone. Measured against
 * this organisation's key, not assumed — if either is reinstated, test it the
 * same way first, because both fail in ways that look like something else.
 *
 * `fallbacks: "default"` (server-side refusal fallback) was insurance against a
 * safety classifier declining a request. This organisation is not enrolled in
 * that beta, and the rejection comes back as `overloaded_error` — "Overloaded",
 * with no mention of fallbacks. It failed three times out of three while the
 * identical request without the beta succeeded, so every proposal was failing
 * and the error blamed Anthropic's capacity. Nothing in a training tender
 * should trip a classifier anyway.
 *
 * `speed: "fast"` was the answer to the 150-second Edge Function ceiling. This
 * organisation has a fast-mode quota of *zero* tokens per minute, so the
 * request is rejected outright and the draft only ever proceeded by falling
 * back to standard speed — one wasted round trip per proposal for no gain.
 */

function anthropicDrafter(apiKey: string): Drafter {
  // More retries than the SDK's default of two. A proposal is a single
  // expensive request the author is watching, so riding out a busy minute is
  // worth far more here than failing fast would be; the SDK backs off
  // exponentially and only retries the transient statuses.
  const client = new Anthropic({ apiKey, maxRetries: 5 })

  return {
    label: `Anthropic ${CLAUDE_MODEL}`,
    async *run(job: DraftJob): AsyncGenerator<DraftEvent> {
      const stream = client.messages.stream({
        model: CLAUDE_MODEL,
        max_tokens: job.heavy ? CLAUDE_PROPOSAL_MAX_TOKENS : CLAUDE_NOTE_MAX_TOKENS,
        system: job.system,
        messages: [{ role: 'user', content: job.task }],
        // Adaptive is the default on Opus 5; stated so the intent survives a
        // future model change. Note there is deliberately no `temperature` —
        // Opus 5 rejects the sampling parameters outright.
        thinking: { type: 'adaptive' },
        output_config: {
          effort: job.heavy ? CLAUDE_PROPOSAL_EFFORT : CLAUDE_NOTE_EFFORT,
        },
      })

      for await (const event of stream) {
        // Opus 5 thinks before it writes. Thinking arrives as its own delta
        // type and is not part of the document — only text_delta is. Every
        // other event still proves the model is working, and is forwarded as a
        // contentless progress tick so the connection is never idle long
        // enough for the runtime to kill it mid-reasoning.
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text }
        } else {
          yield { type: 'progress' }
        }
      }

      const message = await stream.finalMessage()
      yield {
        type: 'end',
        truncated: message.stop_reason === 'max_tokens',
        refused: message.stop_reason === 'refusal',
      }
    },

    async fillSlots(job: DraftJob, slots: readonly SlotBrief[]) {
      // Streamed, though nothing reads the stream.
      //
      // A schema-constrained reply has no partial state worth showing — half a
      // JSON object is not half an answer — so this waits for the whole message
      // either way. It streams because the SDK refuses a *non*-streaming request
      // whose max_tokens implies it could run past ten minutes, and throws
      // before sending anything: "Streaming is required for operations that may
      // take longer than 10 minutes". A long section computes exactly such a
      // ceiling below, so the buffered call failed on the biggest sections while
      // the small ones went through — the section keeping the previous client's
      // wording being the only visible symptom.
      const stream = client.messages.stream({
        model: CLAUDE_MODEL,
        // Sized from the slots themselves rather than a flat ceiling: a section
        // of eight labels needs a fraction of what one of forty paragraphs
        // does, and asking for the maximum every time pays for silence.
        max_tokens: Math.min(
          32_000,
          Math.max(2_000, slots.reduce((total, slot) => total + slot.budget, 0) * 2),
        ),
        system: job.system,
        messages: [{ role: 'user', content: job.task }],
        thinking: { type: 'adaptive' },
        output_config: {
          effort: CLAUDE_NOTE_EFFORT,
          format: { type: 'json_schema', schema: SLOT_SCHEMA },
        },
      })
      const message = await stream.finalMessage()

      if (message.stop_reason === 'refusal') {
        throw new Error('The model declined to write this section.')
      }
      // A truncated schema response is invalid JSON rather than a short answer,
      // so it fails at the parse below with a message about syntax. Said here
      // instead, where the cause is known.
      if (message.stop_reason === 'max_tokens') {
        throw new Error('This section is longer than one pass allows. Split it.')
      }

      const text = message.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map((block) => block.text)
        .join('')
      const parsed = JSON.parse(text) as { values?: Array<{ id: string; text: string }> }
      return parsed.values ?? []
    },
  }
}

// ------------------------------------------------------------------- OpenAI

const OPENAI_PROPOSAL_MODEL = 'gpt-5.6-sol'
const OPENAI_NOTE_MODEL = 'gpt-4o-mini'

/**
 * Enough for the full proposal plus the reasoning tokens used to plan it. The
 * model supports substantially more, but this cap prevents a runaway draft
 * while leaving ample room beyond the 20,000-token ceiling that truncated
 * real proposal runs.
 */
const OPENAI_PROPOSAL_MAX_TOKENS = 48_000
const OPENAI_NOTE_MAX_TOKENS = 2_000

function openaiDrafter(apiKey: string): Drafter {
  const client = new OpenAI({ apiKey })

  return {
    label: `OpenAI ${OPENAI_PROPOSAL_MODEL}`,
    async *run(job: DraftJob): AsyncGenerator<DraftEvent> {
      if (job.heavy) {
        const stream = await client.responses.create({
          model: OPENAI_PROPOSAL_MODEL,
          instructions: job.system,
          input: job.task,
          reasoning: { effort: 'high' },
          text: { verbosity: 'high' },
          max_output_tokens: OPENAI_PROPOSAL_MAX_TOKENS,
          store: false,
          stream: true,
        })

        let truncated = false
        let refused = false

        for await (const event of stream) {
          if (event.type === 'response.output_text.delta') {
            yield { type: 'text', text: event.delta }
          } else {
            if (event.type === 'response.incomplete') {
              truncated = event.response.incomplete_details?.reason === 'max_output_tokens'
            }
            if (event.type === 'response.refusal.delta') refused = true
            yield { type: 'progress' }
          }
        }

        yield { type: 'end', truncated, refused }
        return
      }

      const completion = await client.chat.completions.create({
        model: OPENAI_NOTE_MODEL,
        messages: [
          { role: 'system', content: job.system },
          { role: 'user', content: job.task },
        ],
        temperature: 0.7,
        max_tokens: OPENAI_NOTE_MAX_TOKENS,
        stream: true,
      })

      let finishReason: string | null = null

      for await (const chunk of completion) {
        const choice = chunk.choices[0]
        const delta = choice?.delta?.content
        if (delta) yield { type: 'text', text: delta }
        if (choice?.finish_reason) finishReason = choice.finish_reason
      }

      yield {
        type: 'end',
        truncated: finishReason === 'length',
        refused: finishReason === 'content_filter',
      }
    },
  }
}

// ------------------------------------------------------------------- Failures

/**
 * Turns a provider failure into something the bid team can act on.
 *
 * Without this the SDK's own message reaches the screen, and that message is
 * the raw JSON error body — `{"type":"error","error":{"type":"overloaded_error"
 * ...}}` — which tells the author nothing except that something broke. What
 * they need to know is whether to press the button again, wait, or fix a
 * setting.
 */
export function describeDraftFailure(cause: unknown): string {
  const status = (cause as { status?: number })?.status
  const message = cause instanceof Error ? cause.message : String(cause)

  // Read before the status switch, because both of these arrive as a 400 and
  // the generic 400 advice below — "usually an over-long tender document" —
  // sends the reader to remove the one attachment that makes the draft good.
  //
  // A spent balance is the failure that looks most like a bug: every section
  // fails, all at once, on a bid that drafted fine yesterday, and nothing in a
  // proposal about credit says so. It stopped a whole 232-slot proposal once
  // and was diagnosed from the Edge Function logs rather than from here.
  if (/credit balance is too low|billing|purchase credits|quota/i.test(message)) {
    return 'The Anthropic account is out of credit, so nothing could be written. Top it up in Plans & Billing, then draft again — no other setting is wrong.'
  }
  // Thrown by the SDK before any request is sent, so it costs nothing and is
  // entirely ours to fix; naming it stops it being read as a model failure.
  if (/streaming is required/i.test(message)) {
    return 'This section asked for more room than one buffered request allows. Deploy the concept-note function — the fix is in the code, not the bid.'
  }

  switch (status) {
    case 429:
      return 'The drafting service is rate-limited right now. Wait a minute and draft again.'
    case 529:
    case 500:
    case 502:
    case 503:
      return 'The drafting service is busy right now. Wait a moment and draft again. Anything already written is kept.'
    case 401:
    case 403:
      return 'The drafting service rejected the API key. Check the key set on the concept-note function.'
    case 400:
      return 'The drafting service rejected the request. This is usually an over-long tender document — try removing the attachment and drafting again.'
  }

  // Anthropic reports an overloaded upstream inside the body on some paths,
  // where there is no status to switch on.
  if (/overloaded/i.test(message)) {
    return 'The drafting service is busy right now. Wait a moment and draft again. Anything already written is kept.'
  }
  if (/timeout|aborted|timed out/i.test(message)) {
    return 'The draft took too long and was cut off. Try again, or attach a shorter tender document.'
  }

  return `Drafting failed: ${message}`
}

// ------------------------------------------------------------------ Choosing

/**
 * Picks the drafter from whichever key is configured, preferring Claude.
 *
 * Order matters and only the first configured key is ever used — this is a
 * choice of provider, not a chain that retries the other one. So with both keys
 * set, whichever is named first is the only one that drafts.
 *
 * Claude leads because it writes the better proposal, which is what index.ts
 * has documented since this function was written; the order had drifted to
 * OpenAI-first without that note being updated, so the file said one thing and
 * did another. Anything relying on GPT should say so here rather than by
 * reordering silently.
 *
 * Returns null when neither is set, which the handler reports as a 500 — that
 * is a deployment fault, not a bad request.
 */
/**
 * Is this failure the provider being unable to serve, rather than the request
 * being wrong?
 *
 * The distinction is the whole basis of failing over. "Your credit balance is
 * too low", a revoked key and a rate limit all mean *this account cannot serve
 * anything right now*, and the other provider would do fine. A malformed
 * request or a refusal means the work itself is the problem, and sending the
 * same broken job to a second provider just buys a second copy of the error at
 * twice the latency.
 *
 * Billing is the case worth spelling out. Anthropic reports a spent balance as
 * **400**, not 402 or 429 — so status alone misfiles it as "bad request", which
 * is exactly how an unpaid account came to look like a bug in this function.
 * The message is what distinguishes it, so the message is what gets read.
 */
export function providerUnavailable(error: unknown): string | null {
  const status = (error as { status?: unknown } | null)?.status
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  const lower = message.toLowerCase()

  // Billing, whatever status it arrives under. Checked before status so a 400
  // carrying a credit message is read as billing rather than as a bad request.
  if (
    lower.includes('credit balance is too low') ||
    lower.includes('billing') ||
    lower.includes('insufficient_quota') ||
    lower.includes('exceeded your current quota')
  ) {
    return 'the account is out of credit'
  }

  if (typeof status === 'number') {
    if (status === 401 || status === 403) return 'the API key was rejected'
    if (status === 429) return 'rate-limited'
    if (status >= 500) return `the provider returned ${status}`
    return null // 400 and friends: our request, not their availability.
  }

  // No status at all is a transport failure — DNS, TLS, a dropped socket.
  // The other provider is on different infrastructure and may well be up.
  if (lower.includes('fetch failed') || lower.includes('network') || lower.includes('timeout')) {
    return 'the provider could not be reached'
  }
  return null
}

/**
 * Two drafters, the second used only when the first cannot serve.
 *
 * WHY THIS IS NOT THE FALLBACK THAT WAS REMOVED
 * The earlier one wrapped *every* primary failure, so "ANTHROPIC_API_KEY is not
 * configured" came back wearing OpenAI's error message and sent people to check
 * the wrong key. Two rules keep that from happening again:
 *
 *   1. Only `providerUnavailable` failures fail over. A misconfiguration or a
 *      malformed request is reported by the provider that had it, as itself.
 *   2. When both fail, the PRIMARY's error is what propagates. The secondary's
 *      is attached to it, never substituted for it. Whoever reads the message
 *      is told which provider they actually need to fix.
 *
 * A successful failover is not silent either: it logs, and it marks the `end`
 * event, so a run that quietly cost twice as long has something to show for it.
 */
function failoverDrafter(primary: Drafter, secondary: Drafter): Drafter {
  return {
    label: `${primary.label} → ${secondary.label}`,

    async *run(job: DraftJob) {
      let started = false
      try {
        for await (const event of primary.run(job)) {
          // Once text is on the wire the caller has a partial document, and
          // restarting on the other provider would splice two different voices
          // into one draft. Past this point the run belongs to the primary.
          if (event.type === 'text') started = true
          yield event
        }
        return
      } catch (cause) {
        const reason = providerUnavailable(cause)
        if (started || !reason) throw cause
        console.error(`[drafter] ${primary.label} unavailable (${reason}); trying ${secondary.label}`)

        try {
          for await (const event of secondary.run(job)) {
            yield event.type === 'end' ? { ...event, fellBackFrom: primary.label, reason } : event
          }
        } catch (secondaryCause) {
          // The primary's failure is the one that needs fixing. Say so, and
          // carry the secondary's as context rather than in its place.
          throw new Error(
            `${primary.label} unavailable (${reason}), and ${secondary.label} also failed: ` +
              `${(secondaryCause as { message?: string })?.message ?? secondaryCause}`,
            { cause },
          )
        }
      }
    },

    async fillSlots(job: DraftJob, slots: readonly SlotBrief[]) {
      if (!primary.fillSlots) {
        if (!secondary.fillSlots) throw new Error('Neither provider can fill template slots.')
        return secondary.fillSlots(job, slots)
      }
      try {
        return await primary.fillSlots(job, slots)
      } catch (cause) {
        const reason = providerUnavailable(cause)
        if (!reason || !secondary.fillSlots) throw cause
        console.error(`[drafter] ${primary.label} unavailable (${reason}); trying ${secondary.label}`)
        try {
          return await secondary.fillSlots(job, slots)
        } catch (secondaryCause) {
          throw new Error(
            `${primary.label} unavailable (${reason}), and ${secondary.label} also failed: ` +
              `${(secondaryCause as { message?: string })?.message ?? secondaryCause}`,
            { cause },
          )
        }
      }
    },
  }
}

/**
 * The drafter to use, given whichever keys are configured.
 *
 * Claude stays first when both are present: the prompts, the doctrine and the
 * schemas were written against it, and failing over is a degradation accepted
 * to keep working rather than a free choice between equals. With only one key
 * set there is nothing to fail over to, and that provider's own errors are
 * reported as its own — which is the case the old wrapper got wrong.
 */
export function selectDrafter(): Drafter | null {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim()
  const openaiKey = Deno.env.get('OPENAI_API_KEY')?.trim()

  if (anthropicKey && openaiKey) {
    return failoverDrafter(anthropicDrafter(anthropicKey), openaiDrafter(openaiKey))
  }
  if (anthropicKey) return anthropicDrafter(anthropicKey)
  if (openaiKey) return openaiDrafter(openaiKey)
  return null
}
