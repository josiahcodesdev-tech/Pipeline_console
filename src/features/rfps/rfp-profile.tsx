import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  PencilIcon,
  SparklesIcon,
  StarIcon,
  LockIcon,
  TargetIcon,
  TrashIcon,
  UploadIcon,
  UserRoundCogIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { Panel, EmptyState } from '@/shared/components/panel'
import { RfpStatusSelect } from '@/shared/components/status-select'
import { ActivityComposer, ActivityRow } from '@/shared/components/activity-log'
import { useAuth } from '@/shared/hooks/use-auth'
import { useMemberNames } from '@/shared/hooks/use-member-names'
import { usePipeline } from '@/shared/hooks/use-pipeline'
import { proposalFileUrl } from '@/data/proposals'
import { PROPOSAL_DRAFTING } from '@/app/features'
import {
  draftConceptNoteStreaming,
  MAX_EXEMPLARS,
  MAX_EXEMPLAR_CHARS,
} from '@/services/concept-note'
import { downloadProposalDocx } from '@/documents/proposal'
import { MAX_TENDER_CHARS } from '@/services/pdf-text'
import {
  analysisMarkdown,
  analyzeTender,
  enrichTender,
  indexKnowledge,
  ingestProposal,
  ingestTender,
  retrieveKnowledge,
} from '@/services/tender-intelligence'
import { daysUntil, formatDateWithYear, formatKes } from '@/domain/dates'
import { safeExternalUrl, siteOf } from './source-site'
import { cn } from '@/shared/utils'
import type { Proposal, Rfp } from '@/domain/types'
import { ReassignDialog } from '@/features/rfps/reassign-dialog'
import { RfpDialog } from './rfp-dialog'
import { ProposalPreview } from './proposal-preview'

