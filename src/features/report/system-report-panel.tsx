import { useMemo, useState } from 'react'
import { DownloadIcon, ServerCogIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Panel } from '@/shared/components/panel'
import { usePipeline } from '@/shared/hooks/use-pipeline'
import { fetchMembers } from '@/data/members'
import { SYSTEM_REPORT_SECTIONS, type SystemSnapshot } from './inventory'
import { downloadSystemReportDocx } from '@/documents/system-report'
import { useEffect } from 'react'

/**
 * A status report on the console itself, for taking to management.
 *
 * On the Reports page rather than a page of its own: it is a report, it is
 * exported the same way as the others, and a fourteenth item in the sidebar for
 * something read once a quarter is not worth the room.
 *
 * The sections are shown on screen as well as exported. A panel whose only
 * content is a download button asks the reader to open a file to find out
 * whether they wanted it.
 */
export function SystemReportPanel() {
  const { leads, rfps, proposals, activities, consultants } = usePipeline()
  const [members, setMembers] = useState<{ total: number; active: number }>({
    total: 0,
    active: 0,
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void fetchMembers()
      .then((list) => {
        if (live) {
          setMembers({ total: list.length, active: list.filter((m) => m.active).length })
        }
      })
      // A failed member count costs two numbers, not the report.
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  const snapshot = useMemo<SystemSnapshot>(
    () => ({
      members: members.total,
      activeMembers: members.active,
      tenders: rfps.length,
      tendersInPipeline: rfps.filter((rfp) => rfp.inPipeline).length,
      leads: leads.length,
      proposals: proposals.length,
      activities: activities.length,
      // A visit carries a report once it has a report date; that is what makes
      // one exist at all.
      callReports: activities.filter((activity) => activity.reportDate).length,
      consultants: consultants.length,
    }),
    [members, rfps, leads, proposals, activities, consultants],
  )

  async function download() {
    if (busy) return
    setBusy(true)
    try {
      await downloadSystemReportDocx(snapshot)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title="System capability report"
      description="What this console does today, what is built and waiting to be switched on, and what it does not do yet. Figures are read live at the moment of export."
      action={
        <Button type="button" onClick={() => void download()} disabled={busy}>
          <DownloadIcon className="size-3.5" aria-hidden />
          {busy ? 'Building…' : 'Download Word'}
        </Button>
      }
    >
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-border-soft bg-surface-2/60 px-3.5 py-3">
        <ServerCogIcon className="mt-0.5 size-4 shrink-0 text-clay" aria-hidden />
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          {snapshot.tenders} tenders held · {snapshot.tendersInPipeline} being bid ·{' '}
          {snapshot.proposals} proposals · {snapshot.leads} clients ·{' '}
          {snapshot.callReports} call reports · {snapshot.activeMembers} of{' '}
          {snapshot.members} members with access
        </p>
      </div>

      <div className="flex flex-col gap-5">
        {SYSTEM_REPORT_SECTIONS.map((section) => (
          <div key={section.title}>
            <h4 className="eyebrow mb-2 text-clay">{section.title}</h4>
            <ul className="flex flex-col gap-2">
              {section.items.map((item) => (
                <li
                  key={item.area}
                  className="border-b border-border-soft pb-2 last:border-b-0"
                >
                  <p className="text-[12.5px] font-medium text-foreground">{item.area}</p>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                    {item.what}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-faint">
        The examples behind each line are in the exported document. The lists are
        maintained by hand — a feature that exists but is not deployed looks
        identical to one that works, and only the writing can tell them apart.
      </p>
    </Panel>
  )
}
