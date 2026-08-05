import { useMemo, useState } from 'react'
import { MessageSquareIcon, SearchXIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { EmptyState, Panel, ViewHeader } from '@/components/panel'
import { FilterSelect } from '@/components/field'
import { ActivityComposer, ActivityRow } from '@/components/activity-log'
import { useAuth } from '@/hooks/use-auth'
import { useMemberNames } from '@/lib/members'
import { toDisplayName } from '@/lib/usernames'
import { KpiCard } from '@/components/kpi-card'
import { usePipeline } from '@/hooks/use-pipeline'
import { formatDateWithYear, today, weekEnd, weekStart } from '@/lib/dates'
import { communicationsInRange, untouchedLeads } from '@/lib/metrics'
import { ACTIVITY_TYPES, type ActivityType } from '@/lib/types'

/**
 * The communication log — the daily evidence the KPI scorecard asks for, and
 * the record behind "professional responses, reminders and objection handling".
 */
export function ActivityView() {
  const { activities, leads, rfps, logActivity, removeActivity } = usePipeline()
  const { can, profile } = useAuth()
  const memberNames = useMemberNames()
  const [search, setSearch] = useState('')
  const [type, setType] = useState<ActivityType | 'all'>('all')

  const labelFor = useMemo(() => {
    const map = new Map<string, string>()
    for (const lead of leads) map.set(`lead:${lead.id}`, lead.org)
    for (const rfp of rfps) map.set(`rfp:${rfp.id}`, rfp.title)
    return map
  }, [leads, rfps])

  function contextLabel(leadId: string | null, rfpId: string | null) {
    if (leadId) return labelFor.get(`lead:${leadId}`)
    if (rfpId) return labelFor.get(`rfp:${rfpId}`)
    return undefined
  }

  /**
   * Whose entry this is, when that is worth saying.
   *
   * Only for readers who can see the whole team's log, and never for their own
   * rows: an admin reading a mixed feed needs to know who did what, but
   * labelling their own entries with their own name is noise.
   */
  function attribution(userId: string): string | undefined {
    if (!can.seeEveryone || userId === profile?.id) return undefined
    const name = memberNames.get(userId)
    return name ? toDisplayName(name) : 'Another member'
  }

  const start = weekStart(today())
  const thisWeek = communicationsInRange(activities, start, weekEnd(start))
  const todayCount = communicationsInRange(activities, today(), today())
  const untouched = untouchedLeads(leads, activities)

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return activities.filter((activity) => {
      if (type !== 'all' && activity.type !== type) return false
      if (!term) return true
      const context = contextLabel(activity.leadId, activity.rfpId) ?? ''
      return (
        activity.summary.toLowerCase().includes(term) ||
        activity.outcome.toLowerCase().includes(term) ||
        context.toLowerCase().includes(term)
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities, search, type, labelFor])

  /** Grouped by day, so the log reads as a diary rather than a flat list. */
  const byDay = useMemo(() => {
    const groups = new Map<string, typeof filtered>()
    for (const activity of filtered) {
      const list = groups.get(activity.occurredOn) ?? []
      list.push(activity)
      groups.set(activity.occurredOn, list)
    }
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered])

  async function handleDelete(id: string) {
    try {
      await removeActivity(id)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <>
      <ViewHeader
        eyebrow="Communication log"
        title="Activity"
        description="What you actually did, as opposed to what you planned. This is the record behind the daily client-communication KPI."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <KpiCard label="Logged today" value={todayCount} hint="Calls, emails, messages, meetings" />
        <KpiCard label="Logged this week" value={thisWeek} hint="Counts toward the weekly report" />
        <KpiCard
          label="Leads never contacted"
          value={untouched.length}
          hint={untouched.length ? 'Open leads with no logged activity' : 'Every open lead has been worked'}
          tone={untouched.length > 0 ? 'warn' : 'good'}
        />
      </div>

      <Panel
        title="Log an interaction"
        description="Entries can hang off a lead or an RFP from their dialogs; anything logged here stands alone — useful for market intelligence."
      >
        <ActivityComposer onLog={logActivity} />
      </Panel>

      <div className="mb-3.5 flex flex-wrap gap-2">
        <Input
          placeholder="Search the log…"
          aria-label="Search activity"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-[240px]"
        />
        <FilterSelect
          value={type}
          options={ACTIVITY_TYPES}
          onChange={setType}
          allLabel="All types"
          ariaLabel="Filter by activity type"
        />
      </div>

      {byDay.length === 0 ? (
        <Panel>
          {activities.length === 0 ? (
            <EmptyState
              icon={<MessageSquareIcon className="size-5" />}
              hint="Log a call, email or meeting above and it appears here, grouped by day."
            >
              Nothing logged yet
            </EmptyState>
          ) : (
            <EmptyState
              icon={<SearchXIcon className="size-5" />}
              hint="Try a broader search, or set the type filter back to all."
            >
              No entries match
            </EmptyState>
          )}
        </Panel>
      ) : (
        byDay.map(([day, entries]) => (
          <Panel
            key={day}
            title={formatDateWithYear(day)}
            action={
              <span className="text-[11px] text-faint">
                {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
              </span>
            }
          >
            {entries.map((activity) => (
              <ActivityRow
                key={activity.id}
                activity={activity}
                context={contextLabel(activity.leadId, activity.rfpId)}
                by={attribution(activity.userId)}
                onDelete={(id) => void handleDelete(id)}
              />
            ))}
          </Panel>
        ))
      )}
    </>
  )
}
