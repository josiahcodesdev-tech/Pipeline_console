/**
 * Hand-written mirror of `supabase/migrations/0001_init.sql`.
 *
 * Kept by hand rather than generated so the project has no dependency on the
 * Supabase CLI. If you change the migration, change this too — or regenerate
 * with `supabase gen types typescript --local > src/lib/database.types.ts`.
 *
 * These are `type` aliases, not `interface`s, on purpose: PostgREST constrains
 * every row to `Record<string, unknown>`, and an interface has no implicit
 * index signature so it fails that constraint. The failure is silent — the
 * schema stops resolving and every insert payload degrades to `never`.
 */

export type LeadRow = {
  id: string
  user_id: string
  org: string
  segment: string
  country: string
  contact_name: string
  contact_role: string
  email: string
  phone: string
  status: string
  next_action_date: string | null
  source: string
  notes: string
  priority: string
  needs: string
  budget_band: string
  decision_timeline: string
  decision_process: string
  /** Client facts the call report asks for; see migration 0025. */
  location: string
  nature_of_business: string
  created_on: string
  status_updated_on: string | null
  created_at: string
  updated_at: string
}

export type ProposalRow = {
  id: string
  user_id: string
  rfp_id: string
  kind: string
  title: string
  content: string
  file_path: string
  file_name: string
  file_size: number | null
  notes: string
  is_exemplar: boolean
  created_at: string
  updated_at: string
}

export type UserSettingsRow = {
  user_id: string
  proposal_guidance: string
  concept_guidance: string
  boilerplate: string
  created_at: string
  updated_at: string
}

export type ActivityRow = {
  id: string
  user_id: string
  lead_id: string | null
  rfp_id: string | null
  type: string
  occurred_on: string
  summary: string
  outcome: string
  /** Call report, when this activity is a client visit; see migration 0025. */
  visiting_officers: string
  officials_met: string
  report_date: string | null
  meeting_purpose: string
  business_background: string
  key_needs: string
  way_forward: string
  other_comments: string
  created_at: string
  updated_at: string
}

export type RfpRow = {
  id: string
  user_id: string
  title: string
  org: string
  segment: string
  deadline: string | null
  value: number | null
  status: string
  link: string
  notes: string
  source: string
  sourced: boolean
  in_pipeline: boolean
  opportunity_type: string
  kenya: boolean
  service_areas: string
  /** Capability fit 0-100; see migration 0012. */
  fit_score: number
  /** Text extracted from the tender PDF in the browser; see migration 0011. */
  tender_text: string
  tender_file_name: string
  /** See migration 0030. */
  notice_text: string
  analysis: string
  analysed_at: string | null
  ingestion: Record<string, unknown>
  analysis_json: Record<string, unknown>
  enrichment: Record<string, unknown>
  intelligence_updated_at: string | null
  /** Opportunity id from the CareerCraft feed; null for manual entries. */
  external_id: string | null
  created_on: string
  status_updated_on: string | null
  created_at: string
  updated_at: string
}

export type TaskRow = {
  id: string
  user_id: string
  text: string
  due: string | null
  priority: string
  linked_lead: string | null
  done: boolean
  completed_on: string | null
  created_on: string
  created_at: string
  updated_at: string
}

export type WeeklyReportRow = {
  id: string
  user_id: string
  week_start: string
  period: string
  revenue: number | null
  notes: string
  submitted: boolean
  created_at: string
  updated_at: string
}

export type ConsultantRow = {
  id: string
  user_id: string
  name: string
  title: string
  core_expertise: string
  years_experience: number | null
  sectors: string
  countries: string
  qualifications: string
  task_fit: string
  project_experience: string
  languages: string
  availability: string
  short_bio: string
  long_bio: string
  photo_path: string
  cv_path: string
  cv_file_name: string
  cv_size: number | null
  created_at: string
  updated_at: string
}

/**
 * A team member's access. Mirrors `supabase/migrations/0013_roles.sql`.
 *
 * `id` is the auth user's id rather than a generated key — one profile per
 * account, created by a trigger with the account, so there is never a signed-in
 * user without a role.
 */
export type ProfileRow = {
  id: string
  email: string
  full_name: string
  role: string
  active: boolean
  created_at: string
  updated_at: string
}

export type RfpClaimRow = {
  external_id: string
  claimed_by: string
  claimed_at: string
  title: string
}

/** Columns the database fills in when omitted. */
type Generated = 'id' | 'created_at' | 'updated_at'

type Insertable<Row, Optional extends keyof Row> = Omit<Row, Optional> &
  Partial<Pick<Row, Optional>>

