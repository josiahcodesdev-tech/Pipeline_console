import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/use-auth'
import { toSignInEmail } from '@/lib/usernames'

/**
 * Sign in only.
 *
 * This screen used to offer "No account yet? Create one", which meant anyone
 * who found the URL could give themselves an account on a console holding a
 * live bid pipeline. Members are added by the super user on the Members page
 * instead, which is also the only way an account arrives with a role attached.
 */
export function SignInView() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      // "admin" and "admin@vantageafricaleaders.com" are the same account.
      // Supabase has no username concept, so the short form is completed with
      // the organisation's domain before it goes anywhere near the API.
      await signIn(toSignInEmail(email), password)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-[380px]">
        <div className="mb-7 flex flex-col items-center text-center">
          <span
            aria-hidden
            className="mb-4 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-clay to-primary font-display text-[15px] text-white shadow-brand-md"
          >
            JM
          </span>
          <div className="eyebrow mb-2 text-clay">Corporate Dept · BDE</div>
          <h1 className="font-display text-[30px] leading-tight text-foreground">
            Pipeline Console
          </h1>
          <p className="mt-2 text-xs text-muted-foreground">
            Lead generation &amp; RFP tracking
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="gold-edge rounded-lg border border-border bg-card p-6 pt-7 shadow-brand-md"
        >
          <div className="mb-3">
            <Label htmlFor="email" className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted-foreground">
              Username or email
            </Label>
            {/* Not type="email": the field now accepts a bare username, and the
                browser's own validation would reject "admin" before the form
                ever ran. */}
            <Input
              id="email"
              type="text"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full"
            />
          </div>

          <div className="mb-4">
            <Label htmlFor="password" className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted-foreground">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full"
            />
          </div>

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>

          <p className="mt-3 text-center text-[11px] leading-relaxed text-faint">
            Accounts are issued by your administrator. Ask them to add you if you
            do not have one.
          </p>
        </form>
      </div>
    </div>
  )
}
