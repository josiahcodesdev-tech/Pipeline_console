import { useCallback, useEffect, useState } from 'react'
import { ArchiveRestoreIcon, HistoryIcon } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/data/client'
import { restoreProposal } from '@/data/proposals'
import { usePipeline } from '@/shared/hooks/use-pipeline'
import { Button } from '@/shared/ui/button'
import { useMemberNames } from '@/shared/hooks/use-member-names'

type AuditRow = {
  id: number
  table_name: string
  action: string
  changed_fields: string[]
  created_at: string
  actor_id: string | null
}
type ArchivedRow = { id: string; title: string; version_no: number; archived_at: string }

export function RecordsView() {
  const { refresh } = usePipeline()
  const memberNames = useMemberNames()
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [archive, setArchive] = useState<ArchivedRow[]>([])

  const load = useCallback(async () => {
    const [a, p] = await Promise.all([
      supabase.from('audit_log').select('id, table_name, action, changed_fields, created_at, actor_id').order('created_at', { ascending: false }).limit(200),
      supabase.from('proposals').select('id, title, version_no, archived_at').not('archived_at', 'is', null).order('archived_at', { ascending: false }),
    ])
    if (a.error) throw new Error(a.error.message)
    if (p.error) throw new Error(p.error.message)
    setAudit((a.data ?? []) as AuditRow[])
    setArchive((p.data ?? []) as ArchivedRow[])
  }, [])

  useEffect(() => { void load().catch((error) => toast.error(error.message)) }, [load])

  async function restore(row: ArchivedRow) {
    await restoreProposal(row.id)
    await Promise.all([load(), refresh()])
    toast.success(`Restored ${row.title}`)
  }

  return (
    <div className="space-y-8 py-8">
      <header><h1 className="font-display text-2xl">Records</h1><p className="mt-1 text-xs text-muted-foreground">Recover deleted proposal versions for 30 days and review the durable change trail.</p></header>
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 font-display text-lg"><ArchiveRestoreIcon className="size-4" /> Recycle bin</h2>
        <div className="mt-4 space-y-2">
          {archive.length === 0 ? <p className="text-xs text-muted-foreground">No deleted proposal versions.</p> : archive.map((row) => {
            const expires = new Date(new Date(row.archived_at).getTime() + 30 * 86_400_000)
            return <div key={row.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs"><span>{row.title} · Version {row.version_no}<span className="ml-2 text-muted-foreground">kept until {expires.toLocaleDateString('en-GB')}</span></span><Button size="sm" variant="outline" onClick={() => void restore(row)}>Restore</Button></div>
          })}
        </div>
      </section>
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 font-display text-lg"><HistoryIcon className="size-4" /> Audit trail</h2>
        <p className="mt-1 text-xs text-muted-foreground">Latest 200 changes. This list is suitable for a daily review and includes oversight actions.</p>
        <div className="mt-4 divide-y divide-border">
          {audit.map((row) => <div key={row.id} className="grid gap-1 py-2 text-xs sm:grid-cols-[160px_140px_100px_100px_1fr]"><span>{new Date(row.created_at).toLocaleString('en-GB')}</span><span>{row.actor_id ? (memberNames.get(row.actor_id) ?? 'Unknown member') : 'System'}</span><span>{row.table_name}</span><span className="capitalize">{row.action}</span><span className="text-muted-foreground">{row.changed_fields.join(', ') || 'whole record'}</span></div>)}
          {audit.length === 0 && <p className="py-2 text-xs text-muted-foreground">No recorded changes yet.</p>}
        </div>
      </section>
    </div>
  )
}