export type Database = {
  public: {
    Tables: {
      leads: {
        Row: LeadRow
        Insert: Insertable<LeadRow, Generated | 'created_on'>
        Update: Partial<LeadRow>
        Relationships: []
      }
      rfps: {
        Row: RfpRow
        // `external_id` is nullable with no default, so omitting it is valid.
        Insert: Insertable<
          RfpRow,
          | Generated
          | 'created_on'
          | 'external_id'
          | 'in_pipeline'
          | 'opportunity_type'
          | 'kenya'
          | 'service_areas'
          | 'fit_score'
          | 'tender_text'
          | 'tender_file_name'
          // Written by reading the tender, never at insert; see migration 0030.
          | 'notice_text'
          | 'analysis'
          | 'analysed_at'
          | 'ingestion'
          | 'analysis_json'
          | 'enrichment'
          | 'intelligence_updated_at'
        >
        Update: Partial<RfpRow>
        Relationships: []
      }
      tasks: {
        Row: TaskRow
        Insert: Insertable<TaskRow, Generated | 'created_on'>
        Update: Partial<TaskRow>
        Relationships: []
      }
      weekly_reports: {
        Row: WeeklyReportRow
        Insert: Insertable<WeeklyReportRow, Generated>
        Update: Partial<WeeklyReportRow>
        Relationships: []
      }
      user_settings: {
        Row: UserSettingsRow
        Insert: Insertable<UserSettingsRow, 'created_at' | 'updated_at'>
        Update: Partial<UserSettingsRow>
        Relationships: []
      }
      proposals: {
        Row: ProposalRow
        Insert: Insertable<ProposalRow, Generated | 'is_exemplar'>
        Update: Partial<ProposalRow>
        Relationships: []
      }
      activities: {
        Row: ActivityRow
        // The call-report columns all carry defaults and are written by their
        // own update, never at insert: logging a call must not have to supply
        // eight empty strings for a report that will never be written.
        Insert: Insertable<
          ActivityRow,
          | Generated
          | 'occurred_on'
          | 'visiting_officers'
          | 'officials_met'
          | 'report_date'
          | 'meeting_purpose'
          | 'business_background'
          | 'key_needs'
          | 'way_forward'
          | 'other_comments'
        >
        Update: Partial<ActivityRow>
        Relationships: []
      }
      rfp_claims: {
        Row: RfpClaimRow
        Insert: Insertable<RfpClaimRow, "claimed_at" | "title">
        Update: Partial<RfpClaimRow>
        Relationships: []
      }
      profiles: {
        Row: ProfileRow
        // Rows are created by the on_auth_user_created trigger, not by this
        // client — the only field the app ever writes is a display name, and
        // role changes go through the manage-members function.
        Insert: Insertable<
          ProfileRow,
          'created_at' | 'updated_at' | 'email' | 'full_name' | 'role' | 'active'
        >
        Update: Partial<ProfileRow>
        Relationships: []
      }
      consultants: {
        Row: ConsultantRow
        // Every descriptive column defaults to '' — only a name is required to
        // start a record, so the rest can be filled in over time.
        Insert: Insertable<
          ConsultantRow,
          | Generated
          | 'title'
          | 'core_expertise'
          | 'years_experience'
          | 'sectors'
          | 'countries'
          | 'qualifications'
          | 'task_fit'
          | 'project_experience'
          | 'languages'
          | 'availability'
          | 'short_bio'
          | 'long_bio'
          | 'photo_path'
          | 'cv_path'
          | 'cv_file_name'
          | 'cv_size'
        >
        Update: Partial<ConsultantRow>
        Relationships: []
      }
    }
    // `{ [_ in never]: never }` is the shape `supabase gen types` emits for an
    // empty group; `Record<string, never>` does not satisfy `GenericSchema`.
    Views: { [_ in never]: never }
    Functions: {
      /**
       * Firm-wide tender counts, deduplicated across members. Admin only —
       * see migration 0020. Counting happens in the database because summing
       * per-member figures counts each tender once per member.
       */
      team_overview: {
        Args: Record<string, never>
        Returns: {
          open_tenders: number
          all_tenders: number
          in_pipeline: number
          unclaimed_open: number
        }
      }
      /**
       * Moves a tender, its proposals, its activities and its claim to another
       * member. Admin and super user only — see migration 0028. One call
       * because the four writes have to agree afterwards.
       */
      reassign_rfp: {
        Args: { target: string; new_owner: string }
        Returns: undefined
      }
      match_knowledge_chunks: {
        Args: { query_embedding: number[]; match_count?: number; minimum_similarity?: number }
        Returns: Array<{ id:string; source_type:string; source_id:string; title:string; content:string; metadata:Record<string,unknown>; similarity:number }>
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
