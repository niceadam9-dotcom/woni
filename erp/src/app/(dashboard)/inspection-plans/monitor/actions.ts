'use server'

import { createHmac } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/auth'

// ─── Solapi SMS 발송 헬퍼 ─────────────────────────────────────────────────────
// 환경변수: SOLAPI_API_KEY, SOLAPI_API_SECRET
async function _sendSolapi(
  messages: Array<{ to: string; from: string; text: string }>
): Promise<{ success: boolean; error?: string }> {
  const apiKey    = process.env.SOLAPI_API_KEY
  const apiSecret = process.env.SOLAPI_API_SECRET
  if (!apiKey || !apiSecret) {
    return { success: false, error: 'Solapi 자격증명이 설정되지 않았습니다. (SOLAPI_API_KEY, SOLAPI_API_SECRET)' }
  }
  if (messages.length === 0) return { success: true }

  const date      = new Date().toISOString()
  const salt      = Math.random().toString(36).substring(2, 18)
  const signature = createHmac('sha256', apiSecret).update(date + salt).digest('hex')
  const auth      = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`

  try {
    const res = await fetch('https://api.solapi.com/messages/v4/send-many/detail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': auth },
      body: JSON.stringify({ messages }),
    })
    if (!res.ok) {
      const body = await res.text()
      return { success: false, error: `Solapi 오류 (${res.status}): ${body}` }
    }
    return { success: true }
  } catch (e) {
    return { success: false, error: `네트워크 오류: ${String(e)}` }
  }
}

// 점검현황 로그 upsert (1~6단계 완료일 + SMS)
export async function upsertStatusLogAction(input: {
  planItemId: string
  inspectionDate?: string | null
  reportSubmittedAt?: string | null
  sentAt?: string | null
  filedAt?: string | null
  step5CompletedAt?: string | null
  step6CompletedAt?: string | null
  smsConfirmed?: boolean
}): Promise<{ error?: string }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  const admin = createAdminClient()

  const payload: Record<string, unknown> = {
    plan_item_id: input.planItemId,
    updated_by: user.id,
  }
  if (input.inspectionDate    !== undefined) payload.inspection_date      = input.inspectionDate
  if (input.reportSubmittedAt !== undefined) payload.report_submitted_at  = input.reportSubmittedAt
  if (input.sentAt            !== undefined) payload.sent_at              = input.sentAt
  if (input.filedAt           !== undefined) payload.filed_at             = input.filedAt
  if (input.step5CompletedAt  !== undefined) payload.step5_completed_at   = input.step5CompletedAt
  if (input.step6CompletedAt  !== undefined) payload.step6_completed_at   = input.step6CompletedAt
  if (input.smsConfirmed      !== undefined) payload.sms_confirmed        = input.smsConfirmed

  const { error } = await admin
    .from('inspection_status_log')
    .upsert(payload, { onConflict: 'plan_item_id' })

  if (error) return { error: '저장에 실패했습니다.' }
  revalidatePath('/inspection-plans/monitor')
  return {}
}

// SMS 발송 + 기록 저장
export async function saveSmsAction(input: {
  planItemIds: string[]
  smsContent: string
  senderPhone: string
  recipients: Array<{ planItemId: string; role: string; name: string; phone: string }>
}): Promise<{ error?: string; sentCount?: number; failedCount?: number }> {
  const user = await getSessionUser()
  if (!user) return { error: '인증이 필요합니다.' }
  const admin = createAdminClient()

  // 전화번호 정규화 (하이픈 제거)
  const normalizePhone = (p: string) => p.replace(/\D/g, '')

  // 고유 수신자 목록 구성 (planItemId → recipient 매핑)
  const messages = input.recipients
    .filter(r => input.planItemIds.includes(r.planItemId) && r.phone.trim())
    .map(r => ({
      to:   normalizePhone(r.phone),
      from: normalizePhone(input.senderPhone),
      text: input.smsContent,
    }))
    .filter(m => m.to.length >= 10 && m.from.length >= 10)

  // 실제 SMS 발송
  const smsResult = await _sendSolapi(messages)

  const now = new Date().toISOString()
  for (const planItemId of input.planItemIds) {
    await admin
      .from('inspection_status_log')
      .upsert({
        plan_item_id:  planItemId,
        sms_sent_at:   now,
        sms_content:   input.smsContent,
        sms_confirmed: false,
        updated_by:    user.id,
      } as Record<string, unknown>, { onConflict: 'plan_item_id' })
  }

  revalidatePath('/inspection-plans/monitor')

  if (!smsResult.success) {
    // DB 기록은 완료했지만 실제 발송 실패 — 사용자에게 알림
    return { error: `DB 기록 완료, 발송 실패: ${smsResult.error}`, sentCount: 0, failedCount: messages.length }
  }
  return { sentCount: messages.length, failedCount: 0 }
}

// 모니터링 목록 조회 (plan_items + status_log join)
export async function getMonitorItemsAction(filters: {
  yearMonth?: string
  employeeId?: string
  customerName?: string
  status?: string
}) {
  const admin = createAdminClient()

  // yearMonth로 해당 월의 plan_id 목록 먼저 조회
  let planIds: string[] | null = null
  if (filters.yearMonth) {
    const [year, month] = filters.yearMonth.split('-').map(Number)
    const { data: plans } = await admin
      .from('inspection_plans')
      .select('id')
      .eq('year', year)
      .eq('month', month)
    planIds = (plans ?? []).map((p: { id: string }) => p.id)
  }

  let query = admin
    .from('inspection_plan_items')
    .select(`
      id, plan_id, customer_id, inspection_type, sequence_num,
      scheduled_date, assigned_employee_id, status,
      customers:customer_id ( customer_name, customer_code, address, customer_contacts ( role, name, phone ) ),
      contacts:customer_contacts!contact_id ( role, name, phone ),
      profiles:assigned_employee_id ( name ),
      inspection_plans:plan_id ( year, month ),
      inspection_status_log ( inspection_date, report_submitted_at, sent_at, filed_at, step5_completed_at, step6_completed_at, sms_confirmed, sms_sent_at, sms_content )
    `)
    .neq('status', 'cancelled')
    .order('scheduled_date', { ascending: true, nullsFirst: false })

  if (planIds !== null) {
    if (planIds.length === 0) return { items: [] }
    query = query.in('plan_id', planIds) as typeof query
  }
  if (filters.employeeId) {
    query = query.eq('assigned_employee_id', filters.employeeId) as typeof query
  }
  if (filters.status && filters.status !== 'all') {
    query = query.eq('status', filters.status) as typeof query
  }

  const { data, error } = await query.limit(500)
  if (error) return { error: error.message, items: [] }

  let items = (data ?? []) as Record<string, unknown>[]

  // 이름 필터 (JS 단에서)
  if (filters.customerName) {
    const kw = filters.customerName.toLowerCase()
    items = items.filter(item => {
      const name = ((item.customers as Record<string, unknown>)?.customer_name as string ?? '').toLowerCase()
      return name.includes(kw)
    })
  }

  return { items }
}
