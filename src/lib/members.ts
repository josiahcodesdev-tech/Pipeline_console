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
