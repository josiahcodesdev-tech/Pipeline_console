import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  draftConceptNote,
  DRAFT_LABELS,
  type ConceptNoteContext,
} from '@/lib/concept-note'

export function ConceptNoteDialog({
  context,
  open,
  onOpenChange,
}: {
  context: ConceptNoteContext | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    if (!open || !context) return

    let active = true
    setStatus('loading')
    setDraft('')

    draftConceptNote(context)
      .then((text) => {
        if (!active) return
        setDraft(text)
        setStatus('idle')
      })
      .catch((cause: unknown) => {
        if (!active) return
        setDraft(cause instanceof Error ? cause.message : String(cause))
        setStatus('error')
      })

    return () => {
      active = false
    }
    // Deliberately keyed on `open` alone: `context` is a fresh object on every
    // parent render, so including it would redraft on each keystroke behind
    // the dialog. One draft per opening is the intent.
  }, [open])

  const labels = DRAFT_LABELS[context?.kind ?? 'concept-note']

  async function copy() {
    await navigator.clipboard.writeText(draft)
    toast.success(`Copied ${labels.title.toLowerCase()}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="font-display">{labels.title}</DialogTitle>
          <DialogDescription>
            {context
              ? `Addressed to ${context.org}. Review before sending — it is a starting point, not a final document.`
              : null}
          </DialogDescription>
        </DialogHeader>

        {status === 'loading' ? (
          <div className="flex min-h-[320px] items-center justify-center text-xs text-muted-foreground">
            {labels.loading}
          </div>
        ) : (
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-[320px] text-xs leading-relaxed"
            aria-label={labels.title}
          />
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={() => void copy()}
            disabled={status !== 'idle' || !draft}
          >
            Copy
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
