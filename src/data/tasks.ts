import { supabase } from './client'
import { today } from '@/domain/dates'
import type { Task } from '@/domain/types'
import { unwrap, currentUserId, dateOrNull, type TaskDraft } from './internal'
import { toTask } from './mappers'

export type { TaskDraft }

// --------------------------------------------------------------- tasks -----

export async function createTask(draft: TaskDraft): Promise<Task> {
  const row = unwrap(
    await supabase
      .from('tasks')
      .insert({
        text: draft.text,
        due: dateOrNull(draft.due),
        priority: draft.priority,
        linked_lead: draft.linkedLead,
        user_id: await currentUserId(),
        done: false,
        completed_on: null,
        created_on: today(),
      })
      .select()
      .single(),
  )
  return toTask(row)
}

export async function setTaskDone(id: string, done: boolean): Promise<Task> {
  const row = unwrap(
    await supabase
      .from('tasks')
      .update({ done, completed_on: done ? today() : null })
      .eq('id', id)
      .select()
      .single(),
  )
  return toTask(row)
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
