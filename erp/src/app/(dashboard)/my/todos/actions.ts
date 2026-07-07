'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function createTodoAction(input: {
  title: string
  description?: string | null
  dueDate?: string | null
  priority: string
}): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '인증이 필요합니다.' }

  const { error } = await supabase.from('todos').insert({
    employee_id: user.id,
    title:       input.title,
    description: input.description ?? null,
    due_date:    input.dueDate ?? null,
    priority:    input.priority,
    completed:   false,
  })

  if (error) return { error: 'ToDo 등록에 실패했습니다.' }
  revalidatePath('/my/todos')
  return {}
}

export async function toggleTodoAction(id: string, completed: boolean): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '인증이 필요합니다.' }

  const { error } = await supabase
    .from('todos')
    .update({
      completed,
      completed_at: completed ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .eq('employee_id', user.id)

  if (error) return { error: '상태 변경에 실패했습니다.' }
  revalidatePath('/my/todos')
  return {}
}

export async function updateTodoAction(input: {
  id: string
  title: string
  description?: string | null
  dueDate?: string | null
  priority: string
}): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '인증이 필요합니다.' }

  const { error } = await supabase
    .from('todos')
    .update({
      title:       input.title,
      description: input.description ?? null,
      due_date:    input.dueDate ?? null,
      priority:    input.priority,
    })
    .eq('id', input.id)
    .eq('employee_id', user.id)

  if (error) return { error: '수정에 실패했습니다.' }
  revalidatePath('/my/todos')
  return {}
}

export async function deleteTodoAction(id: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '인증이 필요합니다.' }

  const { error } = await supabase
    .from('todos')
    .delete()
    .eq('id', id)
    .eq('employee_id', user.id)

  if (error) return { error: '삭제에 실패했습니다.' }
  revalidatePath('/my/todos')
  return {}
}
