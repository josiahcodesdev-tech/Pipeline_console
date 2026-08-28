import {
  isActivityType,
  isLeadPriority,
  isLeadStatus,
  isReportPeriod,
  isProposalKind,
  isRfpStatus,
  isSegment,
  type Activity,
  type Lead,
  type Proposal,
  type ProposalDesign,
  type Rfp,
  type Task,
  type TaskPriority,
  type Consultant,
  type WeeklyReport,
} from '@/domain/types'
import type {
  ActivityRow,
  ConsultantRow,
  LeadRow,
  ProposalRow,
  RfpRow,
  TaskRow,
  WeeklyReportRow,
} from './database.types'
import { dateOrNull } from './internal'
import type { ConsultantDraft, LeadDraft, RfpDraft } from './internal'

// ------------------------------------------------------------- mappers -----

export function toLead(row: LeadRow): Lead {
  return {
    id: row.id,
    ownerId: row.user_id,
    org: row.org,
    segment: isSegment(row.segment) ? row.segment : 'Government',
    country: row.country ?? '',
    contactName: row.contact_name ?? '',
    contactRole: row.contact_role ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    status: isLeadStatus(row.status) ? row.status : 'New',
    nextActionDate: row.next_action_date ?? '',
    source: row.source ?? '',
    notes: row.notes ?? '',
    priority: isLeadPriority(row.priority) ? row.priority : 'Medium',
    needs: row.needs ?? '',
    budgetBand: row.budget_band ?? '',
    decisionTimeline: row.decision_timeline ?? '',
    decisionProcess: row.decision_process ?? '',
    location: row.location ?? '',
    natureOfBusiness: row.nature_of_business ?? '',
    createdOn: row.created_on,
    statusUpdatedOn: row.status_updated_on ?? '',
  }
}

/**
 * The design column, or null where there is nothing usable in it.
 *
 * Guarded rather than cast. The column is jsonb with a `{}` default, so every
 * proposal written before migration 0040 and every uploaded file arrives here
 * as an empty object — and a half-written one would otherwise reach the
 * renderer as a template name with no values, which renders the previous
 * client's proposal.
 */
function toProposalDesign(value: unknown): ProposalDesign | null {
  if (typeof value !== 'object' || value === null) return null
  const design = value as Partial<ProposalDesign>
  if (typeof design.template !== 'string' || !design.template) return null
  if (typeof design.values !== 'object' || design.values === null) return null
  return {
    template: design.template,
    values: design.values as Record<string, string>,
    unfilled: Array.isArray(design.unfilled) ? design.unfilled : [],
    failures: Array.isArray(design.failures) ? design.failures : [],
    // Absent on every proposal that has never been opened in the free editor,
    // which is most of them. Guarded like the rest: a non-string here would
    // otherwise reach the storage client as an object path.
    ...(typeof design.editedPath === 'string' && design.editedPath
      ? { editedPath: design.editedPath }
      : {}),
  }
}

export function toProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    rfpId: row.rfp_id,
    kind: isProposalKind(row.kind) ? row.kind : 'draft',
    title: row.title ?? '',
    content: row.content ?? '',
    design: toProposalDesign(row.design),
    filePath: row.file_path ?? '',
    fileName: row.file_name ?? '',
    fileSize: row.file_size,
    notes: row.notes ?? '',
    isExemplar: row.is_exemplar ?? false,
    versionNo: row.version_no ?? 1,
    archivedAt: row.archived_at ?? '',
    createdAt: row.created_at,
  }
}

export function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    userId: row.user_id,
    leadId: row.lead_id,
    rfpId: row.rfp_id,
    type: isActivityType(row.type) ? row.type : 'Note',
    occurredOn: row.occurred_on,
    summary: row.summary,
    outcome: row.outcome ?? '',
    visitingOfficers: row.visiting_officers ?? '',
    officialsMet: row.officials_met ?? '',
    reportDate: row.report_date ?? '',
    meetingPurpose: row.meeting_purpose ?? '',
    businessBackground: row.business_background ?? '',
    keyNeeds: row.key_needs ?? '',
    wayForward: row.way_forward ?? '',
    otherComments: row.other_comments ?? '',
  }
}

