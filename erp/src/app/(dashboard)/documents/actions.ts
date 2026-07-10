'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth, getSessionUser } from '@/lib/auth'
import { notifyIfEnabled } from '@/lib/notify'

export type SaveDraftInput = {
  document_id?: string
  title: string
  template_type: string
  content: string
  approver_ids: string[]
}

export async function saveDraftAction(input: SaveDraftInput): Promise<{ error?: string; documentId?: string }> {
  const user = await getSessionUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인해주세요.' }
  const admin = createAdminClient()

  if (input.document_id) {
    const { data: check } = await admin
      .from('documents')
      .select('author_id, status')
      .eq('id', input.document_id)
      .single()
    const doc = check as { author_id: string; status: string } | null
    if (!doc || doc.author_id !== user.id || doc.status !== 'draft') {
      return { error: '수정 권한이 없습니다.' }
    }

    const { error } = await admin
      .from('documents')
      .update({ title: input.title, template_type: input.template_type, content: input.content } as Record<string, unknown>)
      .eq('id', input.document_id)
    if (error) return { error: '임시저장 실패' }

    await admin.from('document_approvers').delete().eq('document_id', input.document_id)
  }

  let docId = input.document_id

  if (!docId) {
    const { data, error } = await admin
      .from('documents')
      .insert({
        title: input.title,
        template_type: input.template_type,
        content: input.content,
        author_id: user.id,
        status: 'draft',
      } as Record<string, unknown>)
      .select('id')
      .single()
    if (error || !data) return { error: '문서 생성 실패' }
    docId = (data as { id: string }).id
  }

  if (input.approver_ids.length > 0) {
    await admin.from('document_approvers').insert(
      input.approver_ids.map((id, i) => ({
        document_id: docId,
        approver_id: id,
        order_num: i + 1,
      })) as Record<string, unknown>[]
    )
  }

  await admin.from('activity_logs').insert({
    actor_id: user.id,
    action: 'document_draft_saved',
    entity_type: 'document',
    entity_id: docId,
  } as Record<string, unknown>)

  revalidatePath('/documents')
  return { documentId: docId }
}

