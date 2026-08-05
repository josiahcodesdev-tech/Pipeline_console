import { useState, type FormEvent } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { changeOwnPassword } from '@/lib/members'

/**
 * Where a member changes their own password.
 *
 * Reached from the sidebar so it is available on every page and to every role
 * — the Members page is oversight and standard users cannot open it, which
 * would have left six of eight people with no way to change their own
 * credentials.
 *
 * Asks for the current password even though Supabase does not require it. See
 * `changeOwnPassword` for why: without that check, an unlocked laptop is an
 * account taken over rather than merely used.
 */
export function ChangePasswordDialog({
  email,
  open,
  onOpenChange,
}: {
  email: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  function reset() {
    setCurrent('')
    setNext('')
    setConfirm('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return

    // Checked here rather than server-side because it is a typo, not a policy:
    // the server has no way to know what the member meant to type twice.
    if (next !== confirm) {
      toast.error('The two new passwords do not match.')
      return
    }

    setBusy(true)
    try {
      await changeOwnPassword(email, current, next)
      toast.success('Password changed. It applies the next time you sign in.')
      reset()
      onOpenChange(false)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        // Never leave a typed password sitting in state behind a closed dialog.
        if (!value) reset()
        onOpenChange(value)
      }}
    >
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="font-display">Change your password</DialogTitle>
          <DialogDescription>
            For {email}. If you have forgotten your current one, ask the super
            user to issue you a new password instead.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-3">
          <div>
            <Label
              htmlFor="pw-current"
              className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted-foreground"
            >
              Current password
            </Label>
            <Input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </div>

          <div>
            <Label
              htmlFor="pw-next"
              className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted-foreground"
            >
              New password
            </Label>
            <Input
              id="pw-next"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
            <p className="mt-1 text-[11px] text-faint">At least 8 characters.</p>
          </div>

          <div>
            <Label
              htmlFor="pw-confirm"
              className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted-foreground"
            >
              New password again
            </Label>
            <Input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Changing…' : 'Change password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
