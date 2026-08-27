import { useMemo, useState } from 'react'
import {
  ChevronRightIcon,
  ExternalLinkIcon,
  GaugeIcon,
  ListIcon,
  PlusIcon,
  XIcon,
} from 'lucide-react'
import {
  EmptyState,
  Panel,
  PanelHeader,
  StatCard,
  ViewHeader,
} from '@/shared/components/panel'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { type MeterTone } from '@/features/dashboard/metric-marks'
import { Bars, RailHeading, Ring } from './panels'
import { SubjectIcon } from '@/features/dashboard/subject-icon'
import { PipelineBar } from '@/features/dashboard/pipeline-bar'
import { RfpStatusSelect } from '@/shared/components/status-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table'
import { usePipeline } from '@/shared/hooks/use-pipeline'
import { TaskRow } from '@/features/tasks/task-row'
import { safeExternalUrl } from '@/features/rfps/source-site'
import { useAuth } from '@/shared/hooks/use-auth'
import {
  addDays,
  daysUntil,
  formatDateWithYear,
  formatKes,
  formatToday,
  today,
  weekEnd,
  weekStart,
} from '@/domain/dates'
import {
  activeRfpCount,
  communicationsInRange,
  dueOrOverdueTasks,
  followUpDiscipline,
  qualifiedInWeek,
  upcomingRfpDeadlines,
} from '@/domain/metrics'
import { cn } from '@/shared/utils'
import { RFP_STATUSES, type Lead, type LeadStatus, type RfpStatus } from '@/domain/types'
import type { ViewId } from '@/app/nav'
import { NotificationMenu } from './notification-menu'

/** How many periods a sparkline shows. Twelve reads as a trend, not a history. */
const TREND_POINTS = 12

/**
 * Discipline is never "neutral" — a booked next action is either happening or
 * it is not — so this is narrower than KpiTone and feeds the meter directly.
 */
function disciplineTone(pct: number): MeterTone {
  if (pct >= 80) return 'good'
  if (pct >= 50) return 'warn'
  return 'bad'
}

/**
 * "View all" affordance shared by the panels, so both behave the same way.
 *
 * `onDark` is for the band at the head of a list card, where the primary blue
 * on slate is close enough to fail contrast — white at 80% reads cleanly and
 * still recedes behind the heading beside it.
 */
function PanelLink({
  label,
  onClick,
  onDark = false,
}: {
  label: string
  onClick: () => void
  onDark?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        onDark
          ? 'text-white/80 hover:text-white'
          : 'text-primary hover:text-clay',
      )}
    >
      {label}
      <ChevronRightIcon className="size-3" aria-hidden />
    </button>
  )
}

/**
 * Deadline with how long is left, or how long it has been missed.
 *
 * "24 Jul (-2d)" was ambiguous — a negative day count reads as a typo rather
 * than a warning — so overdue is spelled out.
 */
