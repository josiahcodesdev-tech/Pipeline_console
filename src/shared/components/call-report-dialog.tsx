import { useEffect, useMemo, useState } from 'react'
import { DownloadIcon } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { Field, FieldRow } from '@/shared/components/field'
import { usePipeline } from '@/shared/hooks/use-pipeline'
import {
  downloadCallReportDocx,
  missingCallReportFields,
} from '@/documents/call-report'
import { formatDateWithYear, today } from '@/domain/dates'
import type { CallReportFields } from '@/data/activities'
import type { Activity, Lead } from '@/domain/types'

/**
 * The call report for one client visit.
 *
 * A dialog rather than a page because it is written once, days after the visit,
 * and then printed — it is a form to complete, not a record to live in. It
 * opens from both places a visit is visible: the client's page and the activity
 * register.
 *
 * The header fields it does not ask for — client, location, phone, contact,
 * date of visit — are read from the lead and the activity, which already hold
 * them. Asking again is how the report and the record start to disagree.
 */
export function CallReportDialog({
  visit,
  client,
  open,
  onOpenChange,
}: {
  visit: Activity
  client: Lead
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { saveCallReport } = usePipeline()
  const [form, setForm] = useState<CallReportFields>(() => toFields(visit))
  const [saving, setSaving] = useState(false)

  // Re-seed each time it opens, so a cancelled edit does not persist into the
  // next viewing, and so a save made elsewhere is picked up.
  useEffect(() => {
    if (open) setForm(toFields(visit))
  }, [open, visit])

  const merged = useMemo(() => ({ ...visit, ...form }), [visit, form])
  const missing = useMemo(
    () => missingCallReportFields(merged, client),
    [merged, client],
  )
  const dirty = useMemo(
    () => KEYS.some((key) => form[key] !== visit[key]),
    [form, visit],
  )

  function set<K extends keyof CallReportFields>(key: K, value: CallReportFields[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function save(): Promise<boolean> {
    if (saving) return false
    setSaving(true)
    try {
      // A report with no date has not been written, and the export treats the
      // date as the marker that one exists — so saving supplies today's rather
      // than leaving a half-filled report invisible on the client's page.
      await saveCallReport(visit.id, { ...form, reportDate: form.reportDate || today() })
      toast.success('Call report saved')
      return true
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      setSaving(false)
    }
  }

  /** Saves first, so the file can never differ from what the console shows. */
  async function download() {
    if (missing.length > 0) {
      const ok = window.confirm(
        `${missing.length} field${missing.length === 1 ? ' is' : 's are'} still blank and will print empty:\n\n${missing
          .map((f) => `· ${f}`)
          .join('\n')}\n\nDownload anyway?`,
      )
      if (!ok) return
    }
    if (dirty && !(await save())) return
    try {
      await downloadCallReportDocx(
        { ...merged, reportDate: merged.reportDate || today() },
        client,
      )
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>Call report — {client.org}</DialogTitle>
          <DialogDescription>
            Visit of {visit.occurredOn ? formatDateWithYear(visit.occurredOn) : 'no date'}.
            The client name, location, phone and contact print from the lead, and the
            date of visit from this activity — so they are not asked for again here.
          </DialogDescription>
        </DialogHeader>

        <FieldRow>
          <Field label="Visiting officers" htmlFor="cr-officers">
            <Input
              id="cr-officers"
              value={form.visitingOfficers}
              onChange={(e) => set('visitingOfficers', e.target.value)}
              placeholder="Who went, from Vantage Africa"
            />
          </Field>
          <Field label="Date of report" htmlFor="cr-report-date">
            <Input
              id="cr-report-date"
              type="date"
              value={form.reportDate}
              onChange={(e) => set('reportDate', e.target.value)}
              placeholder={today()}
            />
          </Field>
        </FieldRow>

        <Field label="Company officials met" htmlFor="cr-officials">
          <Textarea
            id="cr-officials"
            rows={2}
            value={form.officialsMet}
            onChange={(e) => set('officialsMet', e.target.value)}
            placeholder="Name and title, one per line"
          />
        </Field>

        <Field label="Purpose of the meeting" htmlFor="cr-purpose">
          <Textarea
            id="cr-purpose"
            rows={2}
            value={form.meetingPurpose}
            onChange={(e) => set('meetingPurpose', e.target.value)}
            placeholder="Why the visit happened"
          />
        </Field>

        <div className="mb-2 mt-4 border-t border-border-soft pt-4">
          <h4 className="eyebrow text-clay">Business matters discussed</h4>
        </div>

        <Field
          label="1. Description of business / background / status as it is now"
          htmlFor="cr-background"
        >
          <Textarea
            id="cr-background"
            rows={4}
            value={form.businessBackground}
            onChange={(e) => set('businessBackground', e.target.value)}
          />
        </Field>

        <Field label="2. Key needs for training / consultancy" htmlFor="cr-needs">
          <Textarea
            id="cr-needs"
            rows={4}
            value={form.keyNeeds}
            onChange={(e) => set('keyNeeds', e.target.value)}
            placeholder={client.needs || undefined}
          />
          {!form.keyNeeds.trim() && client.needs.trim() && (
            <p className="mt-1.5 text-[11px] text-faint">
              Left blank, the client's recorded needs print here instead. Fill it in
              only where this visit changed them.
            </p>
          )}
        </Field>

        <Field label="3. Resolutions / way forward / action plans" htmlFor="cr-forward">
          <Textarea
            id="cr-forward"
            rows={4}
            value={form.wayForward}
            onChange={(e) => set('wayForward', e.target.value)}
          />
        </Field>

        <Field label="4. Any other comments" htmlFor="cr-other">
          <Textarea
            id="cr-other"
            rows={3}
            value={form.otherComments}
            onChange={(e) => set('otherComments', e.target.value)}
          />
        </Field>

        {missing.length > 0 && (
          <p className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-[11px] leading-relaxed text-warning">
            Still blank: {missing.join(', ')}.
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button type="button" onClick={() => void download()}>
            <DownloadIcon className="size-3.5" aria-hidden />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const KEYS = [
  'visitingOfficers',
  'officialsMet',
  'reportDate',
  'meetingPurpose',
  'businessBackground',
  'keyNeeds',
  'wayForward',
  'otherComments',
] as const satisfies readonly (keyof CallReportFields)[]

function toFields(activity: Activity): CallReportFields {
  return {
    visitingOfficers: activity.visitingOfficers,
    officialsMet: activity.officialsMet,
    reportDate: activity.reportDate,
    meetingPurpose: activity.meetingPurpose,
    businessBackground: activity.businessBackground,
    keyNeeds: activity.keyNeeds,
    wayForward: activity.wayForward,
    otherComments: activity.otherComments,
  }
}
