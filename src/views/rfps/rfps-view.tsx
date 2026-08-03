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
import { OPPORTUNITY_SYNC } from '@/lib/features'
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

export function RfpsView({
  onOpenProfile,
}: {
  onOpenProfile: (id: string) => void
}) {
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
  const [typeFilter, setTypeFilter] = useState<'all' | 'rfp' | 'job'>('all')
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
        if (typeFilter !== 'all' && rfp.opportunityType !== typeFilter) return false
        if (
          term &&
          !rfp.title.toLowerCase().includes(term) &&
          !rfp.org.toLowerCase().includes(term)
        ) {
          return false
        }
        return true
      })
      // Newest first: this page is a feed you triage as things arrive, so what
      // just landed should be at the top. Deadline urgency is carried by the
      // colour on the date, and by the dashboard's deadline panel.
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [rfps, search, status, hideInPipeline, typeFilter])

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
        toast.info('The CareerCraft feed returned nothing right now.')
      } else if (outcome.added === 0) {
        toast.info(
          `Already up to date — all ${outcome.fetched} opportunities in the feed are in your tracker.`,
        )
      } else {
        toast.success(
          `${outcome.added} new opportunit${outcome.added === 1 ? 'y' : 'ies'} added` +
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
        title="Opportunity tracker"
        description={
          OPPORTUNITY_SYNC
            ? 'Consultancy and training opportunities pulled every morning from World Bank, UNDP, UNGM and others. Click a title to open the original notice, and Add the ones worth bidding.'
            : 'Every opportunity you are tracking — tenders and consultancy assignments alike. Click a title to open the original notice, and Add the ones worth bidding.'
        }
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
        title="Sourced opportunities"
        action={
          !OPPORTUNITY_SYNC ? null : (
            <div className="flex items-center gap-2 text-[11px]">
              {busy ? (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <RefreshCwIcon className="size-3 animate-spin" />
                  Checking sources…
                </span>
              ) : autoSync === 'failed' ? (
                <span className="text-warning">
                  Could not reach the sources — showing what you already have
                </span>
              ) : syncedAt ? (
                <span className="text-faint">Updated {relativeTime(syncedAt)}</span>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleSync()}
                disabled={busy}
                title="Check every source for new opportunities now"
              >
                <RefreshCwIcon />
                Check now
              </Button>
            </div>
          )
        }
      >
        <p className="text-xs leading-relaxed text-muted-foreground">
          {!OPPORTUNITY_SYNC
            ? syncedCount > 0
              ? `Syncing is off — RFPs are added by hand. The ${syncedCount} already pulled are still here.`
              : 'Syncing is off — RFPs are added by hand.'
            : syncedCount > 0
              ? `${syncedCount} of your RFP${syncedCount === 1 ? '' : 's'} came from World Bank, UNDP, UNGM, IUCN or AfDB. New ones arrive every morning at 5am.`
              : 'Nothing synced yet. Sources are checked every morning at 5am — or press Check now.'}
        </p>
      </Panel>

      <Panel title="Paste sourced RFPs">
        <p className="mb-2.5 text-xs leading-relaxed text-muted-foreground">
          {OPPORTUNITY_SYNC
            ? 'For anything the sources do not cover: ask Claude in chat to search tender/NGO/government portals, then paste the JSON list it gives you here.'
            : 'Ask Claude in chat to search tender/NGO/government portals, then paste the JSON list it gives you here. Or use Add RFP above to enter one yourself.'}
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
        {/* The feed's own label. ReliefWeb files consultancy work under "job",
            so this narrows the list without being trusted as ground truth. */}
        <div className="flex rounded-lg border border-border bg-card p-0.5">
          {(['all', 'rfp', 'job'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTypeFilter(option)}
              className={cn(
                'cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase transition-colors',
                typeFilter === option
                  ? 'bg-brand-soft text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option === 'all' ? 'All' : option}
            </button>
          ))}
        </div>
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

      <Panel>
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
              <TableHead>Pipeline</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((rfp) => (
              <TableRow
                key={rfp.id}
                onClick={() => onOpenProfile(rfp.id)}
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
                  <span>{rfp.org || '—'}</span>
                  {(rfp.kenya || rfp.serviceAreas) && (
                    <span className="mt-1 flex flex-wrap items-center gap-1">
                      {rfp.kenya && (
                        <span className="rounded-full bg-success-soft px-1.5 py-px text-[10px] font-semibold text-success">
                          Kenya
                        </span>
                      )}
                      {rfp.serviceAreas && (
                        <span className="text-[10.5px] text-faint">{rfp.serviceAreas}</span>
                      )}
                    </span>
                  )}
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
