import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  PencilIcon,
  SparklesIcon,
  StarIcon,
  TargetIcon,
  TrashIcon,
  UploadIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Panel, EmptyState } from '@/components/panel'
import { RfpStatusSelect } from '@/components/status-select'
import { ActivityComposer, ActivityRow } from '@/components/activity-log'
import { usePipeline } from '@/hooks/use-pipeline'
import { proposalFileUrl } from '@/lib/db'
import { PROPOSAL_DRAFTING } from '@/lib/features'
import {
  draftConceptNoteStreaming,
  MAX_EXEMPLARS,
  MAX_EXEMPLAR_CHARS,
} from '@/lib/concept-note'
import { downloadProposalDocx } from '@/lib/proposal-export'
import { daysUntil, formatDateWithYear, formatKes } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { Proposal, Rfp } from '@/lib/types'
import { RfpDialog } from './rfp-dialog'

function formatBytes(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-1 text-faint">{label}</div>
      <div className="text-[13px] text-foreground">{children}</div>
    </div>
  )
}

/**
 * Everything known about one tender on a single page: the notice, what has
 * been done about it, and every proposal written for it.
 *
 * Replaces the edit dialog as the click target from the tables — a dialog
 * cannot hold an activity log and a document history without becoming a
 * scrolling box inside a scrolling page.
 */
