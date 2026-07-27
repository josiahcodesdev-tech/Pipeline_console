import { useMemo, useState } from 'react'
import {
  CheckIcon,
  ClipboardListIcon,
  ExternalLinkIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchXIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState, Panel, ViewHeader } from '@/components/panel'
import { FilterSelect } from '@/components/field'
import { RfpStatusSelect } from '@/components/status-select'
import { usePipeline } from '@/hooks/use-pipeline'
import { daysUntil, formatDateWithYear, formatKes } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { RFP_STATUSES, type Rfp, type RfpStatus } from '@/lib/types'
import { RfpDialog } from './rfp-dialog'
import { parseRfpImport } from './import-rfps'

const PLACEHOLDER = `[{"title":"...","org":"...","segment":"NGO","deadline":"2026-08-15","value":500000,"link":"https://...","source":"TendersOnTime","notes":"..."}]`

/** Deadline urgency is a warning, not decoration — ≤2 days reads as danger. */
function deadlineClass(days: number | null): string {
  if (days === null) return ''
  if (days <= 2) return 'font-semibold text-danger'
  if (days <= 5) return 'text-warning'
  return ''
}

/** "just now" / "14 minutes ago" / "3 hours ago" — enough for a status line. */
function relativeTime(epochMs: number): string {
  const seconds = Math.round((Date.now() - epochMs) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function RfpsView() {
  const {
    rfps,
    saveRfp,
    removeRfp,
    setRfpStatus,
    setRfpPipeline,
    importRfps,
    syncOpportunities,
    autoSync,
    syncedAt,
  } = usePipeline()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<RfpStatus | 'all'>('all')
  // The tracker is a firehose; hiding what is already taken on makes triage
  // of the remainder much easier.
  const [hideInPipeline, setHideInPipeline] = useState(false)
  const [json, setJson] = useState('')
  const [importing, setImporting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [editing, setEditing] = useState<Rfp | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  /** Either the automatic sync or a manual "Check now" is in flight. */
  const busy = syncing || autoSync === 'syncing'

  const syncedCount = useMemo(
    () => rfps.filter((rfp) => rfp.externalId).length,
    [rfps],
  )

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rfps
      .filter((rfp) => {
        if (status !== 'all' && rfp.status !== status) return false
        if (hideInPipeline && rfp.inPipeline) return false
        if (
          term &&
          !rfp.title.toLowerCase().includes(term) &&
          !rfp.org.toLowerCase().includes(term)
        ) {
          return false
        }
        return true
      })
      // Undated RFPs sort last rather than first — they are not urgent.
      .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'))
  }, [rfps, search, status, hideInPipeline])

  async function handleImport() {
    setImporting(true)
    try {
      const { drafts, skipped } = parseRfpImport(json)
      if (drafts.length === 0) {
        toast.error(
          skipped.length ? `Nothing imported. ${skipped[0]}` : 'Nothing to import',
        )
        return
      }
      const count = await importRfps(drafts)
      setJson('')
      if (skipped.length) {
        toast.warning(
          `${count} RFP${count === 1 ? '' : 's'} imported · ${skipped.length} skipped (${skipped[0]})`,
        )
      } else {
        toast.success(`${count} RFP${count === 1 ? '' : 's'} imported`)
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setImporting(false)
    }
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const outcome = await syncOpportunities()
      if (outcome.fetched === 0) {
        toast.info('The CareerCraft feed returned no RFPs right now.')
      } else if (outcome.added === 0) {
        toast.info(
          `Already up to date — all ${outcome.fetched} RFPs in the feed are in your tracker.`,
        )
      } else {
        toast.success(
          `${outcome.added} new RFP${outcome.added === 1 ? '' : 's'} added` +
            (outcome.alreadyHave ? ` · ${outcome.alreadyHave} already tracked` : ''),
        )
      }
      if (outcome.skipped.length) {
        toast.warning(
          `${outcome.skipped.length} feed row${outcome.skipped.length === 1 ? '' : 's'} skipped (${outcome.skipped[0]})`,
        )
      }
      // The "Updated …" stamp is set inside syncOpportunities, so both this
      // manual check and the automatic run refresh it.
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSyncing(false)
    }
  }

  function open(rfp: Rfp | null) {
    setEditing(rfp)
    setDialogOpen(true)
  }

  return (
    <>
      <ViewHeader
        eyebrow="Bid pipeline"
        title="RFP & tender tracker"
        description="Open opportunities sorted by deadline. Scraped tenders arrive on their own; click a title to open the original notice."
        meta={
          <span className="text-[11px] text-muted-foreground">
            {rfps.length} {rfps.length === 1 ? 'opportunity' : 'opportunities'}
          </span>
        }
        action={
          <Button onClick={() => open(null)}>
            <PlusIcon />
            Add RFP
          </Button>
        }
      />

      <Panel
        title="Scraped opportunities"
        action={
          <div className="flex items-center gap-2 text-[11px]">
            {busy ? (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <RefreshCwIcon className="size-3 animate-spin" />
                Checking CareerCraft…
              </span>
            ) : autoSync === 'failed' ? (
              <span className="text-warning">
                Could not reach CareerCraft — showing what you already have
              </span>
            ) : syncedAt ? (
              <span className="text-faint">Updated {relativeTime(syncedAt)}</span>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleSync()}
              disabled={busy}
              title="Check CareerCraft for new RFPs now"
            >
              <RefreshCwIcon />
              Check now
            </Button>
          </div>
        }
      >
        <p className="text-xs leading-relaxed text-muted-foreground">
          {syncedCount > 0
            ? `${syncedCount} of your RFP${syncedCount === 1 ? '' : 's'} came from the scraper.`
            : 'Nothing synced from the scraper yet.'}
        </p>
      </Panel>

      <Panel title="Paste sourced RFPs">
        <p className="mb-2.5 text-xs leading-relaxed text-muted-foreground">
          For anything the scraper does not cover: ask Claude in chat to search
          tender/NGO/government portals, then paste the JSON list it gives you
          here.
        </p>
        <Textarea
          value={json}
          onChange={(event) => setJson(event.target.value)}
          placeholder={PLACEHOLDER}
          aria-label="RFP JSON to import"
          className="mb-3 min-h-[80px] w-full"
        />
        <Button onClick={() => void handleImport()} disabled={importing}>
          {importing ? 'Importing…' : 'Import into tracker'}
        </Button>
      </Panel>

      <div className="mb-3.5 flex flex-wrap gap-2">
        <Input
          placeholder="Search title or org…"
          aria-label="Search RFPs"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-[220px]"
        />
        <FilterSelect
          value={status}
          options={RFP_STATUSES}
          onChange={setStatus}
          allLabel="All statuses"
          ariaLabel="Filter by status"
        />
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 text-[11.5px] text-muted-foreground">
          <input
            type="checkbox"
            checked={hideInPipeline}
            onChange={(event) => setHideInPipeline(event.target.checked)}
            className="size-3.5 accent-[var(--primary)]"
          />
          Hide ones already in the pipeline
        </label>
      </div>

      <Panel bodyClassName="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Organization</TableHead>
              <TableHead>Segment</TableHead>
              <TableHead>Deadline</TableHead>
              <TableHead className="text-right">Value (KES)</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((rfp) => (
              <TableRow
                key={rfp.id}
                onClick={() => open(rfp)}
                className="cursor-pointer"
              >
                <TableCell className="max-w-[380px] font-medium">
                  {rfp.link ? (
                    // Opens the source notice. `stopPropagation` keeps the row
                    // click (which opens the edit dialog) working everywhere
                    // else in the row.
                    <a
                      href={rfp.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      className="group inline-flex items-start gap-1 text-primary hover:underline"
                      title="Open the original notice in a new tab"
                    >
                      <span>{rfp.title}</span>
                      <ExternalLinkIcon className="mt-0.5 size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
                    </a>
                  ) : (
                    rfp.title
                  )}
                </TableCell>
                <TableCell className="max-w-[200px] text-muted-foreground">
                  {rfp.org || '—'}
                </TableCell>
                <TableCell>
                  <span className="inline-block whitespace-nowrap rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {rfp.segment}
                  </span>
                </TableCell>
                <TableCell
                  className={cn(
                    'whitespace-nowrap',
                    deadlineClass(daysUntil(rfp.deadline)),
                  )}
                >
                  {formatDateWithYear(rfp.deadline)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {formatKes(rfp.value)}
                </TableCell>
                <TableCell>
                  <span className="inline-block whitespace-nowrap rounded-full bg-gold-soft px-2 py-0.5 text-[11px] font-medium text-warning">
                    {rfp.source || 'Manual'}
                  </span>
                </TableCell>
                <TableCell>
                  <RfpStatusSelect
                    value={rfp.status}
                    onChange={(next) => setRfpStatus(rfp.id, next)}
                  />
                </TableCell>
                <TableCell onClick={(event) => event.stopPropagation()}>
                  {rfp.inPipeline ? (
                    <button
                      type="button"
                      onClick={() => void setRfpPipeline(rfp.id, false)}
                      title="Remove from the proposal pipeline"
                      className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-full bg-success-soft px-2 py-1 text-[11px] font-semibold text-success transition-opacity hover:opacity-75"
                    >
                      <CheckIcon className="size-3" />
                      In pipeline
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void setRfpPipeline(rfp.id, true)}
                      title="Take this on as a live proposal"
                      className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-full border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-brand-soft hover:text-primary"
                    >
                      <PlusIcon className="size-3" />
                      Add
                    </button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {filtered.length === 0 &&
          (rfps.length === 0 ? (
            <EmptyState
              icon={<ClipboardListIcon className="size-5" />}
              hint="Scraped tenders sync in on their own. Add anything you spot elsewhere with the button above."
            >
              No RFPs tracked yet
            </EmptyState>
          ) : (
            <EmptyState
              icon={<SearchXIcon className="size-5" />}
              hint="Try a broader search, or set the status filter back to all."
            >
              No RFPs match these filters
            </EmptyState>
          ))}
      </Panel>

      <RfpDialog
        rfp={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={saveRfp}
        onDelete={removeRfp}
      />
    </>
  )
}
