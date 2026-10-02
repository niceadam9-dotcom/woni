'use server'

/** 관계인 링크에서의 견적 승인 (공개 — 로그인 없음). 토큰이 곧 권한이다.
 *  🔒 service role로만 읽고 쓴다. 상태 전이는 조건부 UPDATE(작성중·발송인 것만)라 두 번 눌러도 한 번만 승인된다.
 *  3단계(2026-10-02): 손글씨 서명(선택) — PNG data URL을 받아 형식·크기·머리 바이트를 확인하고 fire-plans에 보관,
 *  승인과 같은 UPDATE에서 approval_signature_path를 쓰고 pdf_path를 비운다(다음 PDF가 승인란·서명을 담아 다시 만들어지게). */
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveShareToken, logShareEvent, clientMeta } from '@/lib/share-links'
import { todayKst } from '@/lib/kst-date'

const SIG_PREFIX = 'data:image/png;base64,'
const SIG_MAX_BYTES = 200_000
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** 서명 data URL → PNG 바이트. 형식이 아니면 오류 문자열 */
function decodeSignature(dataUrl: string): Uint8Array | string {
  if (!dataUrl.startsWith(SIG_PREFIX)) return '서명 형식이 올바르지 않습니다.'
  const b64 = dataUrl.slice(SIG_PREFIX.length)
  if (!/^[A-Za-z0-9+/=]+$/.test(b64)) return '서명 형식이 올바르지 않습니다.'
  const bytes = new Uint8Array(Buffer.from(b64, 'base64'))
  if (bytes.length > SIG_MAX_BYTES) return '서명 이미지가 너무 큽니다.'
  if (bytes.length < PNG_MAGIC.length || PNG_MAGIC.some((b, i) => bytes[i] !== b)) return '서명 형식이 올바르지 않습니다.'
  return bytes
}

export async function approveQuoteViaLinkAction(input: { token: string; name: string; agree: boolean; signature?: string | null }): Promise<{ error?: string }> {
  const name = (input.name ?? '').trim()
  if (!name || name.length > 30) return { error: '성함을 적어 주세요(30자 이내).' }
  if (!input.agree) return { error: '동의 항목에 체크해 주세요.' }
  let sigBytes: Uint8Array | null = null
  if (input.signature) {
    const d = decodeSignature(input.signature)
    if (typeof d === 'string') return { error: d }
    sigBytes = d
  }
  const admin = createAdminClient()
  const link = await resolveShareToken(admin, input.token)
  if (!link || link.kind !== 'quote' || !link.quote_id) return { error: '링크가 유효하지 않습니다.' }

  const { data: q } = await admin.from('quotes')
    .select('id, customer_id, quote_number, status, valid_until, total_amount, created_by, inspection_id, customer:customers(customer_name)')
    .eq('id', link.quote_id).maybeSingle()
  const quote = q as {
    id: string; customer_id: string; quote_number: string; status: string; valid_until: string | null; total_amount: number
    created_by: string | null; inspection_id: string | null; customer: { customer_name: string } | null
  } | null
  if (!quote) return { error: '견적을 찾을 수 없습니다.' }
  if (quote.valid_until && quote.valid_until < todayKst()) return { error: '유효기간이 지난 견적입니다.' }
  if (!['작성중', '발송'].includes(quote.status)) return { error: '이미 처리된 견적입니다.' }

  let sigPath: string | null = null
  if (sigBytes) {
    sigPath = `${quote.customer_id}/signatures/quote_${quote.id}_${Date.now()}.png`
    const up = await admin.storage.from('fire-plans').upload(sigPath, sigBytes, { contentType: 'image/png' })
    if (up.error) { console.error('[share-approve] 서명 업로드 실패:', up.error.message); return { error: '서명을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' } }
  }

  const { data: updated, error } = await admin.from('quotes').update({
    status: '승인', approved_at: new Date().toISOString(), approved_by_name: name, approval_channel: 'portal',
    approval_signature_path: sigPath, pdf_path: null,
  }).eq('id', quote.id).in('status', ['작성중', '발송']).select('id')
  if (error || !updated || updated.length === 0) {
    if (sigPath) await admin.storage.from('fire-plans').remove([sigPath])  // 승인 못 했으면 서명 파일도 남기지 않는다
    if (error) { console.error('[share-approve] 승인 실패:', error.message); return { error: '승인을 기록하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' } }
    return { error: '이미 처리된 견적입니다.' }
  }

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
      message: `${name}님이 링크에서 견적을 승인했습니다${sigPath ? '(서명 포함)' : ''}(합계 ${Math.round(Number(quote.total_amount)).toLocaleString('ko-KR')}원). 수주로 전환해 주세요.`,
      reference_id: quote.inspection_id, reference_type: quote.inspection_id ? 'inspection' : null,
    })))
    if (nErr) console.error('[share-approve] 알림 실패(승인은 기록됨):', nErr.message)
  }
  if (quote.inspection_id) revalidatePath(`/inspections/${quote.inspection_id}/repair`)
  revalidatePath('/quotes')
  return {}
}