function formatBytes(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Pull the short opening explanation out of the structured tender reading. */
function assignmentSummary(analysis: string): string {
  const heading = /^#{1,3}\s+What this assignment is\s*$/im
  const match = heading.exec(analysis)
  if (!match) return ''

  const body = analysis.slice(match.index + match[0].length)
  return body
    .split(/^#{1,3}\s+/m, 1)[0]
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
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
    claims,
    logActivity,
    removeActivity,
    settings,
    consultants,
    setTenderDocument,
    saveTenderIntelligence,
    saveDraftProposal,
    uploadProposal,
    removeProposal,
    setProposalExemplar,
    addPastProposal,
  } = usePipeline()
  const { profile, can } = useAuth()
  const memberNames = useMemberNames()

  /**
   * The colleague holding this tender, if it is not the reader.
   *
   * Falls back to a generic label rather than a user id when the member list
   * has not loaded — "Taken by another member" is still the useful half of the
   * sentence, and a uuid is none of it.
   */
  const claim = rfp.externalId ? claims.get(rfp.externalId) : undefined
  const heldByOther =
    claim && claim.claimedBy !== profile?.id
      ? (memberNames.get(claim.claimedBy) ?? 'another member')
      : null

  /**
   * A tender someone else has taken is read-only — for standard users.
   *
   * The whole point of an exclusive claim is that one person owns the response.
   * Two members drafting against the same notice, or one quietly editing the
   * other's tender document mid-bid, is exactly the confusion the claim exists
   * to prevent, and it would be worse than the duplicate bidding it replaced
   * because it happens invisibly.
   *
   * Oversight is exempt. This used to apply to admins and the super user too,
   * on the argument that they should release the claim before acting — but
   * releasing hands the tender back to the pool where anyone may take it, which
   * is a much larger act than fixing a typo, and it left the person responsible
   * for the pipeline unable to finish a bid a member had abandoned. Migration
   * 0028 grants the same exemption in the policies, so this is not a hidden
   * button standing in for a server rule.
   */
  const viewOnly = heldByOther !== null && !can.seeEveryone

  const site = siteOf(rfp.link)

  const [editing, setEditing] = useState(false)
  const [reassigning, setReassigning] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [uploadNotes, setUploadNotes] = useState('')
  const [uploading, setUploading] = useState(false)
  const [pasteTitle, setPasteTitle] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [pasting, setPasting] = useState(false)
  const [playbooks, setPlaybooks] = useState<string[]>([])
  /** The document as it arrives, shown live in the side panel. */
  const [draftPreview, setDraftPreview] = useState('')
  const [readingTender, setReadingTender] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const tenderInput = useRef<HTMLInputElement>(null)
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
  const summary = useMemo(
    () => assignmentSummary(rfp.analysis) || rfp.notes.trim(),
    [rfp.analysis, rfp.notes],
  )
  const left = daysUntil(rfp.deadline)

  async function retrieveCapabilityContext(): Promise<string> {
    const jobs: Promise<unknown>[] = []
    if (settings.boilerplate.trim()) jobs.push(indexKnowledge({ sourceType:'company_fact', sourceId:'settings', title:'Verified company facts', content:settings.boilerplate }))
    if (settings.proposalGuidance.trim()) jobs.push(indexKnowledge({ sourceType:'methodology', sourceId:'proposal-guidance', title:'Proposal methodology guidance', content:settings.proposalGuidance }))
    // The whole submitted library supplies bid-specific evidence through
    // retrieval. Starred proposals additionally teach writing style.
    for (const proposal of proposals.filter((item) => item.kind === 'submitted' && item.content.trim())) {
      jobs.push(indexKnowledge({ sourceType:'proposal', sourceId:proposal.id, title:proposal.title, content:proposal.content }))
    }
    for (const consultant of consultants) {
      const content = [consultant.title, consultant.coreExpertise, consultant.qualifications, consultant.taskFit, consultant.projectExperience, consultant.shortBio, consultant.longBio].filter(Boolean).join('\n')
      if (content) jobs.push(indexKnowledge({ sourceType:'consultant_cv', sourceId:consultant.id, title:consultant.name, content }))
    }
    await Promise.all(jobs)
    const retrieved = await retrieveKnowledge(`${rfp.title}\n${rfp.serviceAreas}\n${rfp.tenderText.slice(0, 12000)}`)
    return retrieved.matches.map((match) => {
      const use = match.source_type === 'proposal'
        ? 'PAST PROPOSAL PATTERN ONLY — transfer relevant structure or method, never its client names, figures, dates, staff, credentials or claims.'
        : 'VERIFIED CAPABILITY CONTEXT — use only for the claim directly supported by this passage.'
      return `[${match.source_type}: ${match.title}; similarity ${match.similarity.toFixed(3)}]\n${use}\n${match.content}`
    }).join('\n\n')
  }

  /**
   * Produces the structured brief that proposal drafting needs.
   *
   * Kept as one operation for both the explicit Read button and automatic
   * pre-draft reading, so the two paths cannot quietly analyse different
   * source material.
   */
  async function readTender(): Promise<{ analysis: string; capabilityContext: string }> {
    const knowledge = await retrieveCapabilityContext()
    const source = rfp.tenderText.trim() || [rfp.title, rfp.org, rfp.notes, rfp.noticeText].filter(Boolean).join('\n\n')
    const structured = await analyzeTender(source, knowledge, rfp.link)
    const review = analysisMarkdown(structured.analysis)
    let enrichment: Record<string, unknown> | undefined
    try {
      enrichment = await enrichTender({
        reference: structured.analysis.metadata.reference,
        exactPhrase: rfp.tenderText.slice(0, 180),
        client: rfp.org,
      }) as unknown as Record<string, unknown>
    } catch {
      // Web context is useful but must not block drafting from the authoritative tender.
    }
    await saveTenderIntelligence(rfp.id, {
      analysis: review,
      analysisJson: structured.analysis as unknown as Record<string, unknown>,
      noticeText: structured.noticeText,
      enrichment,
    })
    return { analysis: review, capabilityContext: knowledge }
  }

  /** Reads, enriches and stores the tender context before writing when needed. */
  async function handleDraft() {
    if (!rfp.org.trim()) {
      toast.error('Add an organization name before drafting')
      return
    }
    setDrafting(true)
    setDraftPreview('')
    try {
      if (!rfp.tenderText.trim() && !rfp.link.trim()) {
        toast.error('Attach the tender document or add its source link before drafting')
        return
      }
      // Trust the stored analysis once it exists. Attaching a replacement TOR
      // clears that memory below, so a fresh source is still checked once.
      let proposalAnalysis = rfp.analysis.trim()
      let capabilityContext: string
      if (proposalAnalysis) {
        capabilityContext = await retrieveCapabilityContext()
      } else {
        toast.info('Checking and enriching the RFP before drafting…')
        const checked = await readTender()
        proposalAnalysis = checked.analysis
        capabilityContext = checked.capabilityContext
      }

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
          boilerplate: [settings.boilerplate, capabilityContext && `RETRIEVED BID-SPECIFIC EVIDENCE\n${capabilityContext}`].filter(Boolean).join('\n\n'),
          examples: exemplarTexts,
          // The long bio is for a CV annex, not the proposal body — sending it
          // would triple the roster block for text the drafter should not use.
          consultants: consultants.map(({ id: _id, longBio: _longBio, ...brief }) => brief),
          // The whole point of attaching it: the drafter stops guessing at the
          // scope from a one-line notice.
          tenderText: rfp.tenderText,
          // And where no document was attached, the reading of the notice does
          // the same job. Without either, a proposal is written against a
          // 99-character title, which is where invented scopes come from.
          analysis: proposalAnalysis,
        },
        // The panel renders from this, so the document appears as it is written
        // rather than after a minute of a disabled button.
        (_chunk, soFar) => setDraftPreview(soFar),
      )
      // Saved, but deliberately not downloaded. A draft is worth reading before
      // it is worth keeping, and firing a .docx into the downloads folder on
      // every attempt left a trail of near-identical files to sort out later.
      // The preview panel and the list below both offer the download.
      await saveDraftProposal(rfp.id, `Draft — ${formatDateWithYear(new Date().toISOString().slice(0, 10))}`, result.text)
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

  /**
   * Reads an uploaded tender PDF and attaches its text to this RFP.
   *
   * The authenticated Edge Function sends the PDF to OpenAI for layout-aware
   * extraction and OCR, then only the extracted representation is persisted.
   */
  async function handleTenderUpload(file: File | undefined) {
    if (!file) return
    if (file.size > 20 * 1024 * 1024) {
      toast.error('Tender documents are limited to 20 MB.')
      return
    }
    setReadingTender(true)
    try {
      const remote = await ingestTender(file)
      const markdown = remote.markdown.slice(0, MAX_TENDER_CHARS)
      await saveTenderIntelligence(rfp.id, {
        tenderText: markdown,
        tenderFileName: file.name,
        ingestion: remote as unknown as Record<string, unknown>,
        analysis: '',
        analysisJson: {},
        enrichment: {},
      })
      toast.success('OpenAI layout and OCR completed.')
      if (remote.markdown.length > MAX_TENDER_CHARS) {
        toast.warning('The extracted document was truncated to the drafting limit.')
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setReadingTender(false)
      if (tenderInput.current) tenderInput.current.value = ''
    }
  }

  async function handleUpload(file: File | undefined) {
    if (!file) return
    setUploading(true)
    try {
      let content = ''
      try {
        content = (await ingestProposal(file)).markdown
      } catch (cause) {
        // Filing the final document is still useful if a legacy format cannot
        // be read. Keep the limitation visible instead of losing the file.
        toast.warning(`Text extraction failed; the file will still be saved: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
      await uploadProposal(rfp.id, file, uploadNotes.trim(), content)
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

        A proposal is a substantial document and can take close to a minute, which
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
                  'Draft ready · saved to this RFP'
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
            {/* White page rather than the themed card: this is a picture of
                the Word file, so it should look like paper regardless of how
                the console around it is styled. */}
            <div className="mx-auto max-w-[68ch] rounded-md border border-border bg-white px-9 py-8 shadow-sm">
              <ProposalPreview markdown={draftPreview} />
              {drafting && (
                <span className="inline-block animate-pulse font-bold" style={{ color: '#C5973A' }}>
                  ▍
                </span>
              )}
              {drafting && !draftPreview && (
                <p className="text-[13px] italic text-faint">
                  Reading the notice and your house rules…
                </p>
              )}
            </div>
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
            <span className="text-[10.5px] text-faint">
              {draftPreview.trim()
                ? `${draftPreview.trim().split(/\s+/).length.toLocaleString()} words`
                : 'Starting…'}
              {!drafting && draftPreview.trim() && ' · saved to this RFP'}
            </span>
            {/* Downloading is a decision, not a side effect of drafting. */}
            {!drafting && draftPreview.trim() && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void downloadProposalDocx(rfp, draftPreview)}
              >
                <DownloadIcon />
                Download Word
              </Button>
            )}
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
            {/* Provenance, in the order you would ask for it: whose tender,
                what kind of buyer, which site it came off, and the day it
                landed here. The site is the host rather than the full notice
                URL — the title above is already the link to the notice. */}
            <p className="mt-1.5 text-xs text-muted-foreground">
              {[
                rfp.org || 'Unknown organisation',
                rfp.segment,
                [rfp.source || 'Entered by hand', site && `(${site})`]
                  .filter(Boolean)
                  .join(' '),
                `Added ${formatDateWithYear(rfp.createdOn)}`,
              ].join(' · ')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {viewOnly ? (
              <span className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-muted-foreground">
                {rfp.status}
              </span>
            ) : (
              <RfpStatusSelect
                value={rfp.status}
                onChange={(next) => setRfpStatus(rfp.id, next)}
              />
            )}
            {/* Taken by a colleague: shown as a fact rather than a disabled
                button, because there is nothing here for the reader to do. */}
            {heldByOther ? (
              <span
                title="One proposal per tender. Ask them if you should be on this bid."
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs text-muted-foreground"
              >
                <LockIcon className="size-3.5" aria-hidden />
                Taken by {heldByOther}
              </span>
            ) : (
              <Button
                variant={rfp.inPipeline ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => void setRfpPipeline(rfp.id, !rfp.inPipeline)}
              >
                <TargetIcon />
                {rfp.inPipeline ? 'In pipeline' : 'Add to pipeline'}
              </Button>
            )}
            {!viewOnly && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <PencilIcon />
                Edit
              </Button>
            )}
            {can.seeEveryone && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReassigning(true)}
                title="Hand this tender, and everything attached to it, to another member"
              >
                <UserRoundCogIcon />
                Reassign
              </Button>
            )}
          </div>
        </div>
      </div>

      {heldByOther && !viewOnly && (
        // Oversight acting on somebody else's bid. The controls are all live,
        // so nothing on the page would otherwise say whose work this is — and
        // editing a colleague's tender without noticing is the failure the
        // read-only rule used to prevent by refusing outright.
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-gold/50 bg-gold-soft/60 px-4 py-3">
          <UserRoundCogIcon className="mt-0.5 size-4 shrink-0 text-clay" aria-hidden />
          <div className="text-xs leading-relaxed text-clay">
            <span className="font-semibold">{heldByOther} is bidding this tender.</span>{' '}
            You can edit, draft and log against it because you oversee the
            pipeline — but the work is theirs, and they will not be told. Use
            Reassign if it should change hands properly.
          </div>
        </div>
      )}

      {viewOnly && (
        // Said once, plainly, at the top. Everything below is missing its
        // controls and a reader who does not know why will assume the page is
        // broken before they assume it is deliberate.
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3">
          <LockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">
              {heldByOther} is bidding this tender.
            </span>{' '}
            You can read everything here, but not draft, edit, attach a document
            or log against it — one proposal per tender is what stops two of
            ours reaching the same buyer. If it should be yours, ask them to
            hand it back.
          </div>
        </div>
      )}

      <section className="mb-5 rounded-xl border border-border bg-card px-4 py-3.5">
        <div className="eyebrow mb-1.5 text-clay">Assignment summary</div>
        <p className="max-w-[90ch] text-[13px] leading-relaxed text-foreground">
          {summary ||
            'No assignment summary is available yet. Read the tender or attach its Terms of Reference to create one.'}
        </p>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {PROPOSAL_DRAFTING && !viewOnly && (
          <>
          {/* Above the drafter on purpose: attaching the tender is what makes
              the draft worth having, so it should be read first. */}
          <Panel
            title="Tender document"
            description="Upload a PDF. OpenAI layout-aware OCR preserves headings, page references and tables before analysis and drafting."
          >
            {rfp.tenderText ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-success-soft px-2 py-1 text-[11.5px] font-medium text-success">
                  <FileTextIcon className="size-3.5" />
                  {rfp.tenderFileName || 'Tender attached'}
                </span>
                <span className="text-[11px] text-faint">
                  {rfp.tenderText.length.toLocaleString()} characters — the drafter
                  writes against this rather than the notice alone
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void setTenderDocument(rfp.id, '', '')}
                >
                  <TrashIcon />
                  Remove
                </Button>
              </div>
            ) : (
              <>
                <input
                  ref={tenderInput}
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(event) => void handleTenderUpload(event.target.files?.[0])}
                  className="block w-full text-[11.5px] text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-[11.5px] file:text-foreground"
                  disabled={readingTender}
                />
                <p className="mt-2 text-[11px] text-faint">
                  {readingTender
                    ? 'Reading the document…'
                    : 'PDFs are processed with OpenAI layout-aware OCR.'}
                </p>
              </>
            )}
          </Panel>

          <Panel title="Draft a proposal">
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              Writes a full technical proposal against this notice — method,
              work plan, team, risk and QA — plus internal bid-readiness notes
              listing what you still have to supply. Appears as it is written,
              and is kept below; download it as Word when you want it.
            </p>
            {!rfp.analysis && !rfp.tenderText && (
              <p className="mb-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-[11.5px] leading-relaxed text-warning">
                No Terms of Reference or saved reading is attached. Drafting will first
                fetch and analyse the source link; if there is no usable link, attach the
                tender document before continuing.
              </p>
            )}
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
          </>
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
                      {PROPOSAL_DRAFTING && !viewOnly && proposal.content.trim() && (
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
                      {/* Reading a colleague's proposal is fine and useful;
                          deleting it is not yours to do. Downloading stays
                          available either way. */}
                      {!viewOnly && (
                        <button
                          type="button"
                          onClick={() => void removeProposal(proposal)}
                          aria-label="Delete this proposal"
                          className="cursor-pointer px-1 text-faint transition-colors hover:text-danger"
                        >
                          <TrashIcon className="size-3.5" />
                        </button>
                      )}
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

          {!viewOnly && (
          <Panel
            title="Upload a sent proposal"
            description="Keep the version sent to the buyer. PDF and Word text is learned automatically and retrieved for relevant future bids."
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
          )}

          {/* An uploaded file is storage; pasted text is training material.
              This is how a past winning bid becomes a model answer. */}
          {PROPOSAL_DRAFTING && !viewOnly && (
          <Panel
            title="Paste a past proposal"
            description="Use this for legacy files that could not be read automatically. Saved text can be starred as a model answer."
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
                    href={safeExternalUrl(rfp.link)}
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
            {!viewOnly && <ActivityComposer rfpId={rfp.id} onLog={logActivity} />}
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

      {can.seeEveryone && (
        <ReassignDialog
          rfp={rfp}
          currentOwner={
            heldByOther ??
            (rfp.ownerId === profile?.id
              ? 'you'
              : (memberNames.get(rfp.ownerId) ?? 'another member'))
          }
          open={reassigning}
          onOpenChange={setReassigning}
        />
      )}
    </>
  )
}
