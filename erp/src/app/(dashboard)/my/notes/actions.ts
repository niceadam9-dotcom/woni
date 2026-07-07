'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/auth'

export async function createNoteAction(input: { title: string; content: string; color?: string }): Promise<{ error?: string; noteId?: string }> {
  const profile = await requireRole(['employee', 'manager', 'admin'])
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('my_notes')
    .insert({
      owner_id: profile.id,
      title: input.title,
      content: input.content,
      color: input.color || 'white',
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/my/notes')
  return { noteId: (data as { id: string }).id }
}

export async function updateNoteAction(id: string, input: { title?: string; content?: string; color?: string }): Promise<{ error?: string }> {
  await requireRole(['employee', 'manager', 'admin'])
  const admin = createAdminClient()

  const { error } = await admin
    .from('my_notes')
    .update({ ...input, updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/my/notes')
  return {}
}

export async function deleteNoteAction(id: string): Promise<{ error?: string }> {
  await requireRole(['employee', 'manager', 'admin'])
  const admin = createAdminClient()

  const { error } = await admin.from('my_notes').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/my/notes')
  return {}
}