export function RfpProfile({ rfp, onBack }: { rfp: Rfp; onBack: () => void }) {
  const {
    activities,
    proposals,
    saveRfp,
    removeRfp,
    setRfpStatus,
    setRfpPipeline,
    logActivity,
    removeActivity,
    settings,
    consultants,
    saveDraftProposal,
    uploadProposal,
    removeProposal,
    setProposalExemplar,
    addPastProposal,
  } = usePipeline()

  const [editing, setEditing] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [uploadNotes, setUploadNotes] = useState('')
  const [uploading, setUploading] = useState(false)
  const [pasteTitle, setPasteTitle] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [pasting, setPasting] = useState(false)
  const [playbooks, setPlaybooks] = useState<string[]>([])
  /** The document as it arrives, shown live in the side panel. */
  const [draftPreview, setDraftPreview] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const previewScroll = useRef<HTMLDivElement>(null)

  // Follow the text as it is written, the way a document scrolls while you
  // type. Only while drafting — once it has finished, the reader is in charge
  // and yanking them back to the bottom would be obnoxious.
  useEffect(() => {
    if (!drafting) return
    const pane = previewScroll.current
    if (pane) pane.scrollTop = pane.scrollHeight
  }, [draftPreview, drafting])

  const ownActivities = useMemo(
    () => activities.filter((activity) => activity.rfpId === rfp.id),
    [activities, rfp.id],
  )
  const ownProposals = useMemo(
    () => proposals.filter((proposal) => proposal.rfpId === rfp.id),
    [proposals, rfp.id],
  )

  /**
   * Starred model answers, trimmed to what is worth sending. Drawn from every
   * RFP, not just this one — a good proposal teaches voice regardless of which
   * tender it was written for.
   */
  const exemplars = useMemo(
    () => proposals.filter((proposal) => proposal.isExemplar && proposal.content.trim()),
    [proposals],
  )
  const exemplarTexts = useMemo(
    () =>
      exemplars
        .slice(0, MAX_EXEMPLARS)
        .map((proposal) => proposal.content.slice(0, MAX_EXEMPLAR_CHARS)),
    [exemplars],
  )

  const left = daysUntil(rfp.deadline)

  async function handleDraft() {
    if (!rfp.org.trim()) {
      toast.error('Add an organization name before drafting')
      return
    }
    setDrafting(true)
    setDraftPreview('')
    try {
      const result = await draftConceptNoteStreaming(
        {
          kind: 'proposal',
          org: rfp.org,
          segment: rfp.segment,
          notes: rfp.notes,
          rfpTitle: rfp.title,
          deadline: rfp.deadline,
          serviceAreas: rfp.serviceAreas,
          guidance: settings.proposalGuidance,
          boilerplate: settings.boilerplate,
          examples: exemplarTexts,
          // The long bio is for a CV annex, not the proposal body — sending it
          // would triple the roster block for text the drafter should not use.
          consultants: consultants.map(({ id: _id, longBio: _longBio, ...brief }) => brief),
        },
        // The panel renders from this, so the document appears as it is written
        // rather than after a minute of a disabled button.
        (_chunk, soFar) => setDraftPreview(soFar),
      )
      // Saved before the download so a slow or cancelled save cannot lose the
      // generated text — the whole point of keeping drafts on the profile.
      await saveDraftProposal(rfp.id, `Draft — ${formatDateWithYear(new Date().toISOString().slice(0, 10))}`, result.text)
      await downloadProposalDocx(rfp, result.text)
      setPlaybooks(result.playbooks)
      if (result.truncated) {
        toast.warning('The draft hit the length limit — check the ending.')
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setDrafting(false)
    }
  }

  async function handleUpload(file: File | undefined) {
    if (!file) return
    setUploading(true)
    try {
      await uploadProposal(rfp.id, file, uploadNotes.trim())
      setUploadNotes('')
      if (fileInput.current) fileInput.current.value = ''
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setUploading(false)
    }
  }

  async function handlePaste() {
    if (!pasteText.trim()) {
      toast.error('Paste the proposal text first')
      return
    }
    setPasting(true)
    try {
      await addPastProposal(
        rfp.id,
        pasteTitle.trim() || 'Past proposal',
        pasteText.trim(),
      )
      setPasteTitle('')
      setPasteText('')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPasting(false)
    }
  }

  /** Starring is capped: every example is sent in full with each draft. */
  async function toggleExemplar(proposal: Proposal) {
    const next = !proposal.isExemplar
    if (next && exemplars.length >= MAX_EXEMPLARS) {
      toast.error(
        `${MAX_EXEMPLARS} model answers is the limit — unstar one under Guidance first.`,
      )
      return
    }
    try {
      await setProposalExemplar(proposal.id, next)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function openFile(proposal: Proposal) {
    try {
      const url = await proposalFileUrl(proposal.filePath)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <>
      {/*
        The document as it is written, pinned to the side of the screen.

        A proposal is 8,000 tokens and takes the better part of a minute, which
        as a disabled button is indistinguishable from a hang. It stays open
        after the draft finishes so the text can be read without digging the
        .docx out of the downloads folder, and closing it does not cancel
        anything — the save and the download have already happened.
      */}
      {(drafting || draftPreview) && (
        <aside
          // Half the screen: at 440px the document reflowed so narrowly that it
          // gave no sense of how the finished page would look, which is most of
          // the point of watching it being written. Full width below `sm`,
          // where a split view has nothing to split.
          className="fixed right-0 top-0 z-40 flex h-screen w-full flex-col border-l border-border bg-background shadow-2xl sm:w-1/2"
          aria-label="Proposal draft preview"
        >
          <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {drafting ? (
                  <>
                    <SparklesIcon className="size-3 animate-pulse" />
                    Writing…
                  </>
                ) : (
                  'Draft ready · saved and downloaded'
                )}
              </p>
              <p className="truncate text-xs text-faint">{rfp.title}</p>
            </div>
            <button
              type="button"
              onClick={() => setDraftPreview('')}
              className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              // Hidden mid-draft: closing would leave the panel unable to show
              // the rest, and the draft carries on regardless.
              disabled={drafting}
            >
              {drafting ? '' : 'Close'}
            </button>
          </header>

          <div ref={previewScroll} className="flex-1 overflow-y-auto bg-muted/40 p-5">
            {/* Shaped like a page so it reads as the document being built,
                rather than as a log of text arriving. The max width is a
                readable measure rather than the full pane — a line of body text
                running the whole width of half a monitor is unreadable, and the
                finished Word file will not look like that either. */}
            <div className="mx-auto max-w-[68ch] rounded-md border border-border bg-card px-8 py-7 shadow-sm">
              <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-[1.75] text-foreground">
                {draftPreview}
                {drafting && (
                  <span className="ml-0.5 inline-block animate-pulse font-bold text-primary">
                    ▍
                  </span>
                )}
              </pre>
              {drafting && !draftPreview && (
                <p className="text-[13px] italic text-faint">
                  Reading the notice and your house rules…
                </p>
              )}
            </div>
          </div>

          <footer className="border-t border-border px-4 py-2.5 text-[10.5px] text-faint">
            {draftPreview.trim()
              ? `${draftPreview.trim().split(/\s+/).length.toLocaleString()} words`
              : 'Starting…'}
            {!drafting && ' · Word file is in your downloads'}
          </footer>
        </aside>
      )}

      {/* Not the shared ViewHeader: this page is about one record, so the
          heading is the tender's title rather than a section name. */}
      <div className="sticky top-0 z-20 -mx-6 mb-6 border-b border-border bg-background/85 px-6 pb-4 pt-8 backdrop-blur-md lg:-mx-8 lg:px-8">
        <button
          type="button"
          onClick={onBack}
          className="eyebrow mb-2 flex cursor-pointer items-center gap-1.5 text-clay transition-colors hover:text-primary"
        >
          <ArrowLeftIcon className="size-3" />
          Back to opportunities
        </button>

        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 max-w-[60ch]">
            <h2 className="font-display text-[22px] leading-tight text-foreground">
              {rfp.title}
            </h2>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {rfp.org || 'Unknown organisation'} · {rfp.segment} · {rfp.source}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <RfpStatusSelect
              value={rfp.status}
              onChange={(next) => setRfpStatus(rfp.id, next)}
            />
            <Button
              variant={rfp.inPipeline ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => void setRfpPipeline(rfp.id, !rfp.inPipeline)}
            >
              <TargetIcon />
              {rfp.inPipeline ? 'In pipeline' : 'Add to pipeline'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <PencilIcon />
              Edit
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {PROPOSAL_DRAFTING && (
          <Panel title="Draft a proposal">
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              Writes a full technical proposal against this notice — method,
              work plan, team, risk and QA — plus internal bid-readiness notes
              listing what you still have to supply. Downloads as Word and keeps
              a copy below.
            </p>
            <Button onClick={() => void handleDraft()} disabled={drafting}>
              <SparklesIcon />
              {drafting ? 'Drafting…' : 'Draft proposal'}
            </Button>
            {/* Say what the drafter is working from, so a bad draft points at
                something fixable rather than feeling arbitrary. */}
            <p className="mt-3 text-[11px] text-faint">
              {settings.proposalGuidance.trim() || settings.boilerplate.trim()
                ? 'Using your house rules'
                : 'No house rules set'}
              {' · '}
              {exemplarTexts.length === 0
                ? 'no model answers'
                : `${exemplarTexts.length} model answer${exemplarTexts.length === 1 ? '' : 's'}`}
              {' · edit under '}
              <span className="text-clay">Guidance</span>
            </p>
            {/* Which method it wrote against. A leadership playbook on an
                evaluation tender means the service areas need correcting, and
                that is worth knowing before reading 3,000 words. */}
            {playbooks.length > 0 && (
              <p className="mt-1 text-[11px] text-faint">
                Written against: {playbooks.join(' + ')}
              </p>
            )}
          </Panel>
          )}

          <Panel
            title="Proposals"
            description="Generated drafts and the files you actually sent."
            action={
              <span className="text-[11px] text-faint">{ownProposals.length}</span>
            }
          >
            {ownProposals.length === 0 ? (
              <EmptyState
                icon={<FileTextIcon className="size-5" />}
                hint="Draft one above, or upload the version you sent to keep the record."
              >
                Nothing written yet
              </EmptyState>
            ) : (
              ownProposals.map((proposal) => (
                <div
                  key={proposal.id}
                  className="border-b border-border-soft py-3 last:border-b-0"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span
                        className={cn(
                          'mr-2 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
                          proposal.kind === 'submitted'
                            ? 'bg-success-soft text-success'
                            : 'bg-brand-soft text-primary',
                        )}
                      >
                        {proposal.kind === 'submitted' ? 'Sent' : 'Draft'}
                      </span>
                      <span className="text-[12.5px] font-medium text-foreground">
                        {proposal.title || proposal.fileName}
                      </span>
                      <div className="mt-1 text-[11px] text-faint">
                        {formatDateWithYear(proposal.createdAt.slice(0, 10))}
                        {proposal.fileSize
                          ? ` · ${formatBytes(proposal.fileSize)}`
                          : ''}
                        {proposal.notes ? ` · ${proposal.notes}` : ''}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {/* Only text can be imitated — a stored .docx is opaque
                          to the drafter, so it cannot be a model answer. */}
                      {PROPOSAL_DRAFTING && proposal.content.trim() && (
                        <button
                          type="button"
                          onClick={() => void toggleExemplar(proposal)}
                          aria-pressed={proposal.isExemplar}
                          aria-label={
                            proposal.isExemplar
                              ? 'Unstar as a model answer'
                              : 'Star as a model answer'
                          }
                          title={
                            proposal.isExemplar
                              ? 'Shown to the drafter as a model answer'
                              : 'Star to teach the drafter this style'
                          }
                          className={cn(
                            'cursor-pointer px-1 transition-colors',
                            proposal.isExemplar
                              ? 'text-warning'
                              : 'text-faint hover:text-warning',
                          )}
                        >
                          <StarIcon
                            className="size-3.5"
                            fill={proposal.isExemplar ? 'currentColor' : 'none'}
                          />
                        </button>
                      )}
                      {proposal.filePath ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => void openFile(proposal)}
                        >
                          <DownloadIcon />
                          Open
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() =>
                            void downloadProposalDocx(rfp, proposal.content)
                          }
                        >
                          <DownloadIcon />
                          Word
                        </Button>
                      )}
                      <button
                        type="button"
                        onClick={() => void removeProposal(proposal)}
                        aria-label="Delete this proposal"
                        className="cursor-pointer px-1 text-faint transition-colors hover:text-danger"
                      >
                        <TrashIcon className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  {proposal.content && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                        Show text
                      </summary>
                      <pre className="mt-2 max-h-[280px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-3 text-[11.5px] leading-relaxed text-muted-foreground">
                        {proposal.content}
                      </pre>
                    </details>
                  )}
                </div>
              ))
            )}
          </Panel>

          <Panel
            title="Upload a sent proposal"
            description="Keep the version that actually went to the buyer, for the record."
          >
            <Input
              value={uploadNotes}
              onChange={(event) => setUploadNotes(event.target.value)}
              placeholder="Note (optional) — e.g. submitted via portal, ref ABC/123"
              className="mb-2 w-full"
            />
            <input
              ref={fileInput}
              type="file"
              accept=".doc,.docx,.pdf,.odt,.rtf,.txt"
              onChange={(event) => void handleUpload(event.target.files?.[0])}
              disabled={uploading}
              className="block w-full text-xs text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground hover:file:bg-surface-2"
            />
            {uploading && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <UploadIcon className="size-3 animate-pulse" />
                Uploading…
              </p>
            )}
          </Panel>

          {/* An uploaded file is storage; pasted text is training material.
              This is how a past winning bid becomes a model answer. */}
          {PROPOSAL_DRAFTING && (
          <Panel
            title="Paste a past proposal"
            description="Text you paste here can be starred as a model answer and shown to the drafter. An uploaded file cannot — it is just an attachment."
          >
            <Input
              value={pasteTitle}
              onChange={(event) => setPasteTitle(event.target.value)}
              placeholder="Title — e.g. UNDP baseline survey, won Mar 2026"
              className="mb-2 w-full"
            />
            <Textarea
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder="Paste the full text of the proposal…"
              className="min-h-[160px] w-full font-mono text-[11.5px] leading-relaxed"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-[11px] text-faint">
                {pasteText.length > MAX_EXEMPLAR_CHARS
                  ? `${pasteText.length.toLocaleString()} characters — only the first ${MAX_EXEMPLAR_CHARS.toLocaleString()} are shown to the drafter`
                  : pasteText
                    ? `${pasteText.length.toLocaleString()} characters`
                    : ''}
              </span>
              <Button
                variant="outline"
                onClick={() => void handlePaste()}
                disabled={pasting || !pasteText.trim()}
              >
                {pasting ? 'Saving…' : 'Save as past proposal'}
              </Button>
            </div>
          </Panel>
          )}
        </div>

        <div className="min-w-0">
          <Panel title="Details">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <Detail label="Deadline">
                {rfp.deadline ? (
                  <span
                    className={cn(
                      left !== null && left < 0
                        ? 'text-danger'
                        : left !== null && left <= 5
                          ? 'text-warning'
                          : undefined,
                    )}
                  >
                    {formatDateWithYear(rfp.deadline)}
                    {left !== null &&
                      ` · ${left < 0 ? `${Math.abs(left)}d overdue` : left === 0 ? 'due today' : `in ${left}d`}`}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Not stated</span>
                )}
              </Detail>

              <Detail label="Estimated value">
                {rfp.value === null ? (
                  <span className="text-muted-foreground">Unknown</span>
                ) : (
                  `KES ${formatKes(rfp.value)}`
                )}
              </Detail>

              {rfp.serviceAreas && (
                <Detail label="Service areas">{rfp.serviceAreas}</Detail>
              )}

              <Detail label="Notice">
                {rfp.link ? (
                  <a
                    href={rfp.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Open original
                    <ExternalLinkIcon className="size-3" />
                  </a>
                ) : (
                  <span className="text-muted-foreground">No link</span>
                )}
              </Detail>

              {rfp.notes && <Detail label="Notes">{rfp.notes}</Detail>}
            </div>
          </Panel>

          <Panel
            title="Activity"
            description="Calls, emails and meetings against this tender."
          >
            <ActivityComposer rfpId={rfp.id} onLog={logActivity} />
            <div className="mt-2 max-h-[420px] overflow-y-auto">
              {ownActivities.length === 0 ? (
                <p className="py-3 text-center text-[11.5px] text-faint">
                  Nothing logged yet.
                </p>
              ) : (
                ownActivities.map((activity) => (
                  <ActivityRow
                    key={activity.id}
                    activity={activity}
                    onDelete={(id) => void removeActivity(id)}
                  />
                ))
              )}
            </div>
          </Panel>
        </div>
      </div>

      <RfpDialog
        rfp={rfp}
        open={editing}
        onOpenChange={setEditing}
        onSave={saveRfp}
        onDelete={async (id) => {
          await removeRfp(id)
          onBack()
        }}
      />
    </>
  )
}
