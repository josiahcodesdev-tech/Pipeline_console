import { supabase } from './client'
import { currentUserId } from './internal'
import type { RfpShare, Team } from '@/domain/types'

/**
 * Teams, and read access to a tender granted to a member or a team.
 *
 * Everything here writes to `teams`, `team_members` and `rfp_shares` directly
 * rather than through an Edge Function, which is the opposite of how member
 * management works and is worth a word. `manage-members` exists because
 * creating an account needs the service-role key. Nothing here does: a share
 * is one row a member is allowed to write about a tender they already own, and
 * migration 0039's policies say so. Routing it through a function would move
 * the check somewhere less enforceable, not somewhere safer.
 *
 * Read access is all any of this grants. There is no "edit" level to pass —
 * see the note at the top of 0039 for why that was left out rather than
 * forgotten.
 */

interface TeamRow {
  id: string
  name: string | null
  created_at: string | null
}

interface TeamMemberRow {
  team_id: string
  user_id: string
}

/**
 * Every team, with its members.
 *
 * Two queries rather than a join. PostgREST would happily embed the members,
 * but the embed comes back nested per team and has to be flattened anyway, and
 * a team with no members yet returns an empty array through one shape and a
 * null through the other. Two flat reads and a Map is less code and fewer ways
 * to be wrong; both tables are small — a team list is a dozen rows, not a
 * thousand.
 */
export async function fetchTeams(): Promise<Team[]> {
  const [teams, members] = await Promise.all([
    supabase.from('teams').select('id, name, created_at').order('name'),
    supabase.from('team_members').select('team_id, user_id'),
  ])

  if (teams.error) throw new Error(`Could not load teams: ${teams.error.message}`)
  if (members.error) {
    throw new Error(`Could not load team membership: ${members.error.message}`)
  }

  const byTeam = new Map<string, string[]>()
  for (const row of (members.data ?? []) as TeamMemberRow[]) {
    const list = byTeam.get(row.team_id) ?? []
    list.push(row.user_id)
    byTeam.set(row.team_id, list)
  }

  return ((teams.data ?? []) as TeamRow[]).map((row) => ({
    id: row.id,
    name: row.name ?? '',
    memberIds: byTeam.get(row.id) ?? [],
    createdAt: row.created_at ?? '',
  }))
}

/**
 * The same characters barred from a display name, and for the same reason:
 * a team name is rendered next to a member's, in the same places.
 */
const NOT_IN_NAME = /[<>{}\\|`]/

function cleanName(name: string): string {
  const value = name.trim().slice(0, 80)
  if (!value) throw new Error('A team needs a name.')
  if (NOT_IN_NAME.test(value)) {
    throw new Error('A team name cannot contain < > { } \\ | or ` characters.')
  }
  return value
}

/**
 * Turns the database's complaint into one a person can act on.
 *
 * The unique index on `lower(trim(name))` is the only thing standing between
 * the firm and two teams called "Health" — worth keeping, and worth not
 * showing to a super user as "duplicate key value violates unique constraint".
 */
function nameError(message: string, name: string): Error {
  if (message.includes('teams_name_key')) {
    return new Error(`There is already a team called "${name}".`)
  }
  return new Error(message)
}

export async function createTeam(name: string): Promise<Team> {
  const value = cleanName(name)
  const createdBy = await currentUserId()

  const { data, error } = await supabase
    .from('teams')
    .insert({ name: value, created_by: createdBy })
    .select('id, name, created_at')
    .single()

  if (error) throw nameError(`Could not create the team: ${error.message}`, value)
  const row = data as TeamRow
  return { id: row.id, name: row.name ?? value, memberIds: [], createdAt: row.created_at ?? '' }
}

export async function renameTeam(id: string, name: string): Promise<void> {
  const value = cleanName(name)
  const { error } = await supabase.from('teams').update({ name: value }).eq('id', id)
  if (error) throw nameError(`Could not rename the team: ${error.message}`, value)
}

/**
 * Deletes a team.
 *
 * Its shares go with it, by cascade from `rfp_shares.team_id`. That is the
 * intended reading — the grant was to the team, so with the team gone there is
 * nobody left it was granted to — but it does mean deleting a team silently
 * revokes access to every tender shared with it, which the caller should say
 * out loud before doing.
 */
export async function deleteTeam(id: string): Promise<void> {
  const { error } = await supabase.from('teams').delete().eq('id', id)
  if (error) throw new Error(`Could not delete the team: ${error.message}`)
}

export async function addTeamMember(teamId: string, userId: string): Promise<void> {
  const addedBy = await currentUserId()
  const { error } = await supabase
    .from('team_members')
    .insert({ team_id: teamId, user_id: userId, added_by: addedBy })
  // Adding someone already on the team is what a double-click looks like, not
  // a failure worth showing.
  if (error && !error.message.includes('duplicate key')) {
    throw new Error(`Could not add the member: ${error.message}`)
  }
}

export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', userId)
  if (error) throw new Error(`Could not remove the member: ${error.message}`)
}

// ------------------------------------------------------------------ shares ---

interface RfpShareRow {
  id: string
  rfp_id: string
  user_id: string | null
  team_id: string | null
  shared_by: string
  shared_at: string | null
}

function toShare(row: RfpShareRow): RfpShare {
  return {
    id: row.id,
    rfpId: row.rfp_id,
    memberId: row.user_id,
    teamId: row.team_id,
    sharedBy: row.shared_by,
    sharedAt: row.shared_at ?? '',
  }
}

/**
 * Every share the caller is allowed to see, across all tenders.
 *
 * Fetched whole rather than per tender because the console needs it in two
 * places at once — the badge on a row in the register, and the list on the
 * profile — and the table holds one row per grant, not per tender per member.
 * The policy in 0039 already narrows this to shares the caller is party to.
 */
export async function fetchShares(): Promise<RfpShare[]> {
  const { data, error } = await supabase
    .from('rfp_shares')
    .select('id, rfp_id, user_id, team_id, shared_by, shared_at')

  if (error) throw new Error(`Could not load who a tender is shared with: ${error.message}`)
  return ((data ?? []) as RfpShareRow[]).map(toShare)
}

/**
 * Grants read on one tender to one member or one team.
 *
 * `subject` carries which of the two it is rather than the function taking two
 * nullable ids, so a caller cannot pass both and cannot pass neither — the
 * check constraint would refuse it, but at that point the mistake is a round
 * trip away from where it was made.
 */
export async function shareRfp(
  rfpId: string,
  subject: { kind: 'member'; id: string } | { kind: 'team'; id: string },
): Promise<RfpShare> {
  const sharedBy = await currentUserId()

  if (subject.kind === 'member' && subject.id === sharedBy) {
    throw new Error('You already have this tender — it is yours.')
  }

  const { data, error } = await supabase
    .from('rfp_shares')
    .insert({
      rfp_id: rfpId,
      shared_by: sharedBy,
      ...(subject.kind === 'member' ? { user_id: subject.id } : { team_id: subject.id }),
    })
    .select('id, rfp_id, user_id, team_id, shared_by, shared_at')
    .single()

  if (error) {
    if (error.message.includes('rfp_shares_member_key')) {
      throw new Error('That member can already see this tender.')
    }
    if (error.message.includes('rfp_shares_team_key')) {
      throw new Error('That team can already see this tender.')
    }
    throw new Error(`Could not share the tender: ${error.message}`)
  }
  return toShare(data as RfpShareRow)
}

export async function revokeShare(id: string): Promise<void> {
  const { error } = await supabase.from('rfp_shares').delete().eq('id', id)
  if (error) throw new Error(`Could not withdraw access: ${error.message}`)
}
