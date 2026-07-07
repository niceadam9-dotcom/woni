'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole, getSessionUser } from '@/lib/auth'

// 게시판 카테고리
export async function createCategoryAction(input: {
  name: string; description?: string; is_notice_board?: boolean
}): Promise<{ error?: string; categoryId?: string }> {
  await requireRole(['admin'])
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('board_categories')
    .insert({
      name: input.name,
      description: input.description || null,
      is_notice_board: input.is_notice_board ?? false,
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/board/categories')
  return { categoryId: (data as { id: string }).id }
}

export async function updateCategoryAction(input: {
  id: string; name: string; description?: string; is_notice_board?: boolean; is_active: boolean
}): Promise<{ error?: string }> {
  await requireRole(['admin'])
  const admin = createAdminClient()

  const { error } = await admin
    .from('board_categories')
    .update({
      name: input.name,
      description: input.description || null,
      is_notice_board: input.is_notice_board ?? false,
      is_active: input.is_active,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', input.id)

  if (error) return { error: error.message }
  revalidatePath('/board/categories')
  return {}
}

// 게시물
export async function createPostAction(input: {
  category_id: string; title: string; content: string; is_notice?: boolean
}): Promise<{ error?: string; postId?: string }> {
  const profile = await requireRole(['employee', 'manager', 'admin'])
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('board_posts')
    .insert({
      category_id: input.category_id,
      title: input.title,
      content: input.content,
      is_notice: input.is_notice ?? false,
      author_id: profile.id,
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/board')
  return { postId: (data as { id: string }).id }
}

export async function updatePostAction(input: {
  id: string; title: string; content: string; is_notice?: boolean
}): Promise<{ error?: string }> {
  await requireRole(['employee', 'manager', 'admin'])
  const admin = createAdminClient()

  const { error } = await admin
    .from('board_posts')
    .update({
      title: input.title,
      content: input.content,
      is_notice: input.is_notice ?? false,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', input.id)

  if (error) return { error: error.message }
  revalidatePath('/board')
  revalidatePath(`/board/${input.id}`)
  return {}
}

export async function deletePostAction(id: string): Promise<{ error?: string }> {
  await requireRole(['manager', 'admin'])
  const admin = createAdminClient()

  const { error } = await admin
    .from('board_posts')
    .update({ is_deleted: true, updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/board')
  return {}
}

// 회의록
export async function createMeetingNoteAction(input: {
  title: string; content: string; meeting_date: string; participants?: string; location?: string
}): Promise<{ error?: string; noteId?: string }> {
  const profile = await requireRole(['employee', 'manager', 'admin'])
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('meeting_notes')
    .insert({
      title: input.title,
      content: input.content,
      meeting_date: input.meeting_date,
      participants: input.participants || null,
      location: input.location || null,
      author_id: profile.id,
    } as Record<string, unknown>)
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/board/meeting-notes')
  return { noteId: (data as { id: string }).id }
}

export async function updateMeetingNoteAction(input: {
  id: string; title: string; content: string; meeting_date: string; participants?: string; location?: string
}): Promise<{ error?: string }> {
  await requireRole(['employee', 'manager', 'admin'])
  const admin = createAdminClient()

  const { error } = await admin
    .from('meeting_notes')
    .update({
      title: input.title,
      content: input.content,
      meeting_date: input.meeting_date,
      participants: input.participants || null,
      location: input.location || null,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>)
    .eq('id', input.id)

  if (error) return { error: error.message }
  revalidatePath('/board/meeting-notes')
  revalidatePath(`/board/meeting-notes/${input.id}`)
  return {}
}
