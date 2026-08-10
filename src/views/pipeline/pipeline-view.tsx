import { useMemo } from 'react'
import { ExternalLinkIcon, TargetIcon, XIcon } from 'lucide-react'
import { EmptyState, Panel, ViewHeader } from '@/components/panel'
import { KpiCard } from '@/components/kpi-card'
import { RfpStatusSelect } from '@/components/status-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { usePipeline } from '@/hooks/use-pipeline'
import { useAuth } from '@/hooks/use-auth'
import { useMemberNames } from '@/lib/members'
import { toDisplayName } from '@/lib/usernames'
import {
  daysUntil,
  formatDateWithYear,
  formatKes,
  periodRange,
  today,
} from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { Rfp, RfpStatus } from '@/lib/types'

/** Open first, then decided — a live bid outranks a closed one. */
const SECTIONS: { status: RfpStatus; blurb: string }[] = [
  { status: 'Preparing', blurb: 'Being written now' },
  { status: 'Submitted', blurb: 'With the buyer, awaiting outcome' },
  { status: 'Won', blurb: 'Closed — won' },
  { status: 'Lost', blurb: 'Closed — not successful' },
  { status: 'Watching', blurb: 'Taken on but not started' },
]

function DeadlineCell({ deadline }: { deadline: string }) {
  const left = daysUntil(deadline)
  if (left === null) return <span className="text-muted-foreground">No deadline</span>

  const overdue = left < 0
  const label = overdue
    ? `${Math.abs(left)}d overdue`
    : left === 0
      ? 'due today'
      : `in ${left}d`

  return (
    <span
      className={cn(
        'flex flex-col gap-0.5',
        overdue || left <= 2
          ? 'text-danger'
          : left <= 5
            ? 'text-warning'
            : 'text-foreground',
      )}
    >
      <span className="font-medium">{formatDateWithYear(deadline)}</span>
      <span className={cn('text-[11px]', (overdue || left === 0) && 'font-semibold')}>
        {label}
      </span>
    </span>
  )
}

/**
 * The proposals actually being worked, as opposed to every tender the scraper
 * found. An RFP arrives here only by being explicitly added from the RFP
 * tracker, so this page stays a deliberate work list rather than a feed.
 */
export function PipelineView({
  onOpenProfile,
}: {
  onOpenProfile: (id: string) => void
}) {
  const { rfps, activities, setRfpStatus, setRfpPipeline } = usePipeline()
  const { can, session } = useAuth()

  // Oversight reads every member's pipeline, so a row needs to say whose it is.
  // A standard user only ever sees their own rows, and a column repeating their
  // own name on every line is noise — so the column is theirs alone to lose.
  const showOwner = can.seeEveryone
  const memberNames = useMemberNames()

  function ownerLabel(rfp: Rfp): string {
    if (rfp.ownerId === session?.user.id) return 'You'
    const known = memberNames.get(rfp.ownerId)
    // The lookup falls back to the email when a member has set no display name,
    // and only an email should go through toDisplayName — it lower-cases, which
    // would turn a real name into "wahu njeri".
    if (known) return known.includes('@') ? toDisplayName(known) : known
    // The name lookup fails soft, and a uuid on screen tells nobody anything.
    return 'Another member'
  }

  const inPipeline = useMemo(
    () =>
      rfps
        .filter((rfp) => rfp.inPipeline)
        // Newest addition first, within each status section below.
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [rfps],
  )

  /** Most recent logged activity per RFP, so a stalled bid is visible. */
  const lastTouch = useMemo(() => {
    const map = new Map<string, string>()
    for (const activity of activities) {
      if (!activity.rfpId) continue
      const existing = map.get(activity.rfpId)
      if (!existing || activity.occurredOn > existing) {
        map.set(activity.rfpId, activity.occurredOn)
      }
    }
    return map
  }, [activities])

  const open = inPipeline.filter(
    (rfp) => rfp.status === 'Preparing' || rfp.status === 'Submitted',
  )
  const won = inPipeline.filter((rfp) => rfp.status === 'Won')
  const lost = inPipeline.filter((rfp) => rfp.status === 'Lost')

  const closingSoon = open.filter((rfp) => {
    const left = daysUntil(rfp.deadline)
    return left !== null && left <= 7
  }).length

  /** Only open bids — counting won/lost value would overstate what is live. */
  const valueAtStake = open.reduce((sum, rfp) => sum + (rfp.value ?? 0), 0)

  const decided = won.length + lost.length
  const winRate = decided > 0 ? Math.round((won.length / decided) * 100) : null

  const quarter = periodRange('quarter', today(), 0)
  const submittedThisQuarter = inPipeline.filter(
    (rfp) =>
      (rfp.status === 'Submitted' || rfp.status === 'Won' || rfp.status === 'Lost') &&
      rfp.statusUpdatedOn >= quarter.start &&
      rfp.statusUpdatedOn <= quarter.end,
  ).length

  const grouped = SECTIONS.map((section) => ({
    ...section,
    rows: inPipeline.filter((rfp) => rfp.status === section.status),
  })).filter((section) => section.rows.length > 0)

  return (
    <>
      <ViewHeader
        eyebrow="Bids in flight"
        title="Proposal pipeline"
        description={
          showOwner
            ? 'Every tender the firm has taken on, whoever took it. One row per opportunity — the “Taken by” column says whose it is.'
            : 'Only the tenders you have taken on. Add one from the RFP tracker when it is worth bidding; everything else stays out of the way.'
        }
        meta={
          <span className="text-[11px] text-muted-foreground">
            {open.length} open · {inPipeline.length} total
          </span>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Open proposals"
          value={open.length}
          hint="Preparing or submitted"
        />
        <KpiCard
          label="Closing within 7 days"
          value={closingSoon}
          hint={closingSoon > 0 ? 'Needs attention this week' : 'Nothing imminent'}
          tone={closingSoon > 0 ? 'warn' : 'good'}
        />
        <KpiCard
          label="Value at stake"
          value={valueAtStake > 0 ? `KES ${formatKes(valueAtStake)}` : '—'}
          hint="Estimated value of open bids"
        />
        <KpiCard
          label="Win rate"
          value={winRate === null ? '—' : `${winRate}%`}
          hint={
            winRate === null
              ? 'No decided bids yet'
              : `${won.length} won of ${decided} decided`
          }
          tone={winRate === null ? 'neutral' : winRate >= 50 ? 'good' : 'warn'}
        />
      </div>

      {submittedThisQuarter > 0 && (
        <p className="mb-5 text-[11px] text-faint">
          {submittedThisQuarter} proposal{submittedThisQuarter === 1 ? '' : 's'}{' '}
          submitted this quarter.
        </p>
      )}

      {inPipeline.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<TargetIcon className="size-5" />}
            hint="Open the RFP tracker, find one worth bidding, and use “Add to pipeline”. Only what you add appears here."
          >
            Nothing in the pipeline yet
          </EmptyState>
        </Panel>
      ) : (
        grouped.map((section) => (
          <Panel
            key={section.status}
            title={section.status}
            description={section.blurb}
            action={
              <span className="text-[11px] text-faint">
                {section.rows.length}
              </span>
            }
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Organization</TableHead>
                  {showOwner && <TableHead>Taken by</TableHead>}
                  <TableHead>Deadline</TableHead>
                  <TableHead className="text-right">Value (KES)</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {section.rows.map((rfp) => (
                  <PipelineRow
                    key={rfp.id}
                    rfp={rfp}
                    owner={showOwner ? ownerLabel(rfp) : null}
                    mine={rfp.ownerId === session?.user.id}
                    lastTouch={lastTouch.get(rfp.id)}
                    onStatus={setRfpStatus}
                    onOpen={onOpenProfile}
                    onRemove={(id) => void setRfpPipeline(id, false)}
                  />
                ))}
              </TableBody>
            </Table>
          </Panel>
        ))
      )}
    </>
  )
}

