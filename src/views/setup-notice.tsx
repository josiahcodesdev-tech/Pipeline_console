/**
 * Shown instead of the login form when the Supabase env vars are missing —
 * a wall of failed network requests is a poor way to learn about a typo in
 * `.env.local`.
 */
export function SetupNotice() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-[520px] rounded-lg border border-border bg-card p-6">
        <h1 className="font-display text-lg font-semibold">Finish the setup</h1>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Pipeline Console needs a Supabase project before it can store anything.
          Create <code className="text-primary">.env.local</code> in the project
          root with:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 text-[11px] leading-relaxed text-muted-foreground">
{`VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key`}
        </pre>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Both values are in your Supabase dashboard under{' '}
          <span className="text-foreground">Project Settings → API</span>. Run the
          SQL in{' '}
          <code className="text-primary">supabase/migrations/0001_init.sql</code>{' '}
          against the project, then restart{' '}
          <code className="text-primary">npm run dev</code>.
        </p>
      </div>
    </div>
  )
}
