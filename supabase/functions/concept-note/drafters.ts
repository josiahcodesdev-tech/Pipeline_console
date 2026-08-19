/**
 * Which model actually writes the document.
 *
 * Full proposals use OpenAI's flagship GPT model through the Responses API.
 * Anthropic remains an operational fallback when no OpenAI key is configured.
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
  | { type: 'end'; truncated: boolean; refused: boolean }

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

export interface Drafter {
  /** Shown in errors and logs so a bad draft can be traced to a model. */
  readonly label: string
  run(job: DraftJob): AsyncGenerator<DraftEvent>
}

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
  const raw = cause instanceof Error ? cause.message : String(cause)
  if (/overloaded/i.test(raw)) {
    return 'The drafting service is busy right now. Wait a moment and draft again. Anything already written is kept.'
  }
  if (/timeout|aborted|timed out/i.test(raw)) {
    return 'The draft took too long and was cut off. Try again, or attach a shorter tender document.'
  }

  return `Drafting failed: ${raw}`
}

// ------------------------------------------------------------------ Choosing

/**
 * Picks the drafter from whichever key is configured, preferring OpenAI so
 * proposal runs use the flagship GPT model configured above.
 * Returns null when neither is set, which the handler reports as a 500 — that
 * is a deployment fault, not a bad request.
 */
export function selectDrafter(): Drafter | null {
  const openaiKey = Deno.env.get('OPENAI_API_KEY')?.trim()
  if (openaiKey) return openaiDrafter(openaiKey)

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim()
  if (anthropicKey) return anthropicDrafter(anthropicKey)

  return null
}
