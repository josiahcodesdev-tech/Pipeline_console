import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { Field, FieldRow, SelectField } from '@/shared/components/field'
import type { TaskDraft } from '@/data/tasks'
import { today } from '@/domain/dates'
import { TASK_PRIORITIES, type Lead } from '@/domain/types'

const NO_LEAD = 'none'

export function TaskDialog({
  open,
  onOpenChange,
  leads,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  leads: Lead[]
  onAdd: (draft: TaskDraft) => Promise<void>
}) {
  const [draft, setDraft] = useState<TaskDraft>({
    text: '',
    due: today(),
    priority: 'Normal',
    linkedLead: null,
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setDraft({ text: '', due: today(), priority: 'Normal', linkedLead: null })
    }
  }, [open])

  async function handleAdd() {
    if (!draft.text.trim()) {
      toast.error('Task text is required')
      return
    }
    setBusy(true)
    try {
      await onAdd({ ...draft, text: draft.text.trim() })
      onOpenChange(false)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="font-display">Add task</DialogTitle>
        </DialogHeader>

        <div>
          <Field label="Task" htmlFor="task-text">
            <Input
              id="task-text"
              placeholder="e.g. Follow up with Ministry of Agriculture"
              value={draft.text}
              onChange={(event) =>
                setDraft((current) => ({ ...current, text: event.target.value }))
              }
              className="w-full"
            />
          </Field>

          <FieldRow>
            <Field label="Due date" htmlFor="task-due">
              <Input
                id="task-due"
                type="date"
                value={draft.due}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, due: event.target.value }))
                }
                className="w-full"
              />
            </Field>
            <SelectField
              label="Priority"
              value={draft.priority}
              options={TASK_PRIORITIES}
              onChange={(value) =>
                setDraft((current) => ({ ...current, priority: value }))
              }
            />
          </FieldRow>

          <Field label="Linked lead (optional)" htmlFor="task-lead">
            <Select
              value={draft.linkedLead ?? NO_LEAD}
              onValueChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  linkedLead: value === NO_LEAD ? null : String(value),
                }))
              }
            >
              <SelectTrigger id="task-lead" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_LEAD}>None</SelectItem>
                {leads.map((lead) => (
                  <SelectItem key={lead.id} value={lead.id}>
                    {lead.org}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleAdd()} disabled={busy}>
            Add task
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
