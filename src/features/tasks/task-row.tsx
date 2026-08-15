import { XIcon } from 'lucide-react'
import { Checkbox } from '@/shared/ui/checkbox'
import { formatDate } from '@/domain/dates'
import { cn } from '@/shared/utils'
import type { Lead, Task } from '@/domain/types'

export function TaskRow({
  task,
  lead,
  overdue,
  onToggle,
  onDelete,
}: {
  task: Task
  lead?: Lead
  overdue?: boolean
  onToggle: (id: string, done: boolean) => void
  onDelete?: (id: string) => void
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border-soft px-1 py-2 last:border-b-0">
      <Checkbox
        checked={task.done}
        onCheckedChange={(checked) => onToggle(task.id, checked === true)}
        aria-label={task.done ? `Reopen: ${task.text}` : `Complete: ${task.text}`}
      />
      <span
        className={cn(
          'flex-1 text-[12.5px]',
          task.done && 'text-faint line-through',
        )}
      >
        {task.text}
        {lead && <span className="text-faint"> — {lead.org}</span>}
        {task.priority === 'High' && !task.done && (
          <span className="ml-1.5 rounded-full bg-warning-soft px-1.5 py-px text-[10px] text-warning">
            High
          </span>
        )}
      </span>
      <span
        className={cn(
          'text-[11px] text-muted-foreground',
          overdue && 'text-danger',
        )}
      >
        {task.due ? formatDate(task.due) : ''}
      </span>
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(task.id)}
          aria-label={`Delete task: ${task.text}`}
          className="cursor-pointer px-1 text-faint transition-colors hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  )
}
