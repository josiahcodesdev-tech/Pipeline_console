import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangleIcon,
  DownloadIcon,
  FileTextIcon,
  HelpCircleIcon,
  TrashIcon,
  UploadIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Panel, EmptyState } from '@/shared/components/panel'
import {
  deleteRfpDocument,
  fetchLatestAnalysis,
  fetchRfpDocuments,
  rfpDocumentUrl,
  uploadRfpDocument,
} from '@/data/ai-intelligence'
import { formatDateWithYear } from '@/domain/dates'
import { cn } from '@/shared/utils'
import type { AiAnalysis, Rfp, RfpDocument } from '@/domain/types'

/**
 * What the Python intelligence layer concluded, and the files it read.
 *
 * EVERY PANEL HERE CAN BE EMPTY, AND SAYS SO DIFFERENTLY. "Not analysed yet"
 * and "analysed, and found nothing" are different facts about a tender and the
 * second one is a finding. Collapsing them into one blank panel is how a bid
 * team learns to ignore the tab.
 *
 * NOTHING HERE WRITES AN ANALYSIS. The scores arrive over Postgres from a
 * service this page never calls, and migration 0041 gives the browser no
 * insert policy on those tables — so a page that tried would be refused by the
 * database, not merely by this file. Documents are the exception: a person
 * uploads those, so this does write them.
 */

export type IntelligenceTab = 'documents' | 'intelligence' | 'capability' | 'similar'

const KIND_LABEL: Record<string, string> = {
  tor: 'Terms of Reference',
  rfp: 'RFP',
  evaluation: 'Evaluation criteria',
  annex: 'Annex',
  other: 'Document',
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A 0-100 figure as a bar. Colour follows the number, not the label. */
function ScoreBar({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className="font-display text-[19px] leading-none text-foreground">{value}%</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn(
            'h-full rounded-full transition-[width]',
            value >= 60 ? 'bg-success' : value >= 25 ? 'bg-warning' : 'bg-danger',
          )}
          style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  )
}

