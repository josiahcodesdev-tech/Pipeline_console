import { useMemo, useState } from 'react'
import { Building2Icon, PlusIcon, SearchXIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { LeadStatusSelect } from '@/components/status-select'
import { usePipeline } from '@/hooks/use-pipeline'
import { formatDateWithYear } from '@/lib/dates'
import {
  LEAD_STATUSES,
  SEGMENTS,
  type Lead,
  type LeadStatus,
  type Segment,
} from '@/lib/types'
import { LeadDialog } from './lead-dialog'

export function LeadsView({
  /**
   * Stage to open filtered to. Set when the register is reached by clicking a
   * pipeline stage on the dashboard, so the click lands on those leads rather
   * than on all of them. The caller remounts on change, so this is genuinely
   * an initial value.
   */
  initialStatus,
}: {
  initialStatus?: LeadStatus
} = {}) {
  const { leads, saveLead, removeLead, setLeadStatus } = usePipeline()
  const [search, setSearch] = useState('')
  const [segment, setSegment] = useState<Segment | 'all'>('all')
  const [status, setStatus] = useState<LeadStatus | 'all'>(initialStatus ?? 'all')
  const [editing, setEditing] = useState<Lead | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return leads.filter((lead) => {
      if (segment !== 'all' && lead.segment !== segment) return false
      if (status !== 'all' && lead.status !== status) return false
      if (
        term &&
        !lead.org.toLowerCase().includes(term) &&
        !lead.contactName.toLowerCase().includes(term)
      ) {
        return false
      }
      return true
    })
  }, [leads, search, segment, status])

  function open(lead: Lead | null) {
    setEditing(lead)
    setDialogOpen(true)
  }

  return (
    <>
      <ViewHeader
        eyebrow="Lead generation"
        title="Institutional database"
        description="Every organisation in play, and whose court the ball is in. A worked lead with no next action is the thing this page exists to surface."
        meta={
          <span className="text-[11px] text-muted-foreground">
            {leads.length} {leads.length === 1 ? 'organisation' : 'organisations'}
          </span>
        }
        action={
          <Button onClick={() => open(null)}>
            <PlusIcon />
            Add lead
          </Button>
        }
      />

      <div className="mb-3.5 flex flex-wrap gap-2">
        <Input
          placeholder="Search org or contact…"
          aria-label="Search leads"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-[220px]"
        />
        <FilterSelect
          value={segment}
          options={SEGMENTS}
          onChange={setSegment}
          allLabel="All segments"
          ariaLabel="Filter by segment"
        />
        <FilterSelect
          value={status}
          options={LEAD_STATUSES}
          onChange={setStatus}
          allLabel="All statuses"
          ariaLabel="Filter by status"
        />
      </div>

      <Panel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Organization</TableHead>
              <TableHead>Segment</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Next action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((lead) => (
              <TableRow
                key={lead.id}
                onClick={() => open(lead)}
                className="cursor-pointer"
              >
                <TableCell className="max-w-[280px] font-medium">{lead.org}</TableCell>
                <TableCell>
                  <span className="inline-block whitespace-nowrap rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {lead.segment}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {lead.country || '—'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {lead.contactName || '—'}
                </TableCell>
                <TableCell>
                  <LeadStatusSelect
                    value={lead.status}
                    onChange={(next) => setLeadStatus(lead.id, next)}
                  />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {lead.nextActionDate ? (
                    formatDateWithYear(lead.nextActionDate)
                  ) : (
                    // A worked lead with no next step is the thing this console
                    // exists to catch, so it is called out rather than left blank.
                    <span className="font-medium text-danger">none set</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {filtered.length === 0 &&
          (leads.length === 0 ? (
            <EmptyState
              icon={<Building2Icon className="size-5" />}
              hint="Add the first ministry, NGO or corporate you are working and the pipeline bar on the dashboard starts filling."
            >
              No leads yet
            </EmptyState>
          ) : (
            <EmptyState
              icon={<SearchXIcon className="size-5" />}
              hint="Try a broader search, or reset the segment and status filters above."
            >
              No leads match these filters
            </EmptyState>
          ))}
      </Panel>

      <LeadDialog
        lead={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={saveLead}
        onDelete={removeLead}
      />
    </>
  )
}