function PipelineRow({
  rfp,
  owner,
  mine,
  lastTouch,
  onStatus,
  onOpen,
  onRemove,
}: {
  rfp: Rfp
  /** Who took this on, or `null` when the viewer only ever sees their own. */
  owner: string | null
  mine: boolean
  lastTouch?: string
  onStatus: (id: string, status: RfpStatus) => Promise<void>
  onOpen: (id: string) => void
  onRemove: (id: string) => void
}) {
  const stale = !lastTouch && (rfp.status === 'Preparing' || rfp.status === 'Submitted')

  return (
    <TableRow onClick={() => onOpen(rfp.id)} className="cursor-pointer">
      <TableCell className="max-w-[360px] font-medium">
        {rfp.link ? (
          <a
            href={rfp.link}
            target="_blank"
            rel="noopener noreferrer"
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
      <TableCell className="max-w-[180px] text-muted-foreground">
        {rfp.org || '—'}
      </TableCell>
      {owner !== null && (
        <TableCell className="whitespace-nowrap">
          {/* The viewer's own rows stay quiet; someone else's is the thing an
              admin is actually scanning the column for. */}
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[11px]',
              mine
                ? 'text-muted-foreground'
                : 'bg-gold-soft font-medium text-clay',
            )}
          >
            {owner}
          </span>
        </TableCell>
      )}
      <TableCell className="whitespace-nowrap">
        <DeadlineCell deadline={rfp.deadline} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {formatKes(rfp.value)}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {lastTouch ? (
          <span className="text-muted-foreground">{formatDateWithYear(lastTouch)}</span>
        ) : (
          // A live bid with no logged work is the thing worth catching here.
          <span className={cn('text-[11px]', stale ? 'text-warning' : 'text-faint')}>
            {stale ? 'nothing logged' : '—'}
          </span>
        )}
      </TableCell>
      <TableCell>
        <RfpStatusSelect
          value={rfp.status}
          onChange={(next) => onStatus(rfp.id, next)}
        />
      </TableCell>
      <TableCell>
        {/* Only your own. Row-level security scopes the update to rows you own,
            so this button on someone else's proposal could only ever fail —
            leaving it there offers an action the server will refuse. */}
        {mine && (
          <button
            type="button"
            onClick={() => onRemove(rfp.id)}
            title="Remove from the pipeline (the RFP itself is kept)"
            aria-label={`Remove ${rfp.title} from the pipeline`}
            className="cursor-pointer px-1 text-faint transition-colors hover:text-danger"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </TableCell>
    </TableRow>
  )
}
