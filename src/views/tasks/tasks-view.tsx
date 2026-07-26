import { useMemo, useState } from 'react'
import { ListChecksIcon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState, Panel, ViewHeader } from '@/components/panel'
import { usePipeline } from '@/hooks/use-pipeline'
import { today } from '@/lib/dates'
import type { Lead, Task } from '@/lib/types'
import { TaskRow } from './task-row'
import { TaskDialog } from './task-dialog'

interface Group {
  label: string
  tasks: Task[]
  overdue?: boolean
}

export function TasksView() {
  const { tasks, leads, addTask, toggleTask, removeTask } = usePipeline()
  const [dialogOpen, setDialogOpen] = useState(false)

  const leadsById = useMemo(() => {
    const map = new Map<string, Lead>()
    for (const lead of leads) map.set(lead.id, lead)
    return map
  }, [leads])

  const groups = useMemo<Group[]>(() => {
    const now = today()
    const open = tasks.filter((task) => !task.done)

    return [
      {
        label: 'Overdue',
        overdue: true,
        tasks: open
          .filter((task) => task.due && task.due < now)
          .sort((a, b) => a.due.localeCompare(b.due)),
      },
      {
        label: 'Due today',
        tasks: open.filter((task) => task.due === now),
      },
      {
        label: 'Upcoming',
        tasks: open
          .filter((task) => task.due && task.due > now)
          .sort((a, b) => a.due.localeCompare(b.due)),
      },
      {
        label: 'No date set',
        tasks: open.filter((task) => !task.due),
      },
      {
        label: 'Recently completed',
        // Capped: the point is a short confirmation of recent work, not an archive.
        tasks: tasks
          .filter((task) => task.done)
          .sort((a, b) => b.completedOn.localeCompare(a.completedOn))
          .slice(0, 15),
      },
    ].filter((group) => group.tasks.length > 0)
  }, [tasks])

  async function handleDelete(id: string) {
    try {
      await removeTask(id)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <>
      <ViewHeader
        eyebrow="Follow-through"
        title="Daily tasks & follow-ups"
        description="The commitments behind the pipeline. Completing these is what the weekly report counts as follow-up discipline."
        action={
          <Button onClick={() => setDialogOpen(true)}>
            <PlusIcon />
            Add task
          </Button>
        }
      />

      <Panel>
        {groups.length === 0 ? (
          <EmptyState
            icon={<ListChecksIcon className="size-5" />}
            hint="Add a follow-up and it lands here, grouped by whether it is overdue, due today, or still ahead."
          >
            No tasks yet
          </EmptyState>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-4 last:mb-0">
              <div className="mb-2 text-[11px] uppercase tracking-wider text-faint">
                {group.label}
              </div>
              {group.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  lead={task.linkedLead ? leadsById.get(task.linkedLead) : undefined}
                  overdue={group.overdue}
                  onToggle={(id, done) => void toggleTask(id, done)}
                  onDelete={(id) => void handleDelete(id)}
                />
              ))}
            </div>
          ))
        )}
      </Panel>

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        leads={leads}
        onAdd={addTask}
      />
    </>
  )
}
