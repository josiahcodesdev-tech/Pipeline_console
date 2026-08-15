import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CopyIcon, KeyRoundIcon, ShieldCheckIcon, TargetIcon, Trash2Icon, UserPlusIcon, UsersIcon } from 'lucide-react'
import { EmptyState, Panel, ViewHeader } from '@/shared/components/panel'
import { Button } from '@/shared/ui/button'
import { KpiCard } from '@/shared/components/kpi-card'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table'
import { useAuth } from '@/shared/hooks/use-auth'
import { createMember, fetchMembers, setMemberActive, setMemberRole, resetMemberPassword, removeMember, fetchTeamOverview, fetchTeamPipeline, type CreatedMember, type TeamOverview, type TeamPipelineItem } from '@/data/members'
import { useMemberNames } from '@/shared/hooks/use-member-names'
import {
  MEMBER_ROLES,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  type MemberRole,
  type Profile,
} from '@/domain/types'
import { formatDate } from '@/domain/dates'
import { cn } from '@/shared/utils'

const ROLE_TONE: Record<MemberRole, string> = {
  super_user: 'border-primary/40 bg-brand-soft text-primary',
  admin: 'border-gold/50 bg-gold-soft text-clay',
  user: 'border-border bg-surface-2 text-muted-foreground',
}

function RoleBadge({ role }: { role: MemberRole }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        ROLE_TONE[role],
      )}
    >
      {ROLE_LABEL[role]}
    </span>
  )
}

/**
 * The one-time password panel.
 *
 * Shown after an account is created and never again — the console does not
 * store it, and the server generated it precisely so nobody had to invent one.
 * It stays on screen until dismissed rather than becoming a toast, because a
 * password that vanishes after four seconds is a password nobody wrote down.
 */
function FirstPassword({
  member,
  reset,
  onDone,
}: {
  member: CreatedMember
  /** True when this replaced an existing password rather than issued a first one. */
  reset?: boolean
  onDone: () => void
}) {
  return (
    <div className="mb-5 rounded-xl border border-gold/50 bg-gold-soft/40 p-4">
      <div className="eyebrow mb-1 text-clay">
        {reset ? 'Password reset' : 'Account created'}
      </div>
      <p className="text-xs leading-relaxed text-foreground">
        Send <strong>{member.email}</strong> this{' '}
        {reset ? 'new password — their old one no longer works' : 'first password'}
        . It is shown once and is not stored anywhere; if it is lost, reset it
        again. Ask them to change it after signing in.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 rounded-lg border border-border bg-card px-3 py-2 font-mono text-[13px] text-foreground">
          {member.password}
        </code>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(member.password)
            toast.success('Password copied')
          }}
        >
          <CopyIcon className="size-3.5" aria-hidden />
          Copy
        </Button>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}

