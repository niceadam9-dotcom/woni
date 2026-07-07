'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission, requireRole } from '@/lib/auth'

export type WorkTaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
export type WorkTaskPriority = 'high' | 'medium' | 'low'

export type CreateWorkTaskInput = {
  title: string
  description?: string
  assignee_id?: string
  due_date?: string
  priority: WorkTaskPriority
}

export async function createWorkTaskAction(input: CreateWorkTaskInput): Promise<{ error?: string; taskId?: string }> {
  const profile = await requirePermission('task_manage')
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('work_tasks')
    .insert({
      title: input.title,
      description: input.description || null,
      assignee_id: input.assignee_id || null,
      due_date: input.due_date || null,
      priority: input.priority,
      status: 'pending',
      created_by: profile.id,
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/tasks')
  return { taskId: (data as { id: string }).id }
}

export async function updateWorkTaskStatusAction(id: string, status: WorkTaskStatus): Promise<{ error?: string }> {
  await requireRole(['employee', 'manager', 'admin'])
  const admin = createAdminClient()

  const { error } = await admin
    .from('work_tasks')
    .update({ status, updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/tasks')
  return {}
}

// 업무일지
export type CreateWorkJournalInput = {
  work_date: string
  title: string
  content: string
  work_hours?: number
}

export async function createWorkJournalAction(input: CreateWorkJournalInput): Promise<{ error?: string; journalId?: string }> {
  const profile = await requireRole(['employee', 'manager', 'admin'])
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('work_journals')
    .insert({
      work_date: input.work_date,
      title: input.title,
      content: input.content,
      work_hours: input.work_hours ?? null,
      author_id: profile.id,
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/tasks/journal')
  return { journalId: (data as { id: string }).id }
}