function Bullets({ items, tone }: { items: string[]; tone?: 'warning' | 'muted' }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li
          key={item}
          className={cn(
            'flex gap-2 text-[12px] leading-relaxed',
            tone === 'warning' ? 'text-warning' : 'text-muted-foreground',
          )}
        >
          <span className="mt-[3px] shrink-0 text-faint">·</span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The state every panel starts in, said plainly.
 *
 * Separated from an empty result on purpose — see the note at the top. This is
 * also where the operator is told what to run, because "no analysis" almost
 * always means the service has not been pointed at this database rather than
 * that anything went wrong.
 */
function NotAnalysed() {
  return (
    <EmptyState icon={<HelpCircleIcon className="size-5" />} hint="Run: python -m ai_tender_intelligence.scheduler --once">
      This tender has not been analysed yet
    </EmptyState>
  )
}

export function TenderIntelligence({
  rfp,
  tab,
  viewOnly,
}: {
  rfp: Rfp
  tab: IntelligenceTab
  viewOnly: boolean
}) {
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null)
  const [documents, setDocuments] = useState<RfpDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [opening, setOpening] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Together rather than in sequence: they are independent, and the
      // documents list is what the page shows while the analysis is missing.
      const [latest, files] = await Promise.all([
        fetchLatestAnalysis(rfp.id),
        fetchRfpDocuments(rfp.id),
      ])
      setAnalysis(latest)
      setDocuments(files)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [rfp.id])

  useEffect(() => {
    void load()
  }, [load])

  async function handleUpload(file: File | undefined) {
    if (!file) return
    setUploading(true)
    try {
      const saved = await uploadRfpDocument(rfp.id, file)
      setDocuments((current) => [...current, saved])
      toast.success(
        `${file.name} attached. The intelligence layer reads it on its next pass.`,
      )
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function handleOpen(document: RfpDocument) {
    setOpening(document.id)
    try {
      const url = await rfpDocumentUrl(document.filePath)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setOpening('')
    }
  }

  async function handleDelete(document: RfpDocument) {
    try {
      await deleteRfpDocument(document)
      setDocuments((current) => current.filter((item) => item.id !== document.id))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const priority = useMemo(() => {
    if (!analysis) return null
    if (analysis.recommendation === 'Decline') return { label: 'LOW PRIORITY', tone: 'danger' as const }
    if (analysis.score >= 75 && analysis.recommendation === 'Pursue') {
      return { label: 'HIGH PRIORITY BID', tone: 'success' as const }
    }
    if (analysis.score >= 50) return { label: 'WORTH REVIEWING', tone: 'warning' as const }
    return { label: 'LOW PRIORITY', tone: 'danger' as const }
  }, [analysis])

  if (loading) {
    return (
      <Panel title="Reading…">
        <p className="text-[12px] text-faint">Loading the intelligence layer's findings.</p>
      </Panel>
    )
  }

  // ------------------------------------------------------------- documents
  if (tab === 'documents') {
    return (
      <Panel
        title="Documents"
        description="The TOR, the RFP and anything else that came with this tender. Stored, not just read — so page 14 can be re-read and an annex can be sent on."
        action={<span className="text-[11px] text-faint">{documents.length}</span>}
      >
        {documents.length === 0 ? (
          <EmptyState icon={<FileTextIcon className="size-5" />} hint="Attach the Terms of Reference and everything downstream gets better: the summary, the bid assessment and the proposal.">
            No documents attached
          </EmptyState>
        ) : (
          documents.map((document) => (
            <div key={document.id} className="border-b border-border-soft py-3 last:border-b-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="mr-2 inline-block rounded-full bg-brand-soft px-2 py-0.5 text-[10.5px] font-semibold text-primary">
                    {KIND_LABEL[document.kind] ?? KIND_LABEL.other}
                  </span>
                  <span className="text-[12.5px] font-medium text-foreground">
                    {document.fileName}
                  </span>
                  <div className="mt-1 text-[11px] text-faint">
                    {formatDateWithYear(document.uploadedDate)}
                    {document.fileSize ? ` · ${formatBytes(document.fileSize)}` : ''}
                    {' · '}
                    {document.extractedText
                      ? `${document.extractedText.length.toLocaleString()} characters read`
                      : 'not read yet'}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={opening === document.id}
                    onClick={() => void handleOpen(document)}
                  >
                    <DownloadIcon />
                    {opening === document.id ? 'Opening…' : 'Open'}
                  </Button>
                  {!viewOnly && (
                    <button
                      type="button"
                      onClick={() => void handleDelete(document)}
                      aria-label={`Remove ${document.fileName}`}
                      className="cursor-pointer px-1 text-faint transition-colors hover:text-danger"
                    >
                      <TrashIcon className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* What the layer made of the file, or why it could not read it.
                  A scanned TOR yields a page count and no text, and saying so
                  is the difference between a file nobody has read and one that
                  cannot be read without OCR. */}
              {document.aiSummary && (
                <p className="mt-2 max-w-[90ch] text-[11.5px] leading-relaxed text-muted-foreground">
                  {document.aiSummary}
                </p>
              )}
            </div>
          ))
        )}

        {!viewOnly && (
          <div className="mt-3 border-t border-border-soft pt-3">
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.doc,.docx,.odt,.rtf,.txt,.xls,.xlsx,.zip"
              onChange={(event) => void handleUpload(event.target.files?.[0])}
              disabled={uploading}
              className="block w-full text-[11.5px] text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-[11.5px] file:text-foreground"
            />
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-faint">
              {uploading ? (
                <>
                  <UploadIcon className="size-3 animate-pulse" />
                  Uploading…
                </>
              ) : (
                'Up to 25 MB. Read on the intelligence layer’s next pass.'
              )}
            </p>
          </div>
        )}
      </Panel>
    )
  }

  // ---------------------------------------------------------- intelligence
  if (tab === 'intelligence') {
    if (!analysis) {
      return (
        <Panel title="AI intelligence">
          <NotAnalysed />
        </Panel>
      )
    }

    return (
      <div className="space-y-5">
        <Panel
          title="RFP intelligence summary"
          action={
            priority && (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
                  priority.tone === 'success'
                    ? 'bg-success-soft text-success'
                    : priority.tone === 'warning'
                      ? 'bg-warning-soft text-warning'
                      : 'bg-danger-soft text-danger',
                )}
              >
                {priority.label}
              </span>
            )
          }
        >
          <p className="max-w-[90ch] text-[13px] leading-relaxed text-foreground">
            {analysis.summary}
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <ScoreBar value={analysis.score} label="Capability match" />
            <ScoreBar value={analysis.winProbability} label="Resembles past wins" />
          </div>

          <p className="mt-3 text-[11px] text-faint">
            {analysis.recommendation ? `Recommendation: ${analysis.recommendation}` : 'No recommendation'}
            {' · read from '}
            {analysis.sourceKind || 'unknown source'}
            {' · model '}
            {analysis.modelVersion || 'unversioned'}
            {' · '}
            {formatDateWithYear(analysis.createdAt.slice(0, 10))}
          </p>
        </Panel>

        {analysis.reasons.length > 0 && (
          <Panel title="Why it says that" description="The sentences behind the scores, in the order the analyser made them.">
            <Bullets items={analysis.reasons} />
          </Panel>
        )}

        {analysis.requirements.length > 0 && (
          <Panel title="Key requirements" description="Deliverables first, then what a bidder must be or hold.">
            <Bullets items={analysis.requirements} />
          </Panel>
        )}

        {analysis.risks.length > 0 && (
          <Panel title="Risks" action={<AlertTriangleIcon className="size-3.5 text-warning" />}>
            <Bullets items={analysis.risks} tone="warning" />
          </Panel>
        )}

        {/* Absences, shown rather than skipped. The analyser never fills a gap
            with what is typical, so this is where an unstated budget or a
            missing deadline surfaces as something to go and find out. */}
        {analysis.missingInformation.length > 0 && (
          <Panel
            title="Missing information"
            description="What the tender does not say. None of it was guessed at."
          >
            <Bullets items={analysis.missingInformation} />
          </Panel>
        )}
      </div>
    )
  }

  // ------------------------------------------------------------ capability
  if (tab === 'capability') {
    if (!analysis) {
      return (
        <Panel title="Capability match">
          <NotAnalysed />
        </Panel>
      )
    }

    return (
      <div className="space-y-5">
        <Panel
          title="Capability match"
          description="Scored against capability_profile.json — the services, weights and phrases the firm sells."
        >
          <ScoreBar value={analysis.score} label="Overall match" />

          {analysis.matchedCapabilities.length === 0 ? (
            <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
              Nothing in the capability statement appears in this tender. That is a
              finding, not a gap in the analysis — this looks like work the firm
              does not sell.
            </p>
          ) : (
            <div className="mt-4 space-y-3.5">
              {analysis.matchedCapabilities.map((item) => (
                <div key={item.service} className="border-b border-border-soft pb-3 last:border-b-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[12.5px] font-medium text-foreground">{item.service}</span>
                    <span className="text-[11px] text-faint">
                      {item.score}% depth · weight {item.weight}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(2, Math.min(100, item.score))}%` }}
                    />
                  </div>
                  {item.matched_terms?.length > 0 && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
                      Matched on: {item.matched_terms.join(', ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>

        {analysis.themes.length > 0 && (
          <Panel title="Themes" description="Named in the capability statement's own words, not free text.">
            <div className="flex flex-wrap gap-1.5">
              {analysis.themes.map((theme) => (
                <span key={theme} className="rounded-full bg-brand-soft px-2.5 py-1 text-[11px] text-primary">
                  {theme}
                </span>
              ))}
            </div>
          </Panel>
        )}

        {analysis.keywords.length > 0 && (
          <Panel title="Keywords" description="The terms that distinguish this tender from tenders in general.">
            <div className="flex flex-wrap gap-1.5">
              {analysis.keywords.slice(0, 24).map((keyword) => (
                <span key={keyword} className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
                  {keyword}
                </span>
              ))}
            </div>
          </Panel>
        )}
      </div>
    )
  }

  // --------------------------------------------------------------- similar
  if (!analysis) {
    return (
      <Panel title="Similar past bids">
        <NotAnalysed />
      </Panel>
    )
  }

  return (
    <Panel
      title="Similar past bids"
      description="Decided bids this tender resembles. Wins and losses both — a strong resemblance to something lost is worth as much as the other kind."
    >
      {analysis.similarBids.length === 0 ? (
        <EmptyState icon={<FileTextIcon className="size-5" />} hint="Mark tenders Won or Lost and the model starts having something to compare against.">
          Nothing on record resembles this tender
        </EmptyState>
      ) : (
        analysis.similarBids.map((bid) => (
          <div key={bid.rfp_id} className="border-b border-border-soft py-3 last:border-b-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <span
                  className={cn(
                    'mr-2 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
                    bid.outcome === 'Won' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
                  )}
                >
                  {bid.outcome}
                </span>
                <span className="text-[12.5px] text-foreground">{bid.title}</span>
              </div>
              <span className="shrink-0 text-[11px] text-faint">{bid.similarity}% alike</span>
            </div>
            {bid.shared?.length > 0 && (
              <p className="mt-1 text-[11px] leading-relaxed text-faint">
                Shares: {bid.shared.join(', ')}
              </p>
            )}
          </div>
        ))
      )}
    </Panel>
  )
}
