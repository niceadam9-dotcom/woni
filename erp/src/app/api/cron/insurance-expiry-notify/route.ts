import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { filterNotifiableRecipients } from '@/lib/notify'

// 화재보험 만기 임박 알림 (소방계획서-필드확장-설계 §8-4 파생 기능)
// VPS 크론에서 매일 09:00 KST 호출 — Authorization: Bearer {CRON_SECRET} 헤더 필수
// customers.insurance_period는 자유 텍스트("2026-01-01 ~ 2027-01-01") — 마지막 날짜 토큰을 만기일로 해석
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  // 컨테이너 TZ가 UTC라 KST 날짜로 고정 (+9h 시프트 — inspection-deadline-notify와 동일)
  const todayStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0]

  function shiftDate(base: string, days: number): string {
    // base(YYYY-MM-DD)는 UTC 0시로 해석되고 toISOString()도 UTC라 오프셋이 상쇄 — 날짜 연산만 정확하면 됨
    const d = new Date(base)
    d.setDate(d.getDate() + days)
    return d.toISOString().split('T')[0]
  }

  /** 자유 텍스트 기간에서 만기일 추출 — 날짜 토큰(YYYY-MM-DD·YYYY.MM.DD·YYYY/MM/DD) 중 마지막 */
  function parseExpiryDate(period: string): string | null {
    const matches = [...period.matchAll(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/g)]
    if (matches.length === 0) return null
    const last = matches[matches.length - 1]
    const [, y, m, d] = last
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    return Number.isNaN(new Date(iso).getTime()) ? null : iso
  }

  type Rule = {
    expiryDate: string
    type: 'insurance_expiry_due' | 'insurance_expiry_overdue'
    titleFn: (customerName: string) => string
    messageFn: (customerName: string, period: string) => string
  }

  const rules: Rule[] = [
    {
      expiryDate: shiftDate(todayStr, 30),
      type: 'insurance_expiry_due',
      titleFn: c => `[D-30] ${c} 화재보험 만기 30일 전`,
      messageFn: (c, p) => `${c} — 화재보험(${p}) 만기가 30일 남았습니다. 갱신을 안내해 주세요.`,
    },
    {
      expiryDate: shiftDate(todayStr, 7),
      type: 'insurance_expiry_due',
      titleFn: c => `[D-7] ${c} 화재보험 만기 7일 전`,
      messageFn: (c, p) => `${c} — 화재보험(${p}) 만기가 7일 남았습니다. 갱신을 안내해 주세요.`,
    },
    {
      expiryDate: todayStr,
      type: 'insurance_expiry_due',
      titleFn: c => `[오늘 만기] ${c} 화재보험`,
      messageFn: (c, p) => `${c} — 화재보험(${p})이 오늘 만기입니다.`,
    },
    {
      expiryDate: shiftDate(todayStr, -1),
      type: 'insurance_expiry_overdue',
      titleFn: c => `[만기 경과] ${c} 화재보험`,
      messageFn: (c, p) => `${c} — 화재보험(${p}) 만기가 지났습니다. 갱신 여부를 확인해 주세요.`,
    },
  ]

  // 알림 대상: manager/admin 전원 + 고객 담당자 (deadline 수신 설정을 끈 사람 제외)
  const { data: managersRaw } = await admin
    .from('profiles')
    .select('id, role')
    .in('role', ['manager', 'admin'])
    .eq('is_active', true)
    .eq('is_system', false)

  const managerIds = ((managersRaw ?? []) as Array<{ id: string; role: string }>).map(p => p.id)

  type CustomerRow = {
    id: string
    customer_name: string
    assigned_employee_id: string | null
    insurance_period: string | null
  }

  // 보험 가입 고객 전량 조회 — Supabase 1,000행 한도 대비 페이지 순회
  const customers: CustomerRow[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data: pageRaw } = await admin
      .from('customers')
      .select('id, customer_name, assigned_employee_id, insurance_period')
      .eq('is_active', true)
      .eq('insurance_joined', true)
      .not('insurance_period', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1)
    const page = (pageRaw ?? []) as CustomerRow[]
    customers.push(...page)
    if (page.length < PAGE) break
  }

  // 만기일별 그룹화 (파싱 불가는 건너뜀)
  const byExpiry = new Map<string, CustomerRow[]>()
  let unparsed = 0
  for (const c of customers) {
    const expiry = parseExpiryDate(c.insurance_period ?? '')
    if (!expiry) { unparsed += 1; continue }
    const list = byExpiry.get(expiry) ?? []
    list.push(c)
    byExpiry.set(expiry, list)
  }

  let totalSent = 0
  const results: Record<string, number> = {}

  for (const rule of rules) {
    const targets = byExpiry.get(rule.expiryDate) ?? []
    if (targets.length === 0) { results[rule.expiryDate] = 0; continue }

    // 오늘 이미 발송된 알림 제외 (고객 단위 중복 방지)
    const { data: existingRaw } = await admin
      .from('notifications')
      .select('reference_id')
      .in('reference_id', targets.map(c => c.id))
      .eq('type', rule.type)
      .gte('created_at', `${todayStr}T00:00:00+09:00`)

    const alreadyNotified = new Set(
      ((existingRaw ?? []) as Array<{ reference_id: string | null }>)
        .map(n => n.reference_id)
        .filter(Boolean) as string[]
    )

    const candidateIds = [
      ...managerIds,
      ...targets.map(c => c.assigned_employee_id).filter(Boolean) as string[],
    ]
    const notifiable = await filterNotifiableRecipients(admin, candidateIds, 'deadline')

    const batch: Record<string, unknown>[] = []

    for (const customer of targets) {
      if (alreadyNotified.has(customer.id)) continue

      const title = rule.titleFn(customer.customer_name)
      const message = rule.messageFn(customer.customer_name, customer.insurance_period ?? '')

      const recipients = new Set<string>(managerIds)
      if (customer.assigned_employee_id) recipients.add(customer.assigned_employee_id)

      for (const recipientId of recipients) {
        if (!notifiable.has(recipientId)) continue
        batch.push({
          recipient_id: recipientId,
          title,
          message,
          type: rule.type,
          reference_id: customer.id,
          reference_type: 'customer', // 097에서 CHECK 확장
        })
      }
    }

    if (batch.length > 0) {
      const { error } = await admin.from('notifications').insert(batch as Record<string, unknown>[])
      if (error) {
        return NextResponse.json(
          { ok: false, date: todayStr, error: error.message, failedRule: rule.type },
          { status: 500 }
        )
      }
      totalSent += batch.length
    }

    results[rule.expiryDate] = batch.length
  }

  return NextResponse.json({
    ok: true,
    date: todayStr,
    insured: customers.length,
    unparsed,
    sent: totalSent,
    breakdown: results,
  })
}
