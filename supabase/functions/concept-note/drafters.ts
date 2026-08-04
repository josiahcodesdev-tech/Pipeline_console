/**
 * Which model actually writes the document.
 *
 * The drafter was built on OpenAI and works; Anthropic's Claude Opus 5 is the
 * stronger writer for this job and is what a winning proposal should be written
 * by. Rather than swap one hard dependency for another, this picks whichever
 * key the function has been given — set ANTHROPIC_API_KEY and the next draft is
 * written by Claude with no redeploy of anything else, unset it and the OpenAI
 * path is still there.
 *
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *
 * Anthropic wins when both are present: it is the better model for long,
 * structured, evidence-disciplined prose, which is the whole of this task.
 *
 * Both providers are driven as a *stream* even when the caller wanted a
 * buffered reply. Two reasons: a 16,000-token document is long enough to hit an
 * HTTP idle timeout on a non-streaming request, and one code path for both
 * callers means the buffered and streamed drafts cannot quietly diverge.
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0'
import OpenAI from 'npm:openai@6.45.0'

/** What the drafter emits, in order. Exactly one `end` closes a run. */
export type DraftEvent =
  | { type: 'text'; text: string }
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
 * this has to be well clear of the ~16,000 tokens an eighteen-page proposal
 * needs or the document gets cut off by its own reasoning. Output bills only
 * when produced, so headroom that is never used costs nothing.
 */
const CLAUDE_PROPOSAL_MAX_TOKENS = 32_000
const CLAUDE_NOTE_MAX_TOKENS = 4_000

/**
 * Reasoning depth. Higher settings write better proposals and take longer, and
 * this runs inside an Edge Function with a wall clock — a draft that is still
 * being reasoned about when the request is killed is worth nothing, however
 * good it was going to be. `medium` leaves room for a full-length document to
 * finish. Raise it if drafts land comfortably inside the limit.
 */
const CLAUDE_PROPOSAL_EFFORT = 'medium'
const CLAUDE_NOTE_EFFORT = 'low'

/**
 * Server-side refusal fallback. Claude Opus 5 runs safety classifiers that can
 * decline a request outright; `"default"` lets Anthropic re-run a declined
 * request on a fallback model in the same call rather than handing the bid team
 * an error. Nothing in a training tender should ever trip a classifier, so this
 * is insurance, not a load-bearing path — a declined attempt is not billed.
 */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

function anthropicDrafter(apiKey: string): Drafter {
  const client = new Anthropic({ apiKey })

  return {
    label: `Anthropic ${CLAUDE_MODEL}`,
    async *run(job: DraftJob): AsyncGenerator<DraftEvent> {
      const stream = client.beta.messages.stream({
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
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
      })

      for await (const event of stream) {
        // Opus 5 thinks before it writes. Thinking arrives as its own delta
        // type and is not part of the document — only text_delta is.
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text }
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

const OPENAI_PROPOSAL_MODEL = 'gpt-4o'
const OPENAI_NOTE_MODEL = 'gpt-4o-mini'

/**
 * Just under gpt-4o's 16,384-token output maximum. Unlike Claude this covers
 * the document alone — there is no thinking to leave room for.
 */
const OPENAI_PROPOSAL_MAX_TOKENS = 16_000
const OPENAI_NOTE_MAX_TOKENS = 2_000

function openaiDrafter(apiKey: string): Drafter {
  const client = new OpenAI({ apiKey })
  const model = (heavy: boolean) => (heavy ? OPENAI_PROPOSAL_MODEL : OPENAI_NOTE_MODEL)

  return {
    label: `OpenAI ${OPENAI_PROPOSAL_MODEL}`,
    async *run(job: DraftJob): AsyncGenerator<DraftEvent> {
      const completion = await client.chat.completions.create({
        model: model(job.heavy),
        messages: [
          { role: 'system', content: job.system },
          { role: 'user', content: job.task },
        ],
        temperature: 0.7,
        max_tokens: job.heavy ? OPENAI_PROPOSAL_MAX_TOKENS : OPENAI_NOTE_MAX_TOKENS,
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

// ------------------------------------------------------------------ Choosing

/**
 * Picks the drafter from whichever key is configured, preferring Anthropic.
 * Returns null when neither is set, which the handler reports as a 500 — that
 * is a deployment fault, not a bad request.
 */
export function selectDrafter(): Drafter | null {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim()
  if (anthropicKey) return anthropicDrafter(anthropicKey)

  const openaiKey = Deno.env.get('OPENAI_API_KEY')?.trim()
  if (openaiKey) return openaiDrafter(openaiKey)

  return null
}
