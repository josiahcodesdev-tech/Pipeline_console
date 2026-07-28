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
        Insert: Insertable<ActivityRow, Generated | 'occurred_on'>
        Update: Partial<ActivityRow>
        Relationships: []
      }
    }
    // `{ [_ in never]: never }` is the shape `supabase gen types` emits for an
    // empty group; `Record<string, never>` does not satisfy `GenericSchema`.
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
