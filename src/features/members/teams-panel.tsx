import { useState } from 'react'
import { PlusIcon, TrashIcon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Checkbox } from '@/shared/ui/checkbox'
import { EmptyState, Panel } from '@/shared/components/panel'
import { usePipeline } from '@/shared/hooks/use-pipeline'
import { useAuth } from '@/shared/hooks/use-auth'
import type { Profile } from '@/domain/types'

/**
 * Teams, and who is in them.
 *
 * Lives on the Members page because it is the same kind of decision: a team is
 * a standing grant of read across whatever anyone later shares with it, so it
 * belongs beside the roles rather than beside the tenders. Sharing a single
 * tender is the member's own call and is done from the tender itself.
 *
 * Super user only, matching `manageTeams`. The panel is not rendered for
 * anyone else rather than rendered with disabled controls: an admin reading a
 * page of buttons that all refuse them is the mistake 0021 already fixed once
 * for the Members view itself.
 */
export function TeamsPanel({ members }: { members: Profile[] }) {
  const { teams, shares, createTeam, renameTeam, removeTeam, setTeamMember } = usePipeline()
  const { can } = useAuth()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  /** Which team's membership is expanded. One at a time — the lists are long. */
  const [open, setOpen] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  if (!can.manageTeams) return null

  async function run(work: () => Promise<void>) {
    setBusy(true)
    try {
      await work()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function add() {
    const value = name.trim()
    if (!value) return
    await run(async () => {
      await createTeam(value)
      setName('')
      toast.success(`Team "${value}" created`)
    })
  }

  async function commitRename(id: string) {
    const value = draftName.trim()
    setRenaming(null)
    if (!value) return
    await run(() => renameTeam(id, value))
  }

  /**
   * How many tenders this team can currently read.
   *
   * Counted from what the super user can see, which for them is everything —
   * `is_admin()` is the first branch of the share policy. Worth knowing that
   * this would undercount for anyone else, which is another reason the panel
   * is super-user only.
   */
  function sharesWith(teamId: string): number {
    let count = 0
    for (const list of shares.values()) {
      for (const share of list) if (share.teamId === teamId) count += 1
    }
    return count
  }

  async function drop(id: string, teamName: string, shareCount: number) {
    // Said before it happens, not after. Deleting a team cascades its shares
    // away, so this can quietly revoke access to work in progress.
    const warning = shareCount
      ? `Delete "${teamName}"? ${shareCount} tender${shareCount === 1 ? '' : 's'} shared with this team will stop being visible to its members.`
      : `Delete "${teamName}"?`
    if (!window.confirm(warning)) return
    await run(async () => {
      await removeTeam(id)
      toast.success(`Team "${teamName}" deleted`)
    })
  }

  return (
    <Panel
      title="Teams"
      description="Groups a tender can be shared with. Sharing gives read access only — a team never gains the ability to edit or bid anything."
      action={<UsersIcon className="size-5 text-clay" />}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          aria-label="New team name"
          placeholder="New team name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void add()
          }}
          className="w-[240px] max-w-full"
        />
        <Button variant="outline" onClick={() => void add()} disabled={!name.trim() || busy}>
          <PlusIcon className="size-3.5" />
          Create team
        </Button>
      </div>

      {teams.length === 0 ? (
        <EmptyState
          icon={<UsersIcon className="size-5" />}
          hint="A team is worth creating once the same few people keep being shared the same tenders."
        >
          No teams yet
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {teams.map((team) => (
            <li key={team.id} className="rounded-lg border border-border-soft">
              <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                {renaming === team.id ? (
                  <Input
                    autoFocus
                    aria-label={`Rename ${team.name}`}
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    onBlur={() => void commitRename(team.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void commitRename(team.id)
                      if (event.key === 'Escape') setRenaming(null)
                    }}
                    className="h-7 w-[240px] max-w-full text-xs"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setRenaming(team.id)
                      setDraftName(team.name)
                    }}
                    title="Rename"
                    className="cursor-pointer text-xs font-medium text-foreground hover:text-primary"
                  >
                    {team.name}
                  </button>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(open === team.id ? null : team.id)}
                    className="cursor-pointer text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {team.memberIds.length} member
                    {team.memberIds.length === 1 ? '' : 's'}
                    {open === team.id ? ' — hide' : ' — edit'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void drop(team.id, team.name, sharesWith(team.id))}
                    disabled={busy}
                    aria-label={`Delete ${team.name}`}
                    className="cursor-pointer rounded p-1 text-faint transition-colors hover:text-danger disabled:opacity-50"
                  >
                    <TrashIcon className="size-3.5" />
                  </button>
                </div>
              </div>

              {open === team.id && (
                <div className="flex flex-col gap-1.5 border-t border-border-soft px-3 py-2.5">
                  {members.length === 0 ? (
                    <p className="text-[11px] text-faint">The team list has not loaded.</p>
                  ) : (
                    members.map((member) => {
                      const inTeam = team.memberIds.includes(member.id)
                      return (
                        <label
                          key={member.id}
                          className="flex cursor-pointer items-center gap-2 text-xs text-foreground"
                        >
                          <Checkbox
                            checked={inTeam}
                            disabled={busy}
                            onCheckedChange={() =>
                              void run(() => setTeamMember(team.id, member.id, !inTeam))
                            }
                          />
                          {member.fullName || member.email}
                          {!member.active && (
                            <span className="text-[11px] text-faint">· switched off</span>
                          )}
                        </label>
                      )
                    })
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
