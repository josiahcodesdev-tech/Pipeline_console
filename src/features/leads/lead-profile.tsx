import { useMemo, useState } from 'react'
import { ArrowLeftIcon, FileTextIcon, PencilIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Panel, EmptyState } from '@/shared/components/panel'
import { Field, FieldRow } from '@/shared/components/field'
import { LeadStatusSelect } from '@/shared/components/status-select'
import { ActivityComposer, ActivityRow } from '@/shared/components/activity-log'
import { CallReportDialog } from '@/shared/components/call-report-dialog'
import { usePipeline } from '@/shared/hooks/use-pipeline'
import { formatDateWithYear } from '@/domain/dates'
import { hasCallReport, type Activity, type Lead, type LeadStatus } from '@/domain/types'
import { LeadDialog } from './lead-dialog'

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-1 text-faint">{label}</div>
      <div className="text-[13px] text-foreground">{children}</div>
    </div>
  )
}

/**
 * One client on a page: who they are, and every visit made to them.
 *
 * The call report lives on the visit rather than here, because a client is
 * visited more than once and a report per client would be silently overwritten
 * by the next one. What this page holds is the half of the form that does not
 * change between visits — where they are and what they do — so the report never
 * has to ask for it twice.
 */
export function LeadProfile({ lead, onBack }: { lead: Lead; onBack: () => void }) {
  const {
    activities,
    saveLead,
    removeLead,
    setLeadStatus,
    logActivity,
    removeActivity,
  } = usePipeline()

  const [editing, setEditing] = useState(false)
  const [reporting, setReporting] = useState<Activity | null>(null)
  const [location, setLocation] = useState(lead.location)
  const [nature, setNature] = useState(lead.natureOfBusiness)
  const [saving, setSaving] = useState(false)

  const dirty = location !== lead.location || nature !== lead.natureOfBusiness

  const logged = useMemo(
    () =>
      activities
        .filter((activity) => activity.leadId === lead.id)
        .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn)),
    [activities, lead.id],
  )
  const reports = logged.filter(hasCallReport)

  async function saveClientFacts() {
    if (saving || !dirty) return
    setSaving(true)
    try {
      // The whole lead goes back: `saveLead` takes a full draft, and sending a
      // partial one would blank the qualification fields.
      const { id, createdOn, statusUpdatedOn, ...rest } = {
        ...lead,
        location,
        natureOfBusiness: nature,
      }
      void id
      void createdOn
      void statusUpdatedOn
      await saveLead(rest, lead)
      toast.success('Client details saved')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="sticky top-0 z-20 -mx-6 mb-5 border-b border-border bg-background/85 px-6 pb-3 pt-4 backdrop-blur-md lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={onBack}
              className="eyebrow mb-1 flex cursor-pointer items-center gap-1.5 text-clay transition-colors hover:text-primary"
            >
              <ArrowLeftIcon className="size-3" />
              Back to leads
            </button>
            {/* Clamped for the same reason the tender header is, though an
                organisation name rarely needs it — the two pages sit one click
                apart and a tight header beside a loose one reads as a bug. */}
            <h2
              title={lead.org}
              className="line-clamp-2 font-display text-[18px] font-semibold leading-snug text-foreground"
            >
              {lead.org}
            </h2>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {[lead.segment, lead.country, lead.contactName].filter(Boolean).join(' · ')}
              {reports.length > 0 && (
                <span className="text-faint">
                  {' · '}
                  {reports.length} call report{reports.length === 1 ? '' : 's'}
                </span>
              )}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <LeadStatusSelect
              value={lead.status}
              onChange={(next: LeadStatus) => void setLeadStatus(lead.id, next)}
            />
            <Button type="button" variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon className="size-3.5" aria-hidden />
              Edit details
            </Button>
          </div>
        </div>
      </div>

      <div className="mb-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <Panel
            title="Visits and activity"
            description="Log a visit here, then write its call report. Each visit carries its own report, so a second visit never overwrites the first."
          >
            <ActivityComposer leadId={lead.id} onLog={logActivity} />

            <div className="mt-4 flex flex-col gap-1">
              {logged.length === 0 ? (
                <EmptyState
                  icon={<FileTextIcon className="size-5" />}
                  hint="Log a meeting or visit above, then use “Call report” on it to write the report for management."
                >
                  Nothing logged yet
                </EmptyState>
              ) : (
                logged.map((activity) => (
                  <div
                    key={activity.id}
                    className="flex items-center gap-3 border-b border-border-soft last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <ActivityRow
                        activity={activity}
                        onDelete={(id) => void removeActivity(id)}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => setReporting(activity)}
                      title={
                        hasCallReport(activity)
                          ? 'Open the call report for this visit'
                          : 'Write the call report for this visit'
                      }
                    >
                      <FileTextIcon className="size-3.5" aria-hidden />
                      {hasCallReport(activity) ? 'Call report' : 'Write report'}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>

        <aside className="flex min-w-0 flex-col gap-5">
          <Panel
            title="For the call report"
            description="The two fields the form asks about the client rather than the visit. Filled in once; every report reuses them."
            action={
              <Button
                type="button"
                variant="outline"
                disabled={!dirty || saving}
                onClick={() => void saveClientFacts()}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            }
          >
            <FieldRow>
              <Field label="Physical location" htmlFor="lead-location">
                <Input
                  id="lead-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Street, building, town"
                />
              </Field>
            </FieldRow>
            <Field label="Nature of business" htmlFor="lead-nature">
              <Input
                id="lead-nature"
                value={nature}
                onChange={(e) => setNature(e.target.value)}
                placeholder="What the client actually does"
              />
            </Field>
          </Panel>

          <Panel title="Client">
            <div className="flex flex-col gap-3.5">
              <Detail label="Contact">
                {lead.contactName || '—'}
                {lead.contactRole && (
                  <span className="text-muted-foreground"> · {lead.contactRole}</span>
                )}
              </Detail>
              <Detail label="Phone">{lead.phone || '—'}</Detail>
              <Detail label="Email">{lead.email || '—'}</Detail>
              <Detail label="Priority">{lead.priority}</Detail>
              <Detail label="Next action">
                {lead.nextActionDate ? formatDateWithYear(lead.nextActionDate) : '—'}
              </Detail>
              <Detail label="Recorded needs">{lead.needs || '—'}</Detail>
            </div>
          </Panel>
        </aside>
      </div>

      <LeadDialog
        lead={lead}
        open={editing}
        onOpenChange={setEditing}
        onSave={saveLead}
        onDelete={async (id) => {
          await removeLead(id)
          onBack()
        }}
      />

      {reporting && (
        <CallReportDialog
          visit={reporting}
          client={lead}
          open
          onOpenChange={(next) => !next && setReporting(null)}
        />
      )}
    </>
  )
}