export function MembersView() {
  const { profile, can } = useAuth()
  const [members, setMembers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<CreatedMember | null>(null)
  // Whether the panel above is showing a reset rather than a new account.
  const [wasReset, setWasReset] = useState(false)
  const [overview, setOverview] = useState<TeamOverview | null>(null)
  const [pipeline, setPipeline] = useState<TeamPipelineItem[]>([])
  const names = useMemberNames()

  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<MemberRole>('user')

  const load = useCallback(async () => {
    try {
      setMembers(await fetchMembers())
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  // The firm-wide half of the page, loaded separately. A standard user is
  // refused both of these by the server, so they are only asked for when the
  // reader is entitled to them — and a failure costs the two oversight panels,
  // not the member list above them.
  const loadOverview = useCallback(async () => {
    if (!can.seeEveryone) return
    try {
      const [figures, live] = await Promise.all([
        fetchTeamOverview(),
        fetchTeamPipeline(),
      ])
      setOverview(figures)
      setPipeline(live)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }, [can.seeEveryone])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  useEffect(() => {
    void load()
  }, [load])

  async function add(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const member = await createMember({ email, fullName, role })
      setWasReset(false)
      setCreated(member)
      setEmail('')
      setFullName('')
      setRole('user')
      await load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function changeRole(member: Profile, next: MemberRole) {
    try {
      await setMemberRole(member.id, next)
      toast.success(`${member.email} is now ${ROLE_LABEL[next].toLowerCase()}`)
      await load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  /**
   * Issues a member a new one-time password.
   *
   * Confirmed first because it invalidates the one they have: doing this to
   * someone mid-bid locks them out until the new password reaches them, and
   * the old one is gone whether or not that goes smoothly.
   */
  async function resetPassword(member: Profile) {
    const ok = window.confirm(
      `Issue ${member.email} a new password?\n\nTheir current password stops working immediately, and the new one is shown once — you will need to pass it on.`,
    )
    if (!ok) return
    try {
      const result = await resetMemberPassword(member.id)
      // Reuses the panel that shows a new account's first password: same thing
      // to do with it, so it should look the same and behave the same.
      setWasReset(true)
      setCreated({ id: member.id, email: result.email || member.email, role: member.role, password: result.password })
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function changeActive(member: Profile, next: boolean) {
    try {
      await setMemberActive(member.id, next)
      toast.success(next ? `${member.email} can sign in` : `${member.email} switched off`)
      await load()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  /**
   * Deletes the account and everything it owns.
   *
   * Confirmed twice, and the second one has to be typed. Every table cascades
   * on `user_id`, so this takes the member's leads, RFPs, activities, drafts
   * and consultants with it — including any tender they had taken on, which
   * simply disappears from the firm's pipeline. "Switch off" is what people
   * usually mean by removing someone, so it is offered first and this is the
   * deliberate other thing.
   */
  async function remove(member: Profile) {
    const owned = pipeline.filter((item) => item.ownerId === member.id).length
    const warning = owned > 0
      ? `\n\n${owned} proposal${owned === 1 ? '' : 's'} in the firm's pipeline belong${owned === 1 ? 's' : ''} to them and will be deleted with the account.`
      : ''

    const ok = window.confirm(
      `Permanently remove ${member.email}?\n\nThis deletes their account and everything they own — leads, RFPs, activities, proposals and consultants. It cannot be undone.${warning}\n\nTo keep their work, cancel and use “Switch off” instead.`,
    )
    if (!ok) return

    // Typed, not clicked. A second window.confirm is one more Enter keypress
    // away from the first, and this is the one action on the page with nothing
    // behind it.
    const typed = window.prompt(
      `Type REMOVE to confirm deleting ${member.email} and all of their work.`,
    )
    if (typed?.trim().toUpperCase() !== 'REMOVE') {
      toast.message('Nothing removed.')
      return
    }

    try {
      await removeMember(member.id)
      toast.success(`${member.email} removed`)
      await Promise.all([load(), loadOverview()])
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const counts = MEMBER_ROLES.map((r) => ({
    role: r,
    count: members.filter((m) => m.role === r && m.active).length,
  }))

  return (
    <>
      <ViewHeader
        eyebrow="Access"
        title="Members"
        description="Who can sign in, and what each of them is allowed to do."
        meta={
          <div className="flex items-center gap-2">
            {counts.map(({ role: r, count }) => (
              <span
                key={r}
                className="rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground shadow-brand-sm"
              >
                {count} {ROLE_LABEL[r].toLowerCase()}
                {count === 1 ? '' : 's'}
              </span>
            ))}
          </div>
        }
      />

      {created && (
        <FirstPassword
          member={created}
          reset={wasReset}
          onDone={() => setCreated(null)}
        />
      )}

      {can.manageMembers && (
        <Panel
          title="Add a member"
          description="Creates the account immediately and returns a first password to pass on. There is no sign-up page — this is the only way in."
        >
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_1fr_180px_auto] sm:items-end">
            <div>
              <Label htmlFor="m-email" className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted-foreground">
                Email
              </Label>
              <Input
                id="m-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@vantageafricaleaders.com"
              />
            </div>
            <div>
              <Label htmlFor="m-name" className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted-foreground">
                Full name
              </Label>
              <Input
                id="m-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div>
              <Label htmlFor="m-role" className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted-foreground">
                Access
              </Label>
              <select
                id="m-role"
                value={role}
                onChange={(e) => setRole(e.target.value as MemberRole)}
                className="h-9 w-full cursor-pointer rounded-md border border-border bg-card px-2 text-xs text-foreground"
              >
                {MEMBER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" disabled={busy}>
              <UserPlusIcon className="size-3.5" aria-hidden />
              {busy ? 'Adding…' : 'Add'}
            </Button>
          </form>

          <p className="mt-3 text-[11px] leading-relaxed text-faint">
            {ROLE_DESCRIPTION[role]}
          </p>
        </Panel>
      )}

      {can.seeEveryone && (
        <Panel
          title="Across the team"
          description="Counted once per tender, not once per member. Every member holds their own copy of each scraped opportunity, so adding up what their dashboards show would count the same tender several times over — and the total would grow every time you hire."
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Open tenders"
              value={overview?.openTenders ?? '—'}
              hint="Distinct opportunities still accepting bids"
            />
            <KpiCard
              label="Being bid"
              value={overview?.inPipeline ?? '—'}
              hint="Taken on by someone, one member each"
              tone={overview && overview.inPipeline > 0 ? 'good' : 'neutral'}
            />
            <KpiCard
              label="Nobody on it"
              value={overview?.unclaimedOpen ?? '—'}
              hint="Open, and no one has taken it"
              tone={overview && overview.unclaimedOpen > 0 ? 'warn' : 'good'}
            />
            <KpiCard
              label="Tenders held"
              value={overview?.allTenders ?? '—'}
              hint="Everything scraped, open and closed"
            />
          </div>
        </Panel>
      )}

      {can.seeEveryone && (
        <Panel
          title="Who is bidding what"
          description="Every tender the firm currently has in a pipeline, and the member on it. One member per tender — taking one on locks it."
        >
          {pipeline.length === 0 ? (
            <EmptyState
              icon={<TargetIcon className="size-5" />}
              hint="A tender appears here as soon as someone adds it to their pipeline."
            >
              Nothing is being bid yet
            </EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tender</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>On it</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Deadline</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pipeline.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-[380px] font-medium">{item.title}</TableCell>
                    <TableCell className="text-muted-foreground">{item.org || '—'}</TableCell>
                    <TableCell>
                      <span className="whitespace-nowrap rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-primary">
                        {names.get(item.ownerId) ?? 'Unknown member'}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{item.status}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(item.deadline) || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      )}

      <Panel title="Team">
        {loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
        ) : members.length === 0 ? (
          <EmptyState icon={<UsersIcon className="size-5" />} hint="Members you add appear here.">
            No members yet
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Added</TableHead>
                {can.manageMembers && <TableHead className="text-right">Change</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => {
                const isSelf = member.id === profile?.id
                return (
                  <TableRow key={member.id} className={cn(!member.active && 'opacity-55')}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium text-foreground">
                          {member.fullName || member.email}
                          {isSelf && <span className="ml-1.5 text-[11px] text-faint">(you)</span>}
                        </span>
                        {member.fullName && (
                          <span className="text-[11px] text-muted-foreground">{member.email}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <RoleBadge role={member.role} />
                        {!member.active && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-danger">
                            No access
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(member.createdAt.slice(0, 10)) || '—'}
                    </TableCell>
                    {can.manageMembers && (
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isSelf ? (
                            // Role and access are guarded on the server too:
                            // the last super user demoting themselves leaves
                            // nobody able to put it back without opening the
                            // database. Resetting your own password is the
                            // opposite — it is the way back in, not a way out.
                            <span className="text-[11px] text-faint">Your account</span>
                          ) : (
                            <>
                              <select
                                value={member.role}
                                onChange={(e) => void changeRole(member, e.target.value as MemberRole)}
                                aria-label={`Access level for ${member.email}`}
                                className="h-8 cursor-pointer rounded-md border border-border bg-card px-2 text-[11px] text-foreground"
                              >
                                {MEMBER_ROLES.map((r) => (
                                  <option key={r} value={r}>
                                    {ROLE_LABEL[r]}
                                  </option>
                                ))}
                              </select>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => void changeActive(member, !member.active)}
                              >
                                {member.active ? 'Switch off' : 'Restore'}
                              </Button>
                            </>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            title={`Issue ${member.email} a new one-time password`}
                            onClick={() => void resetPassword(member)}
                          >
                            <KeyRoundIcon className="size-3.5" aria-hidden />
                            Reset password
                          </Button>
                          {/* Last, and the only destructive control here, so it
                              is set apart rather than sitting in the same row of
                              outline buttons as "Switch off" — which is the one
                              people actually want most of the time. */}
                          {!isSelf && (
                            <button
                              type="button"
                              title={`Permanently remove ${member.email} and everything they own`}
                              aria-label={`Permanently remove ${member.email}`}
                              onClick={() => void remove(member)}
                              className="ml-1 grid size-8 cursor-pointer place-items-center rounded-md border border-transparent text-faint transition-colors hover:border-danger/40 hover:bg-danger-soft hover:text-danger"
                            >
                              <Trash2Icon className="size-3.5" aria-hidden />
                            </button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Panel>

      <Panel title="What each level can do">
        <ul className="flex flex-col gap-2.5">
          {MEMBER_ROLES.map((r) => (
            <li key={r} className="flex gap-3">
              <span className="mt-0.5 shrink-0">
                <RoleBadge role={r} />
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {ROLE_DESCRIPTION[r]}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 flex items-start gap-2 border-t border-border-soft pt-3 text-[11px] leading-relaxed text-faint">
          <ShieldCheckIcon className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            Every one of these rules is enforced by the database, not by this
            page. Hiding a button is a courtesy; the refusal behind it is the
            protection.
          </span>
        </p>
      </Panel>
    </>
  )
}
