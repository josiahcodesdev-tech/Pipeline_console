import { useMemo, useState } from 'react'
import {
  BriefcaseBusinessIcon,
  ExternalLinkIcon,
  MonitorCogIcon,
  RefreshCwIcon,
  SearchIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table'
import { EmptyState, Panel, ViewHeader } from '@/shared/components/panel'
import { usePipeline } from '@/shared/hooks/use-pipeline'
import { useAuth } from '@/shared/hooks/use-auth'
import { addDays, formatDateWithYear, today } from '@/domain/dates'
import type { Rfp } from '@/domain/types'

/** Product families named in the Eval 360 Digital Solutions brief. */
const SOLUTIONS = [
  {
    // Fallback for synced rows: connectors retain the matched capability tag
    // even when their feed does not provide enough notice text to identify the
    // narrower product family in the browser.
    label: 'Digital solutions',
    terms: ['digital solutions'],
  },
  {
    label: 'MEAL / M&E system',
    terms: [
      'meal system',
      'monitoring and evaluation information system',
      'monitoring & evaluation information system',
      'm&e mis',
      'digital m&e platform',
      'digital monitoring and evaluation',
      'project information system',
    ],
  },
  {
    label: 'Beneficiary management',
    terms: ['beneficiary management system', 'beneficiary information system'],
  },
  {
    label: 'Case management',
    terms: ['case management system', 'digital case management'],
  },
  {
    label: 'Grant & project monitoring',
    terms: [
      'grant monitoring system',
      'grant management system',
      'project monitoring system',
      'project learning and evaluation',
      'evaluation management system',
      'recommendation tracking',
    ],
  },
  {
    label: 'Government performance',
    terms: [
      'strategic plan monitoring',
      'strategic-plan monitoring',
      'government performance system',
      'public sector m&e system',
      'public sector monitoring and evaluation system',
    ],
  },
  {
    label: 'Performance appraisal system',
    terms: [
      'performance appraisal system',
      'employee appraisal system',
      'staff appraisal system',
      'digital appraisal system',
      'employee performance management system',
      'staff performance management system',
      'performance evaluation system',
      'appraisal management system',
      'online performance appraisal',
      'electronic performance appraisal',
      'e-performance appraisal',
      'epms',
    ],
  },
] as const

function searchableText(opportunity: Rfp): string {
  return [
    opportunity.title,
    opportunity.org,
    opportunity.notes,
    opportunity.serviceAreas,
    opportunity.noticeText,
    opportunity.tenderText,
  ]
    .join(' ')
    .toLocaleLowerCase()
}

function solutionMatches(opportunity: Rfp): string[] {
  const text = searchableText(opportunity)
  return SOLUTIONS.filter((solution) =>
    solution.terms.some((term) => text.includes(term)),
  ).map((solution) => solution.label)
}

function isJobOrTask(opportunity: Rfp): boolean {
  const type = opportunity.opportunityType.trim().toLocaleLowerCase()
  return type === 'job' || type === 'task' || type === 'assignment'
}

function organizationType(opportunity: Rfp): string {
  const text = `${opportunity.org} ${opportunity.source}`.toLocaleLowerCase()
  if (/united nations|\bun\b|undp|unicef|unops|unesco|unhcr|unfpa|ungm/.test(text)) {
    return 'UN agency'
  }
  if (/world bank|afdb|development bank|dfat|fcdo|usaid/.test(text)) {
    return 'Development agency'
  }
  if (/ministry|government|county|commission|authority|department/.test(text)) {
    return 'Government'
  }
  if (/foundation|trust/.test(text)) return 'Foundation'
  return opportunity.segment === 'NGO' ? 'NGO' : opportunity.segment
}

function locationOf(opportunity: Rfp): string {
  return opportunity.notes.match(/(?:^|\n)Location:\s*([^\n]+)/i)?.[1]?.trim() || '—'
}

function scopeOf(opportunity: Rfp, matches: string[]): string {
  const supplied = opportunity.notes.match(/(?:^|\n)Scope:\s*([^\n]+)/i)?.[1]?.trim()
  if (supplied) return supplied
  if (matches.length > 0) return `Seeking a ${matches.join(', ')} solution.`
  return opportunity.serviceAreas || 'Open the notice for the detailed scope.'
}

function referenceOf(opportunity: Rfp): string {
  return opportunity.externalId?.replace(/^[^:]+:/, '') || '—'
}

function OpportunityTable({
  opportunities,
  onOpen,
}: {
  opportunities: Array<{ opportunity: Rfp; matches: string[] }>
  onOpen: (id: string) => void
}) {
  if (opportunities.length === 0) {
    return (
      <EmptyState
        icon={<SearchIcon className="size-5" />}
        hint="Matching opportunities will appear here automatically when they enter the RFP feed."
      >
        No matching opportunities
      </EmptyState>
    )
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Organization</TableHead>
            <TableHead>RFP / reference</TableHead>
            <TableHead>Deadline</TableHead>
            <TableHead>Country / region</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Notice</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {opportunities.map(({ opportunity, matches }) => (
            <TableRow
              key={opportunity.id}
              tabIndex={0}
              role="button"
              onClick={() => onOpen(opportunity.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onOpen(opportunity.id)
              }}
              className="cursor-pointer"
            >
              <TableCell>
                <div className="font-medium text-foreground">
                  {opportunity.org || opportunity.source}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {organizationType(opportunity)} · {opportunity.source}
                </div>
              </TableCell>
              <TableCell>
                <div className="max-w-[360px] font-medium text-foreground">
                  {opportunity.title}
                </div>
                <div className="mt-1 flex max-w-[360px] flex-wrap items-center gap-1">
                  <span className="mr-1 text-[10px] text-faint">Ref {referenceOf(opportunity)}</span>
                  {matches.map((match) => (
                    <span
                      key={match}
                      className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-medium text-primary"
                    >
                      {match}
                    </span>
                  ))}
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {formatDateWithYear(opportunity.deadline)}
              </TableCell>
              <TableCell>{locationOf(opportunity)}</TableCell>
              <TableCell>
                <p className="min-w-[260px] max-w-[440px] text-xs leading-relaxed text-muted-foreground">
                  {scopeOf(opportunity, matches)}
                </p>
              </TableCell>
              <TableCell>
                {opportunity.link ? (
                  <a
                    href={opportunity.link}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Open source notice for ${opportunity.title}`}
                    className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-primary hover:text-clay"
                  >
                    Open <ExternalLinkIcon className="size-3" />
                  </a>
                ) : (
                  '—'
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function DigitalSolutionsView({
  onOpenProfile,
}: {
  onOpenProfile: (id: string) => void
}) {
  const { rfps, syncOpportunities } = usePipeline()
  const { can } = useAuth()
  const [search, setSearch] = useState('')
  const [syncing, setSyncing] = useState(false)

  const matches = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    const currentDate = today()
    const recentCutoff = addDays(currentDate, -60)
    return rfps
      .map((opportunity) => ({ opportunity, matches: solutionMatches(opportunity) }))
      .filter(({ opportunity, matches }) => {
        if (opportunity.deadline && opportunity.deadline < currentDate) return false
        if (matches.length === 0) return false
        return !query || searchableText(opportunity).includes(query)
      })
      .sort((a, b) => {
        const aRecent = a.opportunity.createdOn >= recentCutoff
        const bRecent = b.opportunity.createdOn >= recentCutoff
        if (aRecent !== bRecent) return aRecent ? -1 : 1
        if (!a.opportunity.deadline) return 1
        if (!b.opportunity.deadline) return -1
        return a.opportunity.deadline.localeCompare(b.opportunity.deadline)
      })
  }, [rfps, search])

  const procurement = matches.filter(({ opportunity }) => !isJobOrTask(opportunity))
  const jobs = matches.filter(({ opportunity }) => isJobOrTask(opportunity))

  async function handleSync() {
    setSyncing(true)
    try {
      const outcome = await syncOpportunities()
      if (outcome.added > 0) {
        toast.success(
          `${outcome.added} new opportunit${outcome.added === 1 ? 'y' : 'ies'} imported and checked for Digital Solutions`,
        )
      } else {
        toast.info(
          `Up to date — ${outcome.fetched} matching source records were already checked.`,
        )
      }
      if (outcome.skipped.length > 0) {
        toast.warning(outcome.skipped[0])
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <>
      <ViewHeader
        eyebrow="Eval 360 opportunity pipeline"
        title="Digital Solutions"
        description="RFPs, procurement notices, jobs and assignments for digital MEAL, beneficiary, case, grant, evaluation, government performance and staff appraisal systems."
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-[260px] max-w-full">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
              <Input
                aria-label="Search digital solution opportunities"
                placeholder="Search opportunities"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full pl-9"
              />
            </div>
            {can.sync && (
              <Button
                variant="outline"
                onClick={() => void handleSync()}
                disabled={syncing}
                title="Fetch all sources, including ReliefWeb, and update this list"
              >
                <RefreshCwIcon className={syncing ? 'animate-spin' : undefined} />
                {syncing ? 'Checking…' : 'Update opportunities'}
              </Button>
            )}
          </div>
        }
      />

      <Panel
        title={`RFPs & procurement (${procurement.length})`}
        description="Tenders and procurement opportunities matching the Eval 360 product scope."
        action={<MonitorCogIcon className="size-5 text-clay" />}
      >
        <OpportunityTable opportunities={procurement} onOpen={onOpenProfile} />
      </Panel>

      <Panel
        title={`Jobs & tasks (${jobs.length})`}
        description="Job, task and assignment notices that call for the same digital solution capabilities."
        action={<BriefcaseBusinessIcon className="size-5 text-clay" />}
      >
        <OpportunityTable opportunities={jobs} onOpen={onOpenProfile} />
      </Panel>
    </>
  )
}
