import { useEffect, useMemo, useState } from 'react'
import { SparklesIcon, StarIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState, Panel, ViewHeader } from '@/components/panel'
import { Field } from '@/components/field'
import { usePipeline } from '@/hooks/use-pipeline'
import { formatDateWithYear } from '@/lib/dates'
import { MAX_EXEMPLARS } from '@/lib/concept-note'
import type { UserSettings } from '@/lib/types'

const PROPOSAL_PLACEHOLDER = `e.g.

Keep the executive summary under one page.
Always price in KES unless the notice says otherwise.
Name the Team Leader in the executive summary, not just the team section.
Do not offer Eval360 to government ministries unless they asked for a platform.
For evaluations, always propose a validation workshop before the final report.`

const BOILERPLATE_PLACEHOLDER = `Verified facts only — these are stated as true in every draft.

Registered name and number: …
Accreditations: …
Countries delivered in: …
Professionals trained (as at 2026): …
Eval360: …
Three reference assignments the drafter may cite: …`

/**
 * Where the drafter is taught what good looks like.
 *
 * This is prompt engineering, not fine-tuning: the text here is prepended to
 * the system prompt on every draft, so a change takes effect on the very next
 * one rather than needing a retrain.
 */
export function SettingsView() {
  const { settings, saveSettings, proposals, rfps, setProposalExemplar } =
    usePipeline()

  const [draft, setDraft] = useState<UserSettings>(settings)
  const [busy, setBusy] = useState(false)

  // Re-seed when the stored settings arrive or change underneath.
  useEffect(() => setDraft(settings), [settings])

  const dirty =
    draft.proposalGuidance !== settings.proposalGuidance ||
    draft.conceptGuidance !== settings.conceptGuidance ||
    draft.boilerplate !== settings.boilerplate

  const rfpTitle = useMemo(() => {
    const map = new Map<string, string>()
    for (const rfp of rfps) map.set(rfp.id, rfp.title)
    return map
  }, [rfps])

  /** Only text-bearing proposals can teach anything — a .docx is opaque here. */
  const usable = useMemo(
    () => proposals.filter((proposal) => proposal.content.trim().length > 0),
    [proposals],
  )
  const exemplars = usable.filter((proposal) => proposal.isExemplar)

  async function handleSave() {
    setBusy(true)
    try {
      await saveSettings(draft)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(id: string, next: boolean) {
    if (next && exemplars.length >= MAX_EXEMPLARS) {
      toast.error(
        `${MAX_EXEMPLARS} examples is the limit — every one is sent with each draft, so more just costs tokens.`,
      )
      return
    }
    try {
      await setProposalExemplar(id, next)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <>
      <ViewHeader
        eyebrow="Drafting"
        title="Proposal guidance"
        description="The Vantage Africa proposal doctrine is already built in — compliance-first rules, evidence discipline, the standard structure, and a method playbook picked per tender. What you add here layers on top of it."
        action={
          <Button onClick={() => void handleSave()} disabled={busy || !dirty}>
            {busy ? 'Saving…' : dirty ? 'Save guidance' : 'Saved'}
          </Button>
        }
      />

      <Panel
        title="House rules — proposals"
        description="Your additions and corrections. These win over the built-in structure, tone and length wherever they disagree — but never over the rule against inventing experience, statistics or credentials. No need to restate the standard sections; add what the drafter keeps getting wrong."
      >
        <Field label="Proposal guidance" htmlFor="proposal-guidance">
          <Textarea
            id="proposal-guidance"
            value={draft.proposalGuidance}
            onChange={(event) =>
              setDraft({ ...draft, proposalGuidance: event.target.value })
            }
            placeholder={PROPOSAL_PLACEHOLDER}
            className="min-h-[200px] w-full font-mono text-[12px] leading-relaxed"
          />
        </Field>
      </Panel>

      <Panel
        title="Organisation boilerplate"
        description="Facts about the institution, reused verbatim in both proposals and concept notes. Anything you put here is treated as true — leave out what you cannot stand behind."
      >
        <Field label="Boilerplate" htmlFor="boilerplate">
          <Textarea
            id="boilerplate"
            value={draft.boilerplate}
            onChange={(event) =>
              setDraft({ ...draft, boilerplate: event.target.value })
            }
            placeholder={BOILERPLATE_PLACEHOLDER}
            className="min-h-[150px] w-full font-mono text-[12px] leading-relaxed"
          />
        </Field>
      </Panel>

      <Panel
        title="House rules — concept notes"
        description="Applies to the unsolicited notes drafted from a lead, which have a different job to a proposal."
      >
        <Field label="Concept note guidance" htmlFor="concept-guidance">
          <Textarea
            id="concept-guidance"
            value={draft.conceptGuidance}
            onChange={(event) =>
              setDraft({ ...draft, conceptGuidance: event.target.value })
            }
            placeholder="e.g. Open with the recipient's mandate, never with our own history. One focus area, not a menu."
            className="min-h-[140px] w-full font-mono text-[12px] leading-relaxed"
          />
        </Field>
      </Panel>

      <Panel
        title="Model answers"
        description={`Star up to ${MAX_EXEMPLARS} proposals to be shown as worked examples. Only ones with text can be used — an uploaded .docx is an opaque file to the drafter, so paste its text on the RFP profile to make it usable.`}
        action={
          <span className="text-[11px] text-faint">
            {exemplars.length} / {MAX_EXEMPLARS} starred
          </span>
        }
      >
        {usable.length === 0 ? (
          <EmptyState
            icon={<SparklesIcon className="size-5" />}
            hint="Draft a proposal, or paste a past winning one on an RFP profile, and it becomes available to star here."
          >
            No text proposals yet
          </EmptyState>
        ) : (
          usable.map((proposal) => (
            <div
              key={proposal.id}
              className="flex items-start gap-3 border-b border-border-soft py-2.5 last:border-b-0"
            >
              <button
                type="button"
                onClick={() => void toggle(proposal.id, !proposal.isExemplar)}
                aria-pressed={proposal.isExemplar}
                aria-label={
                  proposal.isExemplar ? 'Unstar this example' : 'Star as a model answer'
                }
                className={
                  proposal.isExemplar
                    ? 'mt-0.5 cursor-pointer text-warning'
                    : 'mt-0.5 cursor-pointer text-faint transition-colors hover:text-warning'
                }
              >
                <StarIcon
                  className="size-4"
                  fill={proposal.isExemplar ? 'currentColor' : 'none'}
                />
              </button>

              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] text-foreground">
                  {proposal.title || 'Untitled'}
                </p>
                <p className="mt-0.5 text-[11px] text-faint">
                  {rfpTitle.get(proposal.rfpId) ?? 'Unknown tender'} ·{' '}
                  {formatDateWithYear(proposal.createdAt.slice(0, 10))} ·{' '}
                  {proposal.content.length.toLocaleString()} characters
                </p>
              </div>
            </div>
          ))
        )}
      </Panel>
    </>
  )
}
