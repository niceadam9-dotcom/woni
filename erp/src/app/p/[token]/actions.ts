'use server'

/** 관계인 링크에서의 견적 승인 (공개 — 로그인 없음). 토큰이 곧 권한이다.
 *  🔒 service role로만 읽고 쓴다. 상태 전이는 조건부 UPDATE(작성중·발송인 것만)라 두 번 눌러도 한 번만 승인된다. */
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveShareToken, logShareEvent, clientMeta } from '@/lib/share-links'
import { todayKst } from '@/lib/kst-date'

export async function approveQuoteViaLinkAction(input: { token: string; name: string; agree: boolean }): Promise<{ error?: string }> {
  const name = (input.name ?? '').trim()
  if (!name || name.length > 30) return { error: '성함을 적어 주세요(30자 이내).' }
  if (!input.agree) return { error: '동의 항목에 체크해 주세요.' }
  const admin = createAdminClient()
  const link = await resolveShareToken(admin, input.token)
  if (!link || link.kind !== 'quote' || !link.quote_id) return { error: '링크가 유효하지 않습니다.' }

  const { data: q } = await admin.from('quotes')
    .select('id, quote_number, status, valid_until, total_amount, created_by, inspection_id, customer:customers(customer_name)')
    .eq('id', link.quote_id).maybeSingle()
  const quote = q as {
    id: string; quote_number: string; status: string; valid_until: string | null; total_amount: number
    created_by: string | null; inspection_id: string | null; customer: { customer_name: string } | null
  } | null
  if (!quote) return { error: '견적을 찾을 수 없습니다.' }
  if (quote.valid_until && quote.valid_until < todayKst()) return { error: '유효기간이 지난 견적입니다.' }

  const { data: updated, error } = await admin.from('quotes').update({
    status: '승인', approved_at: new Date().toISOString(), approved_by_name: name, approval_channel: 'portal',
  }).eq('id', quote.id).in('status', ['작성중', '발송']).select('id')
  if (error) { console.error('[share-approve] 승인 실패:', error.message); return { error: '승인을 기록하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' } }
  if (!updated || updated.length === 0) return { error: '이미 처리된 견적입니다.' }

  await logShareEvent(admin, link.id, 'approved', { ...clientMeta(await headers()), actorName: name })

  // 담당자 알림 — 견적 작성자 + 회차 담당자
  const recipients = new Set<string>()
  if (quote.created_by) recipients.add(quote.created_by)
  if (quote.inspection_id) {
    const { data: insp } = await admin.from('inspections').select('assigned_employee_id').eq('id', quote.inspection_id).maybeSingle()
    const a = (insp as { assigned_employee_id: string | null } | null)?.assigned_employee_id
    if (a) recipients.add(a)
  }
  if (recipients.size) {
    const cname = quote.customer?.customer_name ?? '고객'
    const { error: nErr } = await admin.from('notifications').insert([...recipients].map(rid => ({
      recipient_id: rid, type: 'quote_approved',
      title: `[견적 승인] ${cname} ${quote.quote_number}`,
      message: `${name}님이 링크에서 견적을 승인했습니다(합계 ${Math.round(Number(quote.total_amount)).toLocaleString('ko-KR')}원). 수주로 전환해 주세요.`,
      reference_id: quote.inspection_id, reference_type: quote.inspection_id ? 'inspection' : null,
    })))
    if (nErr) console.error('[share-approve] 알림 실패(승인은 기록됨):', nErr.message)
  }
  if (quote.inspection_id) revalidatePath(`/inspections/${quote.inspection_id}/repair`)
  revalidatePath('/quotes')
  return {}
}
