import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Field } from '@/components/field'
import { usePipeline } from '@/hooks/use-pipeline'
import { fetchMembers } from '@/lib/members'
import { toDisplayName } from '@/lib/usernames'
import type { Profile, Rfp } from '@/lib/types'

/**
 * Hands a tender to another member.
 *
 * Spells out what moves before it moves. Reassignment takes the proposals, the
 * logged activity and the firm-wide claim with it — that is the point, since a
 * bid whose drafts stayed behind is a bid the new owner cannot read — but it is
 * not what "reassign" obviously implies, and nobody should discover it
 * afterwards.
 */
export function ReassignDialog({
  rfp,
  currentOwner,
  open,
  onOpenChange,
}: {
  rfp: Rfp
  /** Display name of who holds it now, for the sentence. */
  currentOwner: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { reassignRfp } = usePipeline()
  const [members, setMembers] = useState<Profile[]>([])
  const [chosen, setChosen] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setChosen('')
    let live = true
    void fetchMembers()
      .then((list) => {
        // Switched-off accounts are excluded here and refused by the function
        // too — handing a live bid to somebody who cannot sign in loses it.
        if (live) setMembers(list.filter((m) => m.active && m.id !== rfp.ownerId))
      })
      .catch((cause) => toast.error(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      live = false
    }
  }, [open, rfp.ownerId])

  async function submit() {
    if (!chosen || busy) return
    const to = members.find((m) => m.id === chosen)
    const name = to?.fullName || (to ? toDisplayName(to.email) : 'that member')

    const ok = window.confirm(
      `Hand "${rfp.title.slice(0, 80)}" to ${name}?\n\nThe tender, every proposal drafted for it, everything logged against it and the claim on it all move across. ${currentOwner} loses access to the lot.`,
    )
    if (!ok) return

    setBusy(true)
    try {
      await reassignRfp(rfp.id, chosen)
      toast.success(`Reassigned to ${name}`)
      onOpenChange(false)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Reassign this tender</DialogTitle>
          <DialogDescription>
            Held by {currentOwner}. Moving it takes the proposals, the logged
            activity and the claim with it, so the new owner picks up a whole bid
            rather than an empty record.
          </DialogDescription>
        </DialogHeader>

        <Field label="Hand it to" htmlFor="reassign-to">
          <Select<string> value={chosen} onValueChange={(next) => setChosen(next ?? '')}>
            <SelectTrigger id="reassign-to" className="w-full">
              <SelectValue placeholder="Choose a member" />
            </SelectTrigger>
            <SelectContent>
              {members.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.fullName || toDisplayName(member.email)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {members.length === 0 && (
          <p className="text-[11.5px] text-muted-foreground">
            No other member has access at the moment.
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!chosen || busy} onClick={() => void submit()}>
            {busy ? 'Reassigning…' : 'Reassign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