export function toRfp(row: RfpRow): Rfp {
  return {
    id: row.id,
    ownerId: row.user_id,
    title: row.title,
    org: row.org ?? '',
    segment: isSegment(row.segment) ? row.segment : 'Government',
    deadline: row.deadline ?? '',
    value: row.value === null ? null : Number(row.value),
    status: isRfpStatus(row.status) ? row.status : 'Watching',
    link: row.link ?? '',
    notes: row.notes ?? '',
    source: row.source || 'Manual',
    sourced: row.sourced,
    inPipeline: row.in_pipeline,
    opportunityType: row.opportunity_type ?? '',
    kenya: row.kenya ?? false,
    serviceAreas: row.service_areas ?? '',
    fitScore: row.fit_score ?? 0,
    tenderText: row.tender_text ?? '',
    tenderFileName: row.tender_file_name ?? '',
    noticeText: row.notice_text ?? '',
    analysis: row.analysis ?? '',
    analysedAt: row.analysed_at ?? '',
    ingestion: row.ingestion ?? {},
    analysisJson: row.analysis_json ?? {},
    enrichment: row.enrichment ?? {},
    intelligenceUpdatedAt: row.intelligence_updated_at ?? '',
    externalId: row.external_id,
    createdOn: row.created_on,
    createdAt: row.created_at,
    statusUpdatedOn: row.status_updated_on ?? '',
  }
}

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    text: row.text,
    due: row.due ?? '',
    priority: (row.priority === 'High' ? 'High' : 'Normal') satisfies TaskPriority,
    linkedLead: row.linked_lead,
    done: row.done,
    completedOn: row.completed_on ?? '',
    createdOn: row.created_on,
  }
}

export function toWeeklyReport(row: WeeklyReportRow): WeeklyReport {
  return {
    id: row.id,
    weekStart: row.week_start,
    period: isReportPeriod(row.period) ? row.period : 'week',
    revenue: row.revenue === null ? null : Number(row.revenue),
    notes: row.notes ?? '',
    submitted: row.submitted,
  }
}

export function leadFields(draft: LeadDraft) {
  return {
    org: draft.org,
    segment: draft.segment,
    country: draft.country,
    contact_name: draft.contactName,
    contact_role: draft.contactRole,
    email: draft.email,
    phone: draft.phone,
    status: draft.status,
    next_action_date: dateOrNull(draft.nextActionDate),
    source: draft.source,
    notes: draft.notes,
    priority: draft.priority,
    needs: draft.needs,
    budget_band: draft.budgetBand,
    decision_timeline: draft.decisionTimeline,
    decision_process: draft.decisionProcess,
    location: draft.location,
    nature_of_business: draft.natureOfBusiness,
  }
}

export function rfpFields(draft: RfpDraft) {
  return {
    title: draft.title,
    org: draft.org,
    segment: draft.segment,
    deadline: dateOrNull(draft.deadline),
    value: draft.value,
    status: draft.status,
    link: draft.link,
    notes: draft.notes,
    source: draft.source,
    opportunity_type: draft.opportunityType,
    kenya: draft.kenya,
    service_areas: draft.serviceAreas,
    fit_score: draft.fitScore,
    tender_text: draft.tenderText,
    tender_file_name: draft.tenderFileName,
  }
}

export function toConsultant(row: ConsultantRow): Consultant {
  return {
    id: row.id,
    ownerId: row.user_id,
    name: row.name ?? '',
    title: row.title ?? '',
    coreExpertise: row.core_expertise ?? '',
    yearsExperience: row.years_experience,
    sectors: row.sectors ?? '',
    countries: row.countries ?? '',
    qualifications: row.qualifications ?? '',
    taskFit: row.task_fit ?? '',
    projectExperience: row.project_experience ?? '',
    languages: row.languages ?? '',
    availability: row.availability ?? '',
    shortBio: row.short_bio ?? '',
    longBio: row.long_bio ?? '',
    photoPath: row.photo_path ?? '',
    cvPath: row.cv_path ?? '',
    cvFileName: row.cv_file_name ?? '',
    cvSize: row.cv_size,
  }
}

export function consultantFields(draft: ConsultantDraft) {
  return {
    name: draft.name.trim(),
    title: draft.title.trim(),
    core_expertise: draft.coreExpertise.trim(),
    years_experience: draft.yearsExperience,
    sectors: draft.sectors.trim(),
    countries: draft.countries.trim(),
    qualifications: draft.qualifications.trim(),
    task_fit: draft.taskFit.trim(),
    project_experience: draft.projectExperience.trim(),
    languages: draft.languages.trim(),
    availability: draft.availability.trim(),
    short_bio: draft.shortBio.trim(),
    long_bio: draft.longBio.trim(),
  }
}
