import { useMemo, useState } from 'react'
import { PlusIcon } from 'lucide-react'
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
import { LeadStatusBadge } from '@/components/status-badge'
import { usePipeline } from '@/hooks/use-pipeline'
import { formatDate } from '@/lib/dates'
import {
  LEAD_STATUSES,
  SEGMENTS,
  type Lead,
  type LeadStatus,
  type Segment,
} from '@/lib/types'
import { LeadDialog } from './lead-dialog'

export function LeadsView() {
  const { leads, saveLead, removeLead } = usePipeline()
  const [search, setSearch] = useState('')
  const [segment, setSegment] = useState<Segment | 'all'>('all')
  const [status, setStatus] = useState<LeadStatus | 'all'>('all')
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
        title="Institutional database"
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

      <Panel bodyClassName="overflow-x-auto">
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
                <TableCell className="font-medium">{lead.org}</TableCell>
                <TableCell>{lead.segment}</TableCell>
                <TableCell>{lead.country || '—'}</TableCell>
                <TableCell>{lead.contactName || '—'}</TableCell>
                <TableCell>
                  <LeadStatusBadge status={lead.status} />
                </TableCell>
                <TableCell>
                  {lead.nextActionDate ? (
                    formatDate(lead.nextActionDate)
                  ) : (
                    // A worked lead with no next step is the thing this console
                    // exists to catch, so it is called out rather than left blank.
                    <span className="text-danger">none set</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {filtered.length === 0 && (
          <EmptyState>
            {leads.length === 0
              ? 'No leads yet. Add your first institutional lead to start the pipeline.'
              : 'No leads match these filters.'}
          </EmptyState>
        )}
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