export async function submitDocumentAction(documentId: string): Promise<{ error?: string }> {
  const user = await getSessionUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인해주세요.' }
  const admin = createAdminClient()

  // admin 클라이언트로 일관성 있게 읽기 (RLS 세션 의존 제거)
  const { data: docRaw } = await admin
    .from('documents')
    .select('id, title, author_id, status')
    .eq('id', documentId)
    .single()
  const doc = docRaw as { id: string; title: string; author_id: string; status: string } | null
  if (!doc || doc.author_id !== user.id) return { error: '권한이 없습니다.' }
  if (doc.status !== 'draft') return { error: '상신할 수 없는 문서입니다.' }

  const { data: approversRaw } = await admin
    .from('document_approvers')
    .select('approver_id, order_num')
    .eq('document_id', documentId)
    .order('order_num', { ascending: true })
  const approvers = (approversRaw ?? []) as Array<{ approver_id: string; order_num: number }>
  if (approvers.length === 0) return { error: '결재자를 1명 이상 지정해야 합니다.' }

  // status = 'draft' 조건을 WHERE에 포함해 원자적으로 업데이트 (Race Condition 방지)
  const { data: updated } = await admin
    .from('documents')
    .update({ status: 'pending', submitted_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', documentId)
    .eq('status', 'draft')
    .select('id')
  if (!updated || updated.length === 0) return { error: '이미 상신된 문서입니다.' }

  await admin.from('notifications').insert({
    recipient_id: approvers[0].approver_id,
    title: '결재 요청',
    message: `"${doc.title}" 문서의 결재를 요청드립니다.`,
    type: 'approval_request',
    reference_id: documentId,
    reference_type: 'document',
  } as Record<string, unknown>)

  await admin.from('activity_logs').insert({
    actor_id: user.id,
    action: 'document_submitted',
    entity_type: 'document',
    entity_id: documentId,
  } as Record<string, unknown>)

  revalidatePath('/documents')
  revalidatePath(`/documents/${documentId}`)
  return {}
}

export async function recallDocumentAction(documentId: string): Promise<{ error?: string }> {
  const user = await requireAuth()
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: docRaw } = await supabase
    .from('documents')
    .select('id, status')
    .eq('id', documentId)
    .eq('author_id', user.id)
    .single()
  const doc = docRaw as { id: string; status: string } | null
  if (!doc || doc.status !== 'pending') return { error: '회수할 수 없는 문서입니다.' }

  await admin.from('documents').update({ status: 'recalled' } as Record<string, unknown>).eq('id', documentId)

  await admin.from('activity_logs').insert({
    actor_id: user.id,
    action: 'document_recalled',
    entity_type: 'document',
    entity_id: documentId,
  } as Record<string, unknown>)

  revalidatePath('/documents')
  revalidatePath(`/documents/${documentId}`)
  return {}
}

export async function approveDocumentAction(documentId: string): Promise<{ error?: string }> {
  const user = await requireAuth()
  const admin = createAdminClient()

  const { data: docRaw } = await admin
    .from('documents')
    .select('id, title, author_id, status')
    .eq('id', documentId)
    .single()
  const doc = docRaw as { id: string; title: string; author_id: string; status: string } | null
  if (!doc || doc.status !== 'pending') return { error: '결재할 수 없는 문서입니다.' }

  const { data: approversRaw } = await admin
    .from('document_approvers')
    .select('id, approver_id, order_num, status')
    .eq('document_id', documentId)
    .order('order_num', { ascending: true })
  const approvers = (approversRaw ?? []) as Array<{ id: string; approver_id: string; order_num: number; status: string }>

  const mine = approvers.find(a => a.approver_id === user.id && a.status === 'pending')
  if (!mine) return { error: '현재 결재 차례가 아닙니다.' }

  const prevDone = approvers.filter(a => a.order_num < mine.order_num).every(a => a.status === 'approved')
  if (!prevDone) return { error: '이전 결재자가 아직 승인하지 않았습니다.' }

  await admin
    .from('document_approvers')
    .update({ status: 'approved', processed_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', mine.id)

  const next = approvers.find(a => a.order_num === mine.order_num + 1)
  if (next) {
    await admin.from('notifications').insert({
      recipient_id: next.approver_id,
      title: '결재 요청',
      message: `"${doc.title}" 문서의 결재를 요청드립니다.`,
      type: 'approval_request',
      reference_id: documentId,
      reference_type: 'document',
    } as Record<string, unknown>)
  } else {
    await admin.from('documents').update({ status: 'approved' } as Record<string, unknown>).eq('id', documentId)
    await notifyIfEnabled(admin, doc.author_id, 'approval_result', {
      title: '기안서 최종 승인',
      message: `"${doc.title}" 문서가 최종 승인되었습니다.`,
      type: 'approved',
      reference_id: documentId,
      reference_type: 'document',
    })
  }

  await admin.from('activity_logs').insert({
    actor_id: user.id,
    action: 'document_approved',
    entity_type: 'document',
    entity_id: documentId,
  } as Record<string, unknown>)

  revalidatePath('/approvals')
  revalidatePath(`/approvals/${documentId}`)
  revalidatePath(`/documents/${documentId}`)
  return {}
}

export async function rejectDocumentAction(documentId: string, comment: string): Promise<{ error?: string }> {
  const user = await requireAuth()
  const admin = createAdminClient()

  const { data: docRaw } = await admin
    .from('documents')
    .select('id, title, author_id, status')
    .eq('id', documentId)
    .single()
  const doc = docRaw as { id: string; title: string; author_id: string; status: string } | null
  if (!doc || doc.status !== 'pending') return { error: '반려할 수 없는 문서입니다.' }

  const { data: mineRaw } = await admin
    .from('document_approvers')
    .select('id, order_num')
    .eq('document_id', documentId)
    .eq('approver_id', user.id)
    .eq('status', 'pending')
    .single()
  const mine = mineRaw as { id: string; order_num: number } | null
  if (!mine) return { error: '현재 결재 차례가 아닙니다.' }

  await admin
    .from('document_approvers')
    .update({ status: 'rejected', comment, processed_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', mine.id)

  await admin.from('documents').update({ status: 'rejected' } as Record<string, unknown>).eq('id', documentId)

  await notifyIfEnabled(admin, doc.author_id, 'approval_result', {
    title: '기안서 반려',
    message: `"${doc.title}" 문서가 반려되었습니다. 사유: ${comment}`,
    type: 'rejected',
    reference_id: documentId,
    reference_type: 'document',
  })

  await admin.from('activity_logs').insert({
    actor_id: user.id,
    action: 'document_rejected',
    entity_type: 'document',
    entity_id: documentId,
    metadata: { comment },
  } as Record<string, unknown>)

  revalidatePath('/approvals')
  revalidatePath(`/approvals/${documentId}`)
  revalidatePath(`/documents/${documentId}`)
  return {}
}
