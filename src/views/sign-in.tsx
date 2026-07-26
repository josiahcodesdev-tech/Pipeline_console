import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/use-auth'

export function SignInView() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      if (mode === 'sign-in') {
        await signIn(email, password)
      } else {
        await signUp(email, password)
        toast.success(
          'Account created. If your project requires email confirmation, check your inbox.',
        )
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-[380px]">
        <div className="mb-6">
          <div className="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-faint">
            Corporate Dept · BDE
          </div>
          <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight">
            Pipeline Console
          </h1>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Lead generation &amp; RFP tracking
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-border bg-card p-5"
        >
          <div className="mb-3">
            <Label htmlFor="email" className="mb-1.5 block text-[11px] uppercase tracking-wider text-muted-foreground">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
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
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full"
            />
          </div>

          <Button type="submit" disabled={busy} className="w-full">
            {busy
              ? 'Working…'
              : mode === 'sign-in'
                ? 'Sign in'
                : 'Create account'}
          </Button>

          <button
            type="button"
            onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
            className="mt-3 w-full cursor-pointer text-center text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {mode === 'sign-in'
              ? 'No account yet? Create one'
              : 'Already have an account? Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
