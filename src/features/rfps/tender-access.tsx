import { useMemo, useState } from 'react'
import { ChevronDownIcon, ShareIcon, UsersIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/shared/ui/select'
import { Panel } from '@/shared/components/panel'
import { usePipeline } from '@/shared/hooks/use-pipeline'
import { useAuth } from '@/shared/hooks/use-auth'
import { useMemberNames } from '@/shared/hooks/use-member-names'
import type { Rfp } from '@/domain/types'

/**
 * Who else can read this tender, and the controls to change it.
 *
 * Shown only to someone who can actually grant — the tender's owner, or
 * oversight. A member who was shared a tender sees nothing here, which is the
 * visible half of the rule in migration 0039 that a share cannot be passed on:
 * the list of who can see a bid stays answerable by the person who owns it.
 *
 * The panel is deliberately plain about what a share is. "Can read" is the
 * whole grant — no editing, no drafting, no taking the tender over — and
 * saying so on the panel is cheaper than the conversation that follows a
 * colleague discovering it by trying.
 */
export function TenderAccess({ rfp }: { rfp: Rfp }) {
  const { shares, teams, shareRfpWith, revokeRfpShare } = usePipeline()
  const { profile, can } = useAuth()
  const memberNames = useMemberNames()
  const [subject, setSubject] = useState('')
  const [busy, setBusy] = useState(false)

  const mayGrant = rfp.ownerId === profile?.id || can.seeEveryone
  const granted = useMemo(() => shares.get(rfp.id) ?? [], [shares, rfp.id])

  /**
   * Members and teams not already on the tender.
   *
   * The owner is filtered out for the obvious reason and the already-shared
   * for a less obvious one: the unique indexes in 0039 refuse a duplicate, so
   * offering one is offering an error.
   */
  const options = useMemo(() => {
    const takenMembers = new Set(granted.map((share) => share.memberId))
    const takenTeams = new Set(granted.map((share) => share.teamId))
    return [
      ...teams
        .filter((team) => !takenTeams.has(team.id))
        .map((team) => ({
          value: `team:${team.id}`,
          label: team.name,
          hint: `${team.memberIds.length} member${team.memberIds.length === 1 ? '' : 's'}`,
        })),
      ...[...memberNames.entries()]
        .filter(([id]) => id !== rfp.ownerId && !takenMembers.has(id))
        .map(([id, name]) => ({ value: `member:${id}`, label: name, hint: '' }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ]
  }, [teams, memberNames, granted, rfp.ownerId])

  async function grant() {
    if (!subject) return
    const [kind, id] = subject.split(':')
    setBusy(true)
    try {
      await shareRfpWith(rfp.id, { kind: kind as 'member' | 'team', id })
      setSubject('')
      toast.success('Access granted — they can now read this tender')
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string, label: string) {
    setBusy(true)
    try {
      await revokeRfpShare(id)
      toast.success(`${label} can no longer see this tender`)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (!mayGrant) return null

  return (
    <Panel
      title="Who can see this"
      description="Sharing gives read access only. Nobody but you can edit this tender, draft against it, or take it on."
      action={<ShareIcon className="size-5 text-clay" />}
    >
      {granted.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Only you{can.seeEveryone ? ' and oversight' : ''} can see this tender.
        </p>
      ) : (
        <ul className="mb-4 flex flex-col gap-1.5">
          {granted.map((share) => {
            const team = share.teamId ? teams.find((t) => t.id === share.teamId) : null
            const label = share.teamId
              ? (team?.name ?? 'a team that has since been deleted')
              : (memberNames.get(share.memberId ?? '') ?? 'another member')
            return (
              <li
                key={share.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border-soft px-3 py-2"
              >
                <span className="flex items-center gap-2 text-xs text-foreground">
                  {share.teamId && <UsersIcon className="size-3.5 text-faint" />}
                  {label}
                  {team && (
                    <span className="text-[11px] text-muted-foreground">
                      · {team.memberIds.length} member
                      {team.memberIds.length === 1 ? '' : 's'}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => void revoke(share.id, label)}
                  disabled={busy}
                  aria-label={`Withdraw access for ${label}`}
                  className="cursor-pointer rounded p-1 text-faint transition-colors hover:text-danger disabled:opacity-50"
                >
                  <XIcon className="size-3.5" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {options.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {/* The picker can clear itself, which arrives as null; the empty
              string is what "nothing chosen" means to the Share button. */}
          <Select<string> value={subject} onValueChange={(next) => setSubject(next ?? '')}>
            <SelectTrigger
              aria-label="Choose a member or team to share with"
              disabled={busy}
              className="w-[260px] max-w-full justify-between"
            >
              <span className={subject ? undefined : 'text-faint'}>
                {options.find((option) => option.value === subject)?.label ??
                  'Choose a member or team'}
              </span>
              <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} className="min-w-[260px]">
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="flex items-center gap-2">
                    {option.value.startsWith('team:') && (
                      <UsersIcon className="size-3.5 text-faint" />
                    )}
                    {option.label}
                    {option.hint && (
                      <span className="text-[11px] text-muted-foreground">
                        · {option.hint}
                      </span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => void grant()} disabled={!subject || busy}>
            Share
          </Button>
        </div>
      )}
    </Panel>
  )
}
