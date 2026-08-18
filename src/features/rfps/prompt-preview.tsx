import { useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/utils'
import type { PromptPreview, TemplateSection } from '@/services/concept-note'

/**
 * The prompt the drafter would be given, shown before it is given.
 *
 * Built for the question "why did it write that?", which reading the doctrine
 * cannot answer on its own. What reaches the model is four sources merged —
 * the doctrine in the Edge Function, the playbooks matched from this tender's
 * own words, the house rules and boilerplate typed into Settings, and the
 * starred exemplars — and a surprise in the output usually traces to one of
 * them being longer, shorter or absent rather than to the model.
 *
 * The two messages are kept apart rather than concatenated, because which of
 * them an instruction landed in is normally the thing being looked for: the
 * system message is the standing method, the task is this record.
 */

/** Character counts read better as "3.4k" than as 3,412 at this size. */
function short(count: number): string {
  if (count === 0) return 'none'
  if (count < 1000) return `${count} chars`
  return `${(count / 1000).toFixed(1)}k chars`
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-[11px] uppercase tracking-wider text-faint">{label}</span>
      <span className={muted ? 'text-[12px] text-muted-foreground' : 'text-[12px] text-foreground'}>
        {value}
      </span>
    </div>
  )
}

function Message({ title, body }: { title: string; body: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(body)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('The browser would not allow copying. Select the text instead.')
    }
  }

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-medium text-foreground">
          {title} <span className="text-faint">· {short(body.length)}</span>
        </h3>
        <Button variant="ghost" size="sm" onClick={copy} className="h-6 px-2 text-[11px]">
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {/* Pre-wrapped and scrollable: this is the literal text sent, and
          reflowing it would hide exactly the blank lines and headings that
          make a prompt behave the way it does. */}
      <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-foreground">
        {body || '(empty)'}
      </pre>
    </div>
  )
}

export function PromptPreviewDialog({
  preview,
  open,
  onOpenChange,
}: {
  preview: PromptPreview | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[860px]">
        <DialogHeader>
          <DialogTitle>What the drafter will be sent</DialogTitle>
          <DialogDescription>
            The assembled prompt for this record. Nothing was written and no
            drafting allowance was used.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">Reading…</p>
        ) : (
          <div className="space-y-4">
            {/* First, because it is the question people arrive with: what shape is
                the document going to be? The prompt below answers why. */}
            <ProposalTemplate sections={preview.template} />
            <div className="rounded-lg border border-border bg-card p-3">
              <Row label="Model" value={preview.model} />
              <Row label="Doctrine" value={preview.sources.doctrine} />
              <Row
                label="Playbooks"
                value={preview.sources.playbooks.join(', ') || 'none matched'}
                muted={preview.sources.playbooks.length === 0}
              />
              <Row label="House rules" value={short(preview.sources.houseRules)} muted={preview.sources.houseRules === 0} />
              <Row label="Boilerplate" value={short(preview.sources.boilerplate)} muted={preview.sources.boilerplate === 0} />
              <Row label="Exemplars" value={preview.sources.exemplars ? `${preview.sources.exemplars} starred` : 'none'} muted={preview.sources.exemplars === 0} />
              <Row label="Consultants" value={preview.sources.consultants ? `${preview.sources.consultants} ranked` : 'none'} muted={preview.sources.consultants === 0} />
              <Row label="Tender document" value={short(preview.sources.tenderText)} muted={preview.sources.tenderText === 0} />
              <Row label="Stored analysis" value={short(preview.sources.analysis)} muted={preview.sources.analysis === 0} />
            </div>

            {/* Said plainly rather than left to be discovered: the retrieval
                step runs at draft time and is not repeated here, so the
                boilerplate below is the stored text without the bid-specific
                evidence a real draft appends to it. */}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              A real draft also appends evidence retrieved from your proposals,
              CVs and company facts to the boilerplate. That retrieval is not
              run for a preview, so it is the one part of this that will differ.
            </p>

            <Message title="System message — the standing method" body={preview.system} />
            <Message title="Task message — this record" body={preview.task} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The skeleton a proposal is written into.
 *
 * Shown in the colours of the Word export rather than the console's own, for
 * the same reason ProposalPreview is: this is a picture of the document, and a
 * picture of the document should not restyle itself when the console does.
 *
 * Every heading carries the doctrine's own rule about whether it appears.
 * "Always" is not a promise the drafter keeps blindly — a tender that
 * prescribes its own structure overrides all of this, which is stated once
 * above the list rather than repeated against each row.
 */
const MAROON = '#6B0F1A'
const GOLD = '#C5973A'
const CREAM = '#F9F3E8'

const STATUS_STYLE: Record<TemplateSection['status'], string> = {
  Always: 'bg-success-soft text-success',
  Recommended: 'bg-brand-soft text-primary',
  Conditional: 'bg-surface-2 text-muted-foreground',
}

export function ProposalTemplate({ sections }: { sections: TemplateSection[] }) {
  if (sections.length === 0) return null

  return (
    <div className="min-w-0">
      <h3 className="mb-1.5 text-[13px] font-medium text-foreground">
        Master structure <span className="text-faint">· {sections.length} sections</span>
      </h3>
      <p className="mb-2.5 text-[11px] leading-relaxed text-muted-foreground">
        The headings the drafter populates, in order. A tender that prescribes
        its own structure replaces this entirely — these apply when it does not.
      </p>

      <div
        className="max-h-[46vh] overflow-auto rounded-lg border p-4"
        style={{ background: CREAM, borderColor: GOLD }}
      >
        <ol className="space-y-3">
          {sections.map((section, index) => (
            <li key={section.title} className="flex gap-3">
              <span
                className="mt-0.5 w-5 shrink-0 text-right font-mono text-[11px]"
                style={{ color: GOLD }}
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span
                    className="font-display text-[13px] leading-snug"
                    style={{ color: MAROON }}
                  >
                    {section.title}
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                      STATUS_STYLE[section.status],
                    )}
                  >
                    {section.status}
                  </span>
                </div>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-[#4A4A4A]">
                  {section.guidance}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
