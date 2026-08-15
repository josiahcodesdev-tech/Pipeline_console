import { useMemo, useState } from 'react'
import {
  CheckIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  ExternalLinkIcon,
  LockIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchXIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table'
import { EmptyState, Panel, ViewHeader } from '@/shared/components/panel'
import { FilterSelect } from '@/shared/components/field'
import { RfpStatusSelect } from '@/shared/components/status-select'
import { usePipeline } from '@/shared/hooks/use-pipeline'
import { daysUntil, formatDateWithYear, formatKes, today } from '@/domain/dates'
import { cn } from '@/shared/utils'
import { RFP_STATUSES, type Rfp, type RfpStatus } from '@/domain/types'
import { OPPORTUNITY_SYNC } from '@/app/features'
import { useAuth } from '@/shared/hooks/use-auth'
import { useMemberNames } from '@/shared/hooks/use-member-names'
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

/**
 * `serviceAreas` is stored comma-joined ("Training & Capacity Building, M&E");
 * this is its parsed form.
 *
 * Filtering matches whole entries rather than substrings, so picking
 * "Research & Assessment" cannot also drag in unrelated areas that happen to
 * share a word.
 */
function areasOf(rfp: Rfp): string[] {
  return rfp.serviceAreas
    .split(',')
    .map((area) => area.trim())
    .filter(Boolean)
}

type SortKey = 'fit' | 'deadline' | 'newest'

/**
 * `newest` leads, and is the default.
 *
 * It sorts on when the sync brought the notice in, not on when the buyer
 * published it — the sources rarely say, and the useful question at a tracker
 * holding a thousand rows is "what has arrived since I last looked?". Its label
 * used to read "Most recently published first", which claimed a publication
 * date the row does not carry.
 */
const SORTS: ReadonlyArray<{ key: SortKey; label: string; title: string }> = [
  { key: 'newest', label: 'Latest obtained', title: 'Most recently obtained first' },
  { key: 'fit', label: 'Best fit', title: 'How well it matches what Vantage Africa delivers' },
  { key: 'deadline', label: 'Deadline', title: 'Soonest closing first' },
]

function SortToggle({
  value,
  onChange,
}: {
  value: SortKey
  onChange: (next: SortKey) => void
}) {
  return (
    <div className="flex rounded-lg border border-border bg-card p-0.5">
      {SORTS.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          title={option.title}
          className={cn(
            'cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
            value === option.key
              ? 'bg-brand-soft text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * The fit score as a readable band.
 *
 * A bare number invites false precision — 62 is not meaningfully better than
 * 58, and showing both as "Good" says what the score can actually support. The
 * number stays in the tooltip for anyone who wants it.
 */
function FitBadge({ score }: { score: number }) {
  if (score <= 0) {
    return <span className="text-[11px] text-faint">—</span>
  }
  const band =
    score >= 80
      ? { label: 'Strong', className: 'bg-success-soft text-success' }
      : score >= 50
        ? { label: 'Good', className: 'bg-brand-soft text-primary' }
        : { label: 'Partial', className: 'bg-surface-2 text-muted-foreground' }
  return (
    <span
      title={`Fit score ${score}/100 — how well this matches what Vantage Africa delivers`}
      className={cn(
        'inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium',
        band.className,
      )}
    >
      {band.label}
    </span>
  )
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
    claims,
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
  // On by default: a closed tender cannot be bid on, so it is clutter rather
  // than information. The sync already refuses to import anything past its
  // deadline, but rows age in place — what arrived open in August is closed by
  // September — so the list has to filter as well.
  const [hideExpired, setHideExpired] = useState(true)
  const [typeFilter, setTypeFilter] = useState<'all' | 'rfp' | 'job'>('all')
  // Which of the six services from the capability statement it touches.
  const [areaFilter, setAreaFilter] = useState<string>('all')
  const [obtainedToday, setObtainedToday] = useState(false)
  // Newest first. Best fit sorts the whole tracker the same way every day, so
  // the notices that arrived overnight land wherever their score puts them —
  // often pages down, among rows already read and passed over. What someone
  // opening this page wants first is what is new; fit is one click away.
  const [sort, setSort] = useState<SortKey>('newest')
  const [json, setJson] = useState('')
  const [importing, setImporting] = useState(false)
  const { can, profile } = useAuth()
  const members = useMemberNames()

  /**
   * Who holds this tender, if it is someone other than the reader.
   *
   * Returns null for an unclaimed tender and for one the reader holds
   * themselves — the caller already renders those two cases differently.
   */
  const takenBy = (rfp: Rfp): string | null => {
    if (!rfp.externalId) return null
    const claim = claims.get(rfp.externalId)
    if (!claim || claim.claimedBy === profile?.id) return null
    return members.get(claim.claimedBy) ?? 'Another member'
  }

  const [syncing, setSyncing] = useState(false)
  const [editing, setEditing] = useState<Rfp | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  /** Either the automatic sync or a manual "Check now" is in flight. */
  const busy = syncing || autoSync === 'syncing'

  const syncedCount = useMemo(
    () => rfps.filter((rfp) => rfp.externalId).length,
    [rfps],
  )

  /**
   * True once the deadline is in the past.
   *
   * A missing deadline is NOT treated as closed — some sources (AfDB) publish
   * the notice without one, and hiding those would quietly drop real work on
   * the basis of a field the source never filled in.
   */
  const isClosed = (rfp: Rfp): boolean => {
    const days = daysUntil(rfp.deadline)
    return days !== null && days < 0
  }

  const closedCount = useMemo(() => rfps.filter(isClosed).length, [rfps])

  /**
   * Built from the data, not hardcoded.
   *
   * Rows synced before the current taxonomy carry their own labels ("M&E"
   * rather than "Monitoring & Evaluation"), and a fixed list would silently
   * make those unreachable. This also means the filter gains new areas by
   * itself as the tagging in the Edge Function grows.
   */
  const serviceAreaOptions = useMemo(() => {
    const found = new Set<string>()
    for (const rfp of rfps) for (const area of areasOf(rfp)) found.add(area)
    return [...found].sort((a, b) => a.localeCompare(b))
  }, [rfps])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rfps
      .filter((rfp) => {
        if (status !== 'all' && rfp.status !== status) return false
        if (hideInPipeline && rfp.inPipeline) return false
        if (hideExpired && isClosed(rfp)) return false
        if (typeFilter !== 'all' && rfp.opportunityType !== typeFilter) return false
        if (areaFilter !== 'all' && !areasOf(rfp).includes(areaFilter)) return false
        if (obtainedToday && rfp.createdOn !== today()) return false
        if (
          term &&
          !rfp.title.toLowerCase().includes(term) &&
          !rfp.org.toLowerCase().includes(term)
        ) {
          return false
        }
        return true
      })
      .sort((a, b) => {
        // The capability filter already decided everything here is biddable, so
        // sorting only answers which to read first. Ties fall through to the
        // soonest deadline, because between two equally good opportunities the
        // closer one is the more urgent, and finally to date brought in.
        if (sort === 'fit' && a.fitScore !== b.fitScore) {
          return b.fitScore - a.fitScore
        }
        if (sort !== 'newest') {
          const left = daysUntil(a.deadline)
          const right = daysUntil(b.deadline)
          // Undated notices sort last — they cannot claim urgency they have
          // not stated.
          if (left === null && right !== null) return 1
          if (right === null && left !== null) return -1
          if (left !== null && right !== null && left !== right) return left - right
        }
        return b.createdAt.localeCompare(a.createdAt)
      })
  }, [rfps, search, status, hideInPipeline, hideExpired, typeFilter, areaFilter, obtainedToday, sort])

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
        toast.info('No opportunities came back from any source right now.')
      } else if (outcome.added === 0) {
        toast.info(
          `Already up to date — all ${outcome.fetched} opportunities found are in your tracker.`,
        )
      } else {
        toast.success(
          `${outcome.added} new opportunit${outcome.added === 1 ? 'y' : 'ies'} added` +
            (outcome.alreadyHave ? ` · ${outcome.alreadyHave} already tracked` : ''),
        )
      }
      // Whole sources, not rows — one entry here means one site could not be
      // reached, and the others carried on without it.
      if (outcome.skipped.length) {
        toast.warning(
          `${outcome.skipped.length} source${outcome.skipped.length === 1 ? '' : 's'} unavailable (${outcome.skipped[0]})`,
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
            ? 'Consultancy and training opportunities pulled every morning from World Bank, UNDP, UNGM and others. Open a row to see the record and draft a proposal; the title link goes to the original notice.'
            : 'Every opportunity you are tracking — tenders and consultancy assignments alike. Open a row to see the record and draft a proposal; the title link goes to the original notice.'
        }
        meta={
          <span className="text-[11px] text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? 'opportunity' : 'opportunities'}
            {hideExpired && closedCount > 0 ? ` · ${closedCount} closed` : ''}
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
              {/* The 5am run is unaffected by this — it is triggered by the
                  scheduler with the project's own key, not by a member. Only
                  pulling the sources by hand is restricted. */}
              {can.sync && (
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
              )}
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
              ? `${syncedCount} of your RFP${syncedCount === 1 ? '' : 's'} came from World Bank, UNDP, UNGM, IUCN, AfDB or NGO Jobs in Africa. New ones arrive every morning at 5am.`
              : can.sync
                ? 'Nothing synced yet. Sources are checked every morning at 5am — or press Check now.'
                : 'Nothing synced yet. Sources are checked every morning at 5am.'}
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
        {/* Hidden until something is actually tagged, so a fresh tracker does
            not show a filter with nothing but "All" behind it. */}
        {serviceAreaOptions.length > 0 && (
          <FilterSelect
            value={areaFilter}
            options={serviceAreaOptions}
            onChange={setAreaFilter}
            allLabel="All service areas"
            ariaLabel="Filter by service area"
          />
        )}
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
        <SortToggle value={sort} onChange={setSort} />
        <button
          type="button"
          onClick={() => setObtainedToday((current) => !current)}
          className={cn(
            'cursor-pointer rounded-lg border px-3 py-1 text-[11.5px] font-medium transition-colors',
            obtainedToday
              ? 'border-primary bg-brand-soft text-primary'
              : 'border-border bg-card text-muted-foreground hover:text-foreground',
          )}
          aria-pressed={obtainedToday}
        >
          Obtained today
        </button>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 text-[11.5px] text-muted-foreground">
          <input
            type="checkbox"
            checked={hideInPipeline}
            onChange={(event) => setHideInPipeline(event.target.checked)}
            className="size-3.5 accent-[var(--primary)]"
          />
          Hide ones already in the pipeline
        </label>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 text-[11.5px] text-muted-foreground">
          <input
            type="checkbox"
            checked={hideExpired}
            onChange={(event) => setHideExpired(event.target.checked)}
            className="size-3.5 accent-[var(--primary)]"
          />
          Hide closed deadlines
        </label>
      </div>

      <Panel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Organization</TableHead>
              <TableHead>Segment</TableHead>
              <TableHead>Fit</TableHead>
              <TableHead>Deadline</TableHead>
              <TableHead className="text-right">Value (KES)</TableHead>
              <TableHead>Date obtained</TableHead>
              <TableHead>Source site</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Pipeline</TableHead>
              {/* The whole row opens the record, but that is an invisible
                  gesture — and the title next to it is a link to the external
                  notice that stops propagation, so the most obvious thing to
                  click is the one thing that does NOT open it. This column
                  makes the way in visible. */}
              <TableHead className="text-right">Open</TableHead>
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
                <TableCell>
                  <FitBadge score={rfp.fitScore} />
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
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDateWithYear(rfp.createdOn)}
                </TableCell>
                <TableCell>
                  <span className="whitespace-nowrap text-muted-foreground">
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
                      title="Hand this tender back so someone else can take it"
                      className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-full bg-success-soft px-2 py-1 text-[11px] font-semibold text-success transition-opacity hover:opacity-75"
                    >
                      <CheckIcon className="size-3" />
                      In pipeline
                    </button>
                  ) : takenBy(rfp) ? (
                    // Taken by a colleague. Shown rather than hidden: knowing a
                    // tender is covered is as useful as being able to take it,
                    // and a row that quietly vanished would read as a bug.
                    <span
                      title={`${takenBy(rfp)} is bidding this. One proposal per tender — ask them if you should be on it.`}
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-border bg-surface-2 px-2 py-1 text-[11px] font-medium text-muted-foreground"
                    >
                      <LockIcon className="size-3" aria-hidden />
                      {takenBy(rfp)}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void setRfpPipeline(rfp.id, true)}
                      title="Take this on as a live proposal — nobody else will be able to"
                      className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-full border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-brand-soft hover:text-primary"
                    >
                      <PlusIcon className="size-3" />
                      Add
                    </button>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <button
                    type="button"
                    onClick={() => onOpenProfile(rfp.id)}
                    title="Open the record — activity, proposals and the drafter"
                    className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-brand-soft hover:text-primary"
                  >
                    Open
                    <ChevronRightIcon className="size-3" />
                  </button>
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
