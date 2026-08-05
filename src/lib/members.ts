import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { isMemberRole, type MemberRole, type Profile } from './types'

/**
 * Reading the team list and asking the server to change it.
 *
 * Reads go straight to `profiles` — every signed-in member may see who their
 * colleagues are. Writes go through the `manage-members` Edge Function, because
 * creating an account and setting a role need the service-role key, and that
 * key is the one thing that must never be in a browser bundle.
 */

interface ProfileRow {
  id: string
  email: string | null
  full_name: string | null
  role: string | null
  active: boolean | null
  created_at: string | null
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    email: row.email ?? '',
    fullName: row.full_name ?? '',
    role: isMemberRole(row.role) ? row.role : 'user',
    active: row.active ?? true,
    createdAt: row.created_at ?? '',
  }
}

export async function fetchMembers(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, active, created_at')
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Could not load the team: ${error.message}`)
  return (data ?? []).map((row) => toProfile(row as ProfileRow))
}

/**
 * Member ids to display names, for labelling who holds what.
 *
 * A claim stores a user id, and showing a uuid to someone tells them nothing.
 * Failure is swallowed to an empty map on purpose: the callers all fall back
 * to "another member", which is the useful half of the sentence, and a tender
 * tracker should not go blank because a name lookup failed.
 */
export function useMemberNames(): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    let live = true
    void fetchMembers()
      .then((list) => {
        if (live) setNames(new Map(list.map((m) => [m.id, m.fullName || m.email])))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  return names
}

/**
 * Firm-wide tender counts.
 *
 * Read from the database rather than summed from what members can see: each
 * member holds their own copy of every scraped tender, so adding those up
 * counts one opportunity once per member and the total grows when you hire.
 */
export interface TeamOverview {
  /** Distinct tenders still open, however many copies exist. */
  openTenders: number
  allTenders: number
  /** Tenders someone has taken on. Already one per tender, firm-wide. */
  inPipeline: number
  /** Open tenders nobody has taken — the work still on the table. */
  unclaimedOpen: number
}

export async function fetchTeamOverview(): Promise<TeamOverview> {
  const { data, error } = await supabase.rpc('team_overview')
  if (error) throw new Error(`Could not load the firm-wide figures: ${error.message}`)
  const row = (data ?? {}) as Record<string, number>
  return {
    openTenders: row.open_tenders ?? 0,
    allTenders: row.all_tenders ?? 0,
    inPipeline: row.in_pipeline ?? 0,
    unclaimedOpen: row.unclaimed_open ?? 0,
  }
}

/** One tender someone has taken on, with who is on it. */
export interface TeamPipelineItem {
  id: string
  title: string
  org: string
  deadline: string
  status: string
  ownerId: string
  fitScore: number
  value: number | null
}

/**
 * Everything the firm is currently bidding, across every member.
 *
 * No deduplication needed: a scraped tender can only be in one member's
 * pipeline because the claim is exclusive, and a hand-added one only ever
 * appears in its author's list. So one row here really is one live bid.
 *
 * Relies on the admin read policy — a standard user calling this gets their
 * own rows back, which is harmless but not useful, so the caller gates it.
 */
export async function fetchTeamPipeline(): Promise<TeamPipelineItem[]> {
  const { data, error } = await supabase
    .from('rfps')
    .select('id, title, org, deadline, status, user_id, fit_score, value')
    .eq('in_pipeline', true)
    .order('deadline', { ascending: true, nullsFirst: false })

  if (error) throw new Error(`Could not load the team pipeline: ${error.message}`)
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    org: row.org ?? '',
    deadline: row.deadline ?? '',
    status: row.status,
    ownerId: row.user_id,
    fitScore: row.fit_score ?? 0,
    value: row.value === null ? null : Number(row.value),
  }))
}

/** Anyone may set their own display name; nobody may set their own role. */
export async function saveOwnName(id: string, fullName: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: fullName.trim().slice(0, 120) })
    .eq('id', id)
  if (error) throw new Error(`Could not save your name: ${error.message}`)
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T & { error?: string }>(
    'manage-members',
    { body },
  )

  // A non-2xx from an Edge Function arrives as a FunctionsHttpError whose
  // message is just the status, so the useful part has to be read off the
  // response body rather than the error.
  if (error) {
    const detail = await readFunctionError(error)
    throw new Error(
      detail ??
        `Could not reach the members service (${error.message}). Check that manage-members is deployed.`,
    )
  }
  if (data && typeof data === 'object' && 'error' in data && data.error) {
    throw new Error(String(data.error))
  }
  return data as T
}

async function readFunctionError(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown })?.context
  if (!(context instanceof Response)) return null
  try {
    const body = (await context.json()) as { error?: string }
    return body?.error ?? null
  } catch {
    return null
  }
}

export interface CreatedMember {
  id: string
  email: string
  role: MemberRole
  /** Shown once and never stored. The member changes it on first sign-in. */
  password: string
}

export function createMember(input: {
  email: string
  fullName: string
  role: MemberRole
}): Promise<CreatedMember> {
  return call<CreatedMember>({ action: 'create', ...input })
}

export function setMemberRole(id: string, role: MemberRole): Promise<unknown> {
  return call({ action: 'set-role', id, role })
}

export function setMemberActive(id: string, active: boolean): Promise<unknown> {
  return call({ action: 'set-active', id, active })
}

/** Destroys everything the member owns. The flag is the server's requirement. */
export function removeMember(id: string): Promise<unknown> {
  return call({ action: 'delete', id, confirmDataLoss: true })
}