function DeadlineCell({ deadline }: { deadline: string }) {
  const left = daysUntil(deadline)

  if (left === null) return <span className="text-muted-foreground">—</span>

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

export function DashboardView({
  onNavigate,
  onOpenProfile,
  onOpenLeadStage,
}: {
  onNavigate: (view: ViewId) => void
  /** Opens an RFP's record, the same view the tracker opens. */
  onOpenProfile: (id: string) => void
  /** Opens the leads register filtered to one pipeline stage. */
  onOpenLeadStage: (stage: LeadStatus) => void
}) {
  const { leads, rfps, tasks, activities, toggleTask, setRfpStatus } = usePipeline()
  const { can } = useAuth()

  const leadsById = useMemo(() => {
    const map = new Map<string, Lead>()
    for (const lead of leads) map.set(lead.id, lead)
    return map
  }, [leads])

  const start = weekStart(today())
  const qualified = qualifiedInWeek(leads, start, weekEnd(start))
  const discipline = followUpDiscipline(leads)
  const activeRfps = activeRfpCount(rfps)
  const dueTasks = dueOrOverdueTasks(tasks)
  const loggedToday = communicationsInRange(activities, today(), today())
  const soonRfps = upcomingRfpDeadlines(rfps, 7)
  const overdueCount = soonRfps.filter((rfp) => {
    const left = daysUntil(rfp.deadline)
    return left !== null && left < 0
  }).length

  // The only figure with an honest daily series behind it. Active RFPs, tasks
  // due and the rest are current-state counts — drawing a trend for those would
  // be a decoration that reads as data.
  const loggedTrend = useMemo(() => {
    const from = today()
    return Array.from({ length: TREND_POINTS }, (_, index) => {
      const day = addDays(from, index - (TREND_POINTS - 1))
      return communicationsInRange(activities, day, day)
    })
  }, [activities])

  /** Money committed to bids currently being worked. */
  const pipelineValue = useMemo(
    () =>
      rfps
        .filter((rfp) => rfp.inPipeline)
        .reduce((sum, rfp) => sum + (rfp.value ?? 0), 0),
    [rfps],
  )

  const beingBid = useMemo(() => rfps.filter((rfp) => rfp.inPipeline).length, [rfps])

  /**
   * The rail's activity feed.
   *
   * Capped well above what fits so the card has something to scroll: it takes
   * whatever height the left column leaves, which varies with how many tenders
   * and tasks are due, and a list cut to four would leave that space blank on a
   * tall page. The cap exists only to stop a long history rendering in full.
   */
  const recentActivity = useMemo(
    () =>
      [...activities]
        .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
        .slice(0, 25),
    [activities],
  )

  /**
   * The deadline list's filters.
   *
   * Applied as they are typed rather than behind an Apply button. The reference
   * module has one because its list comes from the server; this list is already
   * in memory, and a button that makes an instant thing wait for a click is a
   * button that only ever costs a click.
   */
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | RfpStatus>('all')
  const [window, setWindow] = useState(7)

  const windowRfps = useMemo(
    () => upcomingRfpDeadlines(rfps, window),
    [rfps, window],
  )

  const filteredRfps = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return windowRfps.filter((rfp) => {
      if (status !== 'all' && rfp.status !== status) return false
      if (!needle) return true
      return (
        rfp.title.toLowerCase().includes(needle) ||
        rfp.org.toLowerCase().includes(needle)
      )
    })
  }, [windowRfps, search, status])

  const filtered = search.trim() !== '' || status !== 'all' || window !== 7

  return (
    <>
      <ViewHeader
        icon={<GaugeIcon />}
        title="Performance Dashboard"
        description="What is moving, what needs attention, and where the team can help today."
        meta={
          <>
            <div className="rounded-md border border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground">
              {formatToday()}
            </div>
            <NotificationMenu rfps={rfps} onOpen={onOpenProfile} />
          </>
        }
        action={
          <Button onClick={() => onNavigate('rfps')} title="Go to the tracker, where a tender is added">
            <PlusIcon />
            New RFP
          </Button>
        }
      />

      {/*
        The stat row.

        Six figures, each its own colour, each opening the records behind it.
        A statistic nobody can click is a poster, and every one of these stands
        for a list somebody will want the moment the number surprises them.
      */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard
          value={activeRfps}
          label="Active RFPs"
          tone="primary"
          onClick={() => onNavigate('rfps')}
          title={
            can.seeEveryone
              ? 'Distinct across the team · Watching, Preparing or Submitted'
              : 'In your tracker · Watching, Preparing or Submitted'
          }
        />
        <StatCard
          value={beingBid}
          label="Being bid"
          tone="info"
          onClick={() => onNavigate('pipeline')}
          title="Taken on as live proposals"
        />
        <StatCard
          value={qualified}
          label="Qualified this week"
          tone="success"
          onClick={() => onNavigate('leads')}
          title="Leads reaching Qualified or beyond"
        />
        <StatCard
          value={dueTasks.length}
          label="Tasks due"
          tone={dueTasks.length > 0 ? 'warning' : 'default'}
          onClick={() => onNavigate('tasks')}
          title="Due today or already overdue"
        />
        <StatCard
          value={overdueCount}
          label="Overdue tenders"
          tone={overdueCount > 0 ? 'danger' : 'default'}
          onClick={() => onNavigate('rfps')}
          title="Deadline already passed"
        />
        <StatCard
          value={loggedToday}
          label="Logged today"
          tone="primary"
          onClick={() => onNavigate('activity')}
          title="Calls, emails and meetings recorded today"
        />
      </div>

      {/*
        The filter bar, over the deadline list below it.

        It filters that one list and says so, rather than sitting at the top of
        the page implying it governs everything under it.
      */}
      <div className="mb-5 rounded-lg border border-border bg-card px-4 py-3.5 shadow-brand-sm">
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] text-muted-foreground">Search deadlines</span>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Title or organization…"
              className="w-full"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] text-muted-foreground">Status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as 'all' | RfpStatus)}
              className="h-9 w-full cursor-pointer rounded-md border border-input bg-card px-3 text-[13px] text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <option value="all">All statuses</option>
              {RFP_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] text-muted-foreground">Closing within</span>
            <select
              value={window}
              onChange={(event) => setWindow(Number(event.target.value))}
              className="h-9 w-full cursor-pointer rounded-md border border-input bg-card px-3 text-[13px] text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </label>
          <div className="flex items-end">
            <Button
              variant="outline"
              onClick={() => {
                setSearch('')
                setStatus('all')
                setWindow(7)
              }}
              disabled={!filtered}
              className="w-full md:w-auto"
            >
              <XIcon />
              Clear
            </Button>
          </div>
        </div>
      </div>

      <Panel bare>
        <PanelHeader
          icon={<ListIcon />}
          title="RFP deadlines"
          count={filteredRfps.length}
          action={
            <div className="flex shrink-0 items-center gap-3">
              {overdueCount > 0 && (
                <span className="rounded-full bg-danger px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  {overdueCount} overdue
                </span>
              )}
              <PanelLink label="All RFPs" onClick={() => onNavigate('rfps')} onDark />
            </div>
          }
        />
        {filteredRfps.length === 0 ? (
          <EmptyState
            icon={<SubjectIcon name="deadlines" className="size-6" />}
            hint={
              filtered
                ? 'No tender matches these filters. Clear them to see everything closing soon.'
                : 'Tenders closing within the window appear here, soonest first — along with any whose deadline has already passed.'
            }
          >
            {filtered ? 'Nothing matches' : 'No deadlines in the next 7 days'}
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10 text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRfps.map((rfp) => (
                <TableRow key={rfp.id}>
                  <TableCell className="max-w-[380px] font-medium">
                    {rfp.link ? (
                      <a
                        href={safeExternalUrl(rfp.link)}
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
                  <TableCell className="text-muted-foreground">
                    {rfp.org || '—'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <DeadlineCell deadline={rfp.deadline} />
                  </TableCell>
                  <TableCell>
                    <RfpStatusSelect
                      value={rfp.status}
                      onChange={(next) => setRfpStatus(rfp.id, next)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <button
                      type="button"
                      onClick={() => onOpenProfile(rfp.id)}
                      aria-label={`Open ${rfp.title}`}
                      title="Open this RFP's record"
                      className="cursor-pointer rounded-md p-1 text-faint transition-colors hover:bg-surface-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <ChevronRightIcon className="size-4" aria-hidden />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      {/* Two columns from xl: the working page, and a summary rail that answers
          "how are we doing" without being read in sequence. Below xl the rail
          falls underneath, which is the right order on a narrow screen — you
          act first and review second. */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_310px]">
        <div className="min-w-0">

          <PipelineBar leads={leads} onSelectStage={onOpenLeadStage} />

          <div className="mb-5 grid gap-3.5 lg:grid-cols-2">
            <Panel className="mb-0">
              <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-[14.5px] leading-tight text-foreground">
                    Follow-up discipline
                  </h3>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                    Share of active leads with a next action booked. The ones
                    without are where a pipeline quietly goes cold.
                  </p>
                  <button
                    type="button"
                    onClick={() => onNavigate('leads')}
                    className="mt-2.5 inline-flex cursor-pointer items-center gap-0.5 text-[11px] font-medium text-primary hover:text-clay"
                  >
                    Work the list
                    <ChevronRightIcon className="size-3" aria-hidden />
                  </button>
                </div>
                <Ring
                  value={discipline}
                  tone={disciplineTone(discipline)}
                  label={`${discipline}% of active leads have a next action booked`}
                />
              </div>
            </Panel>

            <Panel className="mb-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-[14.5px] leading-tight text-foreground">
                    Communication
                  </h3>
                  <div className="mt-1 font-display text-[22px] leading-none text-foreground">
                    {loggedToday}
                  </div>
                  <p className="mt-1 text-[11px] text-faint">
                    logged today · last {TREND_POINTS} days
                  </p>
                </div>
                <SubjectIcon name="logged" className="size-6" />
              </div>
              <Bars
                values={loggedTrend}
                label={`Communications logged on each of the last ${TREND_POINTS} days`}
                className="mt-3"
              />
            </Panel>
          </div>
        </div>

        {/* ------------------------------------------------------- summary */}
        {/* A flex column so the activity card can take whatever height the
            left column leaves. As a grid item the rail already stretches to the
            row's height; without this the cards sat at their natural size and
            left a block of empty page below them. */}
        <aside className="flex min-w-0 flex-col">
          <div className="gold-edge mb-4 shrink-0 rounded-2xl border border-border bg-card px-4 py-4 shadow-brand-sm">
            <div className="eyebrow text-muted-foreground">Value being bid</div>
            <div className="mt-1.5 font-display text-[25px] leading-none text-foreground">
              {pipelineValue > 0 ? formatKes(pipelineValue) : '—'}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-faint">
              {pipelineValue > 0
                ? `Across ${beingBid} ${beingBid === 1 ? 'tender' : 'tenders'} currently in a pipeline. Only tenders with a stated value are counted.`
                : 'No value recorded yet on the tenders being bid — add one on an RFP and it totals here.'}
            </p>
          </div>

          {/* Takes the remaining height. `min-h-0` is what lets it actually
              shrink to the space available — without it a flex child refuses to
              go below its content height and the list overflows the card
              instead of scrolling inside it. */}
          <div className="mb-4 flex min-h-0 flex-1 flex-col rounded-2xl border border-border bg-card px-4 py-4 shadow-brand-sm">
            <RailHeading
              action={<PanelLink label="See all" onClick={() => onNavigate('activity')} />}
            >
              Activity
            </RailHeading>
            {recentActivity.length === 0 ? (
              <p className="text-[11.5px] text-faint">
                Nothing logged yet. Calls, emails and meetings appear here as
                they are recorded.
              </p>
            ) : (
              <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1">
                {recentActivity.map((activity) => (
                  <div key={activity.id} className="flex items-start gap-2.5">
                    <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11.5px] leading-snug text-foreground">
                        {activity.summary}
                      </p>
                      <p className="mt-0.5 text-[10.5px] text-faint">
                        {activity.type} · {formatDateWithYear(activity.occurredOn)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* No Icons8 attribution line: the marks on this page are covered by
              a licence that does not require one. It used to sit here, and was
              emptied rather than deleted — an anchor with no text is still a
              link, and a link with no accessible name is announced to a screen
              reader as an unlabelled destination. */}
        </aside>
      </div>

      {/* Full width, below the two-column region. These two carry long
          tender titles and five columns; in a 1fr column beside the rail
          the titles wrapped to three lines while half the page sat empty.
          A table this wide is not a sidebar companion. */}
      <Panel bare>
        <PanelHeader
          icon={<ListIcon />}
          title="Due today & overdue"
          count={dueTasks.length}
          action={<PanelLink label="All tasks" onClick={() => onNavigate('tasks')} onDark />}
        />
        {dueTasks.length === 0 ? (
          <EmptyState
            icon={<SubjectIcon name="tasks" className="size-6" />}
            hint="Nothing is waiting on you. New follow-ups appear here on their due date."
          >
            You&rsquo;re all caught up
          </EmptyState>
        ) : (
          <div className="px-5 py-1">
            {dueTasks.map((task) => (
              <TaskRow
              key={task.id}
              task={task}
              lead={task.linkedLead ? leadsById.get(task.linkedLead) : undefined}
              overdue
                onToggle={(id, done) => void toggleTask(id, done)}
              />
            ))}
          </div>
        )}
      </Panel>

    </>
  )
}
