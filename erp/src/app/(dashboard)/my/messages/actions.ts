'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function sendMessageAction(input: {
  recipientId: string
  subject: string
  body: string
}): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '인증이 필요합니다.' }

  const { error } = await supabase.from('messages').insert({
    sender_id:    user.id,
    recipient_id: input.recipientId,
    subject:      input.subject,
    body:         input.body,
  })

  if (error) return { error: '쪽지 발송에 실패했습니다.' }
  revalidatePath('/my/messages')
  return {}
}

export async function markReadAction(messageId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '인증이 필요합니다.' }

  const { error } = await supabase
    .from('messages')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', messageId)
    .eq('recipient_id', user.id)

  if (error) return { error: '읽음 처리에 실패했습니다.' }
  revalidatePath('/my/messages')
  return {}
}

export async function deleteMessageAction(
  messageId: string,
  role: 'sender' | 'recipient'
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '인증이 필요합니다.' }

  const field = role === 'sender' ? 'is_deleted_by_sender' : 'is_deleted_by_recipient'
  const filter = role === 'sender' ? { sender_id: user.id } : { recipient_id: user.id }

  const { error } = await supabase
    .from('messages')
    .update({ [field]: true })
    .eq('id', messageId)
    .eq(Object.keys(filter)[0], Object.values(filter)[0])

  if (error) return { error: '삭제에 실패했습니다.' }
  revalidatePath('/my/messages')
  return {}
}
