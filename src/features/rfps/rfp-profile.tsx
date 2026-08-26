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
import { TenderAccess } from './tender-access'
import { usePipeline } from '@/shared/hooks/use-pipeline'
import { proposalFileUrl } from '@/data/proposals'
import { PROPOSAL_DRAFTING } from '@/app/features'
import {
  MAX_EXEMPLARS,
  MAX_EXEMPLAR_CHARS,
  previewPrompt,
  type PromptPreview,
} from '@/services/concept-note'
import { downloadProposalDocx } from '@/documents/proposal'
import {
  draftIntoTemplate,
  renderDesignedProposal,
  type DraftProgress,
} from '@/documents/template-draft'
import { loadProposalTemplate } from '@/documents/template-source'
import { sectionBriefs } from '@/documents/template-slots'
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
import { PromptPreviewDialog } from './prompt-preview'
import { TenderIntelligence, type IntelligenceTab } from './tender-intelligence'

/**
 * The tabs, in the order somebody works through a tender.
 *
 * What it is, then what came with it, then what the model made of it, then the
 * two questions that follow from that. Overview first because it is what most
 * visits are for.
 */
type ProfileTab = 'overview' | IntelligenceTab

const TABS: ReadonlyArray<{ id: ProfileTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'documents', label: 'Documents' },
  { id: 'intelligence', label: 'AI intelligence' },
  { id: 'capability', label: 'Capability match' },
  { id: 'similar', label: 'Similar past bids' },
]

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
    sharedWithMe,
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
   *
   * A tender someone shared is read-only on the same terms, and on a firmer
   * footing: a share grants read and nothing else, so every write here would be
   * refused by the policy rather than merely discouraged. It has to be tested
   * separately from the claim because a hand-added tender has no external id
   * and therefore no claim to be held by anyone — and those are exactly the
   * rows most likely to be shared, being the ones a colleague cannot find in
   * their own copy of the feed.
   */
  const sharedIn = sharedWithMe.has(rfp.id)
  const viewOnly = !can.seeEveryone && (sharedIn || heldByOther !== null)

  const site = siteOf(rfp.link)

  const [editing, setEditing] = useState(false)
  const [reassigning, setReassigning] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [promptPreview, setPromptPreview] = useState<PromptPreview | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const [uploadNotes, setUploadNotes] = useState('')
  const [uploading, setUploading] = useState(false)
  const [pasteTitle, setPasteTitle] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [pasting, setPasting] = useState(false)
  const [playbooks, setPlaybooks] = useState<string[]>([])
  /**
   * Which tab is showing. Overview by default, and it stays the default —
   * the record is what most visits are for, and the intelligence is what you
   * go and look at.
   */
  const [tab, setTab] = useState<ProfileTab>('overview')
  /**
   * Sections as they land, shown live in the side panel.
   *
   * The designed proposal is filled section by section rather than written as a
   * stream of words, so there is no text to watch arrive. What there is instead
   * is nineteen briefs completing out of order, which is worth showing for the
   * same reason: a minute of a disabled button is indistinguishable from a hang.
   */
  const [draftSteps, setDraftSteps] = useState<DraftProgress[]>([])
  const [draftTotal, setDraftTotal] = useState(0)
  /** The finished document, held so it can be opened without a round trip. */
  const [draftHtml, setDraftHtml] = useState('')
  const [draftWarnings, setDraftWarnings] = useState<string[]>([])
  const [readingTender, setReadingTender] = useState(false)
  const [openingProposal, setOpeningProposal] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const tenderInput = useRef<HTMLInputElement>(null)
  const previewScroll = useRef<HTMLDivElement>(null)

  // Follow the sections as they complete, the way a log scrolls. Only while
  // drafting — once it has finished the reader is in charge, and yanking them
  // back to the bottom would be obnoxious.
  useEffect(() => {
    if (!drafting) return
    const pane = previewScroll.current
    if (pane) pane.scrollTop = pane.scrollHeight
  }, [draftSteps, drafting])

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

    // Said out loud rather than absorbed. Procurement portals block automated
    // fetches often, and when one does the reading is built from the title and
    // whatever the sync scraped — which produces a proposal that reads exactly
    // as confidently as one written from the real tender. This runs on the way
    // into drafting, which is the moment it matters.
    if (structured.noticeProblem && !rfp.tenderText.trim()) {
      toast.warning(
        `The source link could not be read (${structured.noticeProblem}). This draft will be written from the title and the synced details only — attach the Terms of Reference for a real one.`,
      )
    }
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
  /**
   * The prompt this record would produce, without producing anything.
   *
   * Built from the same fields `handleDraft` sends, deliberately duplicated
   * rather than factored out with it: the draft path first runs the enrichment
   * and retrieval steps, which cost embeddings calls and a tender-analysis
   * allowance, and a preview that did that could not be used freely while
   * debugging. The stored analysis is used as it stands, and the dialog says
   * which single part a real draft adds.
   */
  async function handlePreviewPrompt() {
    setPreviewing(true)
    try {
      // The first section of the template that would actually be filled. The
      // prompt is per section now, so previewing the old whole-document task
      // would answer "why did it write that?" with a prompt nothing is written
      // from. One section is enough: the doctrine, playbook, house rules and
      // roster above it are identical for all nineteen.
      const template = await loadProposalTemplate(
        [rfp.title, rfp.serviceAreas, rfp.notes].filter(Boolean).join(' '),
      )
      const first = sectionBriefs(template.html, template.config).find(
        (section) => section.slots.length > 0,
      )

      const preview = await previewPrompt({
        kind: 'proposal-section',
        section: { title: first?.title ?? 'Executive Summary' },
        slots: (first?.slots ?? []).map((slot) => ({
          id: slot.id,
          kind: slot.kind,
          original: slot.original,
          budget: slot.budget,
        })),
        org: rfp.org,
        segment: rfp.segment,
        notes: rfp.notes,
        rfpTitle: rfp.title,
        deadline: rfp.deadline,
        serviceAreas: rfp.serviceAreas,
        guidance: settings.proposalGuidance,
        boilerplate: settings.boilerplate,
        examples: exemplarTexts,
        consultants: consultants.map(({ id: _id, longBio: _longBio, ...brief }) => brief),
        tenderText: rfp.tenderText,
        analysis: rfp.analysis,
      })
      setPromptPreview(preview)
      setPromptOpen(true)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPreviewing(false)
    }
  }

  async function handleDraft() {
    if (!rfp.org.trim()) {
      toast.error('Add an organization name before drafting')
      return
    }
    setDrafting(true)
    setDraftSteps([])
    setDraftTotal(0)
    setDraftHtml('')
    setDraftWarnings([])
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
        try {
          capabilityContext = await retrieveCapabilityContext()
        } catch {
          capabilityContext = ''
          toast.warning('Capability retrieval is unavailable; drafting from the tender record.')
        }
      } else {
        toast.info('Checking and enriching the RFP before drafting…')
        try {
          const checked = await readTender()
          proposalAnalysis = checked.analysis
          capabilityContext = checked.capabilityContext
        } catch {
          capabilityContext = ''
          proposalAnalysis = [rfp.title, rfp.org, rfp.notes, rfp.noticeText]
            .filter(Boolean)
            .join('\n\n')
          toast.warning(
            'Tender intelligence is unavailable; drafting from the stored tender information.',
          )
        }
      }

      // The designed proposal, filled section by section. Everything the
      // Markdown drafter was told is still told — doctrine, playbook, house
      // rules, roster, retrieved evidence, the tender itself — only the
      // container changed, from a document it writes to a layout it fills.
      const result = await draftIntoTemplate({
        context: {
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
        // What the finished document calls itself, and who it is addressed to.
        // Without these the browser tab, the sidebar and the running footer keep
        // the name of whichever client the template was first written for.
        document: { title: rfp.title, client: rfp.org },
        onProgress: (progress) => {
          setDraftTotal(progress.total)
          setDraftSteps((current) => [...current, progress])
        },
      })

      setDraftHtml(result.html)
      setPlaybooks(result.playbooks)

      // Said plainly rather than counted quietly. Every one of these means the
      // document still carries wording written for the Ministry of Transport,
      // and the only way that gets fixed is somebody being told where.
      const warnings: string[] = []
      if (result.failures.length > 0) {
        warnings.push(
          `${result.failures.length} section${result.failures.length === 1 ? '' : 's'} could not be written: ${result.failures.map((failure) => failure.section).join(', ')}. Those keep the template's own wording — redraft before sending.`,
        )
      }
      if (result.unfilled.length > 0) {
        warnings.push(
          `${result.unfilled.length} of ${result.slotCount} pieces of text were left as the template had them.`,
        )
      }
      if (result.missingFurniture.length > 0) {
        warnings.push(
          `This template needs configuration for: ${result.missingFurniture.join(', ')}. Until it has it, the previous client's name survives there.`,
        )
      }
      setDraftWarnings(warnings)

      // Saved, but deliberately not opened. A draft is worth reading before it
      // is worth keeping, and the panel and the list below both offer it.
      //
      // The text is stored, not the markup: see ProposalDesign. The document is
      // rebuilt from the current template whenever anybody opens it.
      await saveDraftProposal(
        rfp.id,
        `Draft — ${formatDateWithYear(new Date().toISOString().slice(0, 10))}`,
        result.text,
        {
          template: result.templateName,
          values: result.values,
          unfilled: result.unfilled.map((slot) => slot.id),
          failures: result.failures.map((failure) => failure.section),
        },
      )
      for (const warning of warnings) toast.warning(warning)
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

  /**
   * Opens a finished proposal in its own tab.
   *
   * A blob URL rather than a data URL: the document is a few megabytes with its
   * images inlined, and Chrome refuses to navigate to a data URL that size. The
   * object URL is released on a timer instead of immediately — revoking it
   * before the new tab has finished reading leaves a blank window.
   *
   * The template carries its own Print / Save PDF button, so this is also how a
   * PDF is produced. Nothing here needs to reimplement that.
   */
  function openHtml(html: string) {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    // No `noopener` in the feature string: passing it makes window.open return
    // null by specification, which is indistinguishable here from the pop-up
    // having been blocked — and reporting a blocked pop-up while the tab opens
    // behind it is worse than not reporting one. The opener is severed after.
    const opened = window.open(url, '_blank')
    if (!opened) {
      URL.revokeObjectURL(url)
      toast.error('Allow pop-ups for this site to open the proposal.')
      return
    }
    try {
      opened.opener = null
    } catch {
      // Nothing to do about it, and nothing that depends on it.
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  /**
   * Rebuilds a saved proposal from the template it was written into.
   *
   * The draft stores its answers, not its markup, so the document does not exist
   * until somebody asks for it — which is also what lets a correction to the
   * house design reach proposals written before the correction.
   */
  async function openDesigned(proposal: Proposal) {
    if (!proposal.design) return
    setOpeningProposal(proposal.id)
    try {
      const built = await renderDesignedProposal(proposal.design, {
        title: rfp.title,
        client: rfp.org,
      })
      openHtml(built.html)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setOpeningProposal('')
    }
  }

  return (
    <>
      {/*
        The template filling up, pinned to the side of the screen.

        There is no stream of words to watch here — the drafter answers a
        section at a time and each answer arrives whole — so what this shows is
        the nineteen sections completing, out of order, three at a time. Same
        job as the old typing preview: several minutes of a disabled button is
        indistinguishable from a hang.

        It stays open after the draft finishes so the warnings can be read, and
        closing it cancels nothing — the save has already happened.
      */}
      {(drafting || draftHtml) && (
        <aside
          // Narrower than the old document preview, which was half the screen so
          // the prose could be read at a realistic measure. This is a checklist.
          className="fixed right-0 top-0 z-40 flex h-screen w-full flex-col border-l border-border bg-background shadow-2xl sm:w-[420px]"
          aria-label="Proposal draft progress"
        >
          <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {drafting ? (
                  <>
                    <SparklesIcon className="size-3 animate-pulse" />
                    Writing into the template…
                  </>
                ) : (
                  'Proposal ready · saved to this RFP'
                )}
              </p>
              <p className="truncate text-xs text-faint">{rfp.title}</p>
            </div>
            <button
              type="button"
              onClick={() => setDraftHtml('')}
              className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              // Hidden mid-draft: closing would leave the panel unable to show
              // the rest, and the draft carries on regardless.
              disabled={drafting}
            >
              {drafting ? '' : 'Close'}
            </button>
          </header>

          {draftTotal > 0 && (
            <div className="h-1 w-full bg-surface-2">
              <div
                className="h-full bg-primary transition-[width] duration-300"
                style={{ width: `${Math.round((draftSteps.length / draftTotal) * 100)}%` }}
              />
            </div>
          )}

          <div ref={previewScroll} className="flex-1 overflow-y-auto p-4">
            {draftSteps.length === 0 && drafting && (
              <p className="text-[12px] italic text-faint">
                Reading the template and your house rules…
              </p>
            )}
            <ol className="space-y-1.5">
              {draftSteps.map((step, index) => (
                <li
                  key={`${step.label}-${index}`}
                  className={cn(
                    'flex items-start gap-2 text-[12px] leading-relaxed',
                    step.failed ? 'text-danger' : 'text-muted-foreground',
                  )}
                >
                  <span className="mt-[1px] shrink-0 font-mono text-[10px] text-faint">
                    {step.failed ? '✕' : '✓'}
                  </span>
                  <span className="min-w-0">{step.label}</span>
                </li>
              ))}
            </ol>

            {/* Said in the panel as well as in a toast. A toast that scrolled
                past is a warning nobody received, and every one of these means
                the document still carries the previous client's wording. */}
            {draftWarnings.length > 0 && (
              <div className="mt-4 space-y-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-[11.5px] leading-relaxed text-warning">
                {draftWarnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
            <span className="text-[10.5px] text-faint">
              {draftTotal > 0
                ? `${draftSteps.length} of ${draftTotal} sections`
                : 'Starting…'}
              {!drafting && draftHtml && ' · saved to this RFP'}
            </span>
            {/* Opening is a decision, not a side effect of drafting. The
                template carries its own Print / Save PDF button. */}
            {!drafting && draftHtml && (
              <Button variant="ghost" size="xs" onClick={() => openHtml(draftHtml)}>
                <ExternalLinkIcon />
                Open proposal
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
        //
        // Two different reasons land here and they need different sentences.
        // A claim means somebody is bidding it and the reader might have
        // expected to; a share means somebody deliberately handed it over to
        // be read, and telling that reader about "one proposal per tender"
        // answers a question they never asked.
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3">
          <LockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="text-xs leading-relaxed text-muted-foreground">
            {heldByOther ? (
              <>
                <span className="font-semibold text-foreground">
                  {heldByOther} is bidding this tender.
                </span>{' '}
                You can read everything here, but not draft, edit, attach a
                document or log against it — one proposal per tender is what
                stops two of ours reaching the same buyer. If it should be
                yours, ask them to hand it back.
              </>
            ) : (
              <>
                <span className="font-semibold text-foreground">
                  {memberNames.get(rfp.ownerId) ?? 'A colleague'} shared this
                  tender with you.
                </span>{' '}
                You can read everything here, but not edit, draft, attach a
                document or log against it. It stays theirs — ask them if you
                need it to become yours.
              </>
            )}
          </div>
        </div>
      )}

      {/*
        The tabs.

        Overview is everything this page already was, unchanged and still the
        default — the tender's own record, the drafter, the proposals, the
        activity. The other four are the intelligence layer's, and they are
        tabs rather than more panels on an already long page because they
        answer a different question: not "what is this tender" but "is it worth
        bidding, and what did the model make of it".

        Overview is hidden with CSS rather than unmounted, and that is the one
        deliberate exception: a proposal takes several minutes to write, and
        unmounting the page mid-draft would throw away the progress and the
        finished document with it. The intelligence tabs mount on demand, since
        each one is a fresh read from the database anyway.
      */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            aria-current={tab === entry.id ? 'page' : undefined}
            className={cn(
              '-mb-px cursor-pointer border-b-2 px-3 py-2 text-[12.5px] transition-colors',
              tab === entry.id
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab !== 'overview' && (
        <TenderIntelligence rfp={rfp} tab={tab} viewOnly={viewOnly} />
      )}

      <div
        className={cn(
          'grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]',
          tab !== 'overview' && 'hidden',
        )}
      >
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
              Fills the firm's designed proposal template against this notice —
              same layout, same house styling, this tender's content. Every
              piece of text is rewritten from the tender and your house rules;
              diagrams captioned for a previous client are removed rather than
              carried over. Anything the bid cannot evidence arrives as a marked
              placeholder for you to resolve. Saved below, and opened as a page
              you can print to PDF.
            </p>
            {!rfp.analysis && !rfp.tenderText && (
              <p className="mb-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-[11.5px] leading-relaxed text-warning">
                No Terms of Reference or saved reading is attached. Drafting will first
                fetch and analyse the source link; if there is no usable link, attach the
                tender document before continuing.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void handleDraft()} disabled={drafting}>
                <SparklesIcon />
                {drafting ? 'Drafting…' : 'Draft proposal'}
              </Button>
              {/* Next to the draft button rather than hidden in Settings: the
                  moment you want to see the prompt is the moment a draft came
                  out wrong, and that is here. */}
              <Button
                variant="ghost"
                onClick={() => void handlePreviewPrompt()}
                disabled={previewing || drafting}
                title="Show the prompt this record would produce, without drafting or spending an allowance"
              >
                <FileTextIcon />
                {previewing ? 'Reading…' : 'Preview prompt'}
              </Button>
            </div>
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
                        Version {proposal.versionNo} · {formatDateWithYear(proposal.createdAt.slice(0, 10))}
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
                      ) : proposal.design ? (
                        /* Written into the designed template, so it opens as
                           the document rather than downloading as Word — the
                           layout is the point, and Word cannot carry it. The
                           page has its own Print / Save PDF button. */
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={openingProposal === proposal.id}
                          onClick={() => void openDesigned(proposal)}
                        >
                          <ExternalLinkIcon />
                          {openingProposal === proposal.id ? 'Opening…' : 'Open'}
                        </Button>
                      ) : (
                        /* A draft from before the designed template, or a
                           pasted past proposal. Still Markdown, still Word. */
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

          <TenderAccess rfp={rfp} />
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

      <PromptPreviewDialog
        preview={promptPreview}
        open={promptOpen}
        onOpenChange={setPromptOpen}
      />
    </>
  )
}
