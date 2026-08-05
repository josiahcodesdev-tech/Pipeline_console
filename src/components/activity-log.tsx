import { useState } from 'react'
import {
  CalendarPlusIcon,
  FileSignatureIcon,
  HandshakeIcon,
  MessageCircleIcon,
  MailIcon,
  MonitorPlayIcon,
  PhoneIcon,
  StickyNoteIcon,
  UserPlusIcon,
  XIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatDateWithYear, today } from '@/lib/dates'
import { cn } from '@/lib/utils'
import {
  ACTIVITY_TYPES,
  CONVERSION_ACTIVITY_TYPES,
  type Activity,
  type ActivityType,
} from '@/lib/types'
import type { ActivityDraft } from '@/lib/db'

const TYPE_ICON: Record<ActivityType, typeof PhoneIcon> = {
  Call: PhoneIcon,
  Email: MailIcon,
  LinkedIn: MessageCircleIcon,
  'Meeting request': CalendarPlusIcon,
  'Meeting held': HandshakeIcon,
  'Proposal sent': FileSignatureIcon,
  Demo: MonitorPlayIcon,
  Registration: UserPlusIcon,
  Note: StickyNoteIcon,
}

/** Conversion events are tinted so they stand out in a run of ordinary calls. */
function typeTone(type: ActivityType): string {
  if ((CONVERSION_ACTIVITY_TYPES as readonly string[]).includes(type)) {
    return 'bg-success-soft text-success'
  }
  if (type === 'Note') return 'bg-surface-2 text-neutral'
  return 'bg-brand-soft text-primary'
}

export function ActivityRow({
  activity,
  context,
  by,
  onDelete,
}: {
  activity: Activity
  /** Organisation or RFP title, when the row is shown outside its parent. */
  context?: string
  /**
   * Who logged it. Passed only when the reader can see other members' entries,
   * which is admins and the super user — for everyone else the log is their
   * own and naming themselves on every line would be noise.
   */
  by?: string
  onDelete?: (id: string) => void
}) {
  const Icon = TYPE_ICON[activity.type]

  return (
    <div className="flex items-start gap-3 border-b border-border-soft py-2.5 last:border-b-0">
      <span
        className={cn(
          'mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg',
          typeTone(activity.type),
        )}
        title={activity.type}
      >
        <Icon className="size-3.5" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] leading-snug text-foreground">
          {activity.summary}
        </p>
        {by && (
          // Above the detail line rather than buried in it: when an admin is
          // reading the whole team's log, who did it is the first thing they
          // are looking for, not a footnote after the date.
          <p className="mt-0.5 text-[11px] font-medium text-clay">{by}</p>
        )}
        {activity.outcome && (
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
            {activity.outcome}
          </p>
        )}
        <p className="mt-1 text-[11px] text-faint">
          {activity.type}
          {context && ` · ${context}`} · {formatDateWithYear(activity.occurredOn)}
        </p>
      </div>

      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(activity.id)}
          aria-label="Delete this entry"
          className="cursor-pointer px-1 text-faint transition-colors hover:text-danger"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/**
 * Inline form for logging an interaction.
 *
 * Kept to one row of controls plus a summary line: the point of a
 * communication log is that recording an entry is faster than not bothering.
 * Anything that takes a dialog and six fields does not get filled in.
 */
export function ActivityComposer({
  leadId = null,
  rfpId = null,
  onLog,
}: {
  leadId?: string | null
  rfpId?: string | null
  onLog: (draft: ActivityDraft) => Promise<void>
}) {
  const [type, setType] = useState<ActivityType>('Call')
  const [occurredOn, setOccurredOn] = useState(today())
  const [summary, setSummary] = useState('')
  const [outcome, setOutcome] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!summary.trim()) {
      toast.error('Say what happened first')
      return
    }
    setBusy(true)
    try {
      await onLog({
        leadId,
        rfpId,
        type,
        occurredOn,
        summary: summary.trim(),
        outcome: outcome.trim(),
      })
      setSummary('')
      setOutcome('')
      setType('Call')
      setOccurredOn(today())
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface-2/50 p-3">
      <div className="mb-2 flex flex-wrap gap-2">
        <Select<string>
          value={type}
          onValueChange={(next) => setType(next as ActivityType)}
        >
          <SelectTrigger aria-label="Activity type" className="min-w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTIVITY_TYPES.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="date"
          value={occurredOn}
          onChange={(event) => setOccurredOn(event.target.value)}
          aria-label="When it happened"
          className="w-[150px]"
        />
      </div>

      <Input
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void submit()
          }
        }}
        placeholder="What happened? e.g. Called the procurement officer about the M&E training"
        aria-label="What happened"
        className="mb-2 w-full"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
          placeholder="Outcome or next step (optional)"
          aria-label="Outcome"
          className="min-w-[220px] flex-1"
        />
        <Button onClick={() => void submit()} disabled={busy} size="sm">
          {busy ? 'Logging…' : 'Log'}
        </Button>
      </div>
    </div>
  )
}
