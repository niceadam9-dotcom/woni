import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { filterNotifiableRecipients } from '@/lib/notify'

// 소방안전관리자 실무교육 주기 알림 (2026-09-05)
// VPS 크론에서 매일 09:00 KST 호출 — Authorization: Bearer {CRON_SECRET} 헤더 필수
// 기한 = customers.manager_edu_date(최근 교육이수일, 104) + 2년. 교육이수일이 비어 있으면 기한을
// 계산할 수 없어 여기서는 다루지 않는다 — 미입력은 고객 상세 관계인 탭 상단 배지가 맡는다
// (매일 알림을 쏘면 소음이고, 배지는 화면을 열 때마다 보인다).
const EDU_CYCLE_YEARS = 2

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  // 미설정이면 아예 거부 — insurance-expiry-notify와 동일 규약(무인증 구멍 방지)
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  // 컨테이너 TZ가 UTC라 KST 날짜로 고정 (+9h 시프트 — inspection-deadline-notify와 동일)
  const todayStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0]

  function shiftDate(base: string, days: number): string {
    const d = new Date(base)
    d.setDate(d.getDate() + days)
    return d.toISOString().split('T')[0]
  }

  /** 교육이수일 + 2년 — 2/29 출발이면 3/1로 밀린다(setUTCFullYear 규칙, 하루 이르게 알리는 쪽이 안전) */
  function eduDueDate(eduDate: string): string | null {
    const d = new Date(eduDate)
    if (Number.isNaN(d.getTime())) return null
    d.setUTCFullYear(d.getUTCFullYear() + EDU_CYCLE_YEARS)
    return d.toISOString().split('T')[0]
  }

  type Rule = {
    dueDate: string
    type: 'manager_edu_due' | 'manager_edu_overdue'
    titleFn: (customerName: string) => string
    messageFn: (customerName: string, eduDate: string) => string
  }

  const rules: Rule[] = [
    {
      dueDate: shiftDate(todayStr, 30),
      type: 'manager_edu_due',
      titleFn: c => `[D-30] ${c} 소방안전관리자 실무교육 기한 30일 전`,
      messageFn: (c, e) => `${c} — 소방안전관리자 실무교육 기한(최근 교육이수일 ${e} + ${EDU_CYCLE_YEARS}년)이 30일 남았습니다. 교육 이수를 안내해 주세요.`,
    },
    {
      dueDate: shiftDate(todayStr, 7),
      type: 'manager_edu_due',
      titleFn: c => `[D-7] ${c} 소방안전관리자 실무교육 기한 7일 전`,
      messageFn: (c, e) => `${c} — 소방안전관리자 실무교육 기한(최근 교육이수일 ${e} + ${EDU_CYCLE_YEARS}년)이 7일 남았습니다. 교육 이수를 안내해 주세요.`,
    },
    {
      dueDate: todayStr,
      type: 'manager_edu_due',
      titleFn: c => `[오늘 기한] ${c} 소방안전관리자 실무교육`,
      messageFn: (c, e) => `${c} — 소방안전관리자 실무교육 기한(최근 교육이수일 ${e} + ${EDU_CYCLE_YEARS}년)이 오늘입니다.`,
    },
    {
      dueDate: shiftDate(todayStr, -1),
      type: 'manager_edu_overdue',
      titleFn: c => `[기한 경과] ${c} 소방안전관리자 실무교육`,
      messageFn: (c, e) => `${c} — 소방안전관리자 실무교육 기한(최근 교육이수일 ${e} + ${EDU_CYCLE_YEARS}년)이 지났습니다. 이수 후 관계인 탭의 최근 교육이수일을 갱신해 주세요.`,
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
    manager_edu_date: string | null
  }

  // 교육이수일 보유 고객 전량 조회 — Supabase 1,000행 한도 대비 페이지 순회
  const customers: CustomerRow[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data: pageRaw } = await admin
      .from('customers')
      .select('id, customer_name, assigned_employee_id, manager_edu_date')
      .eq('is_active', true)
      .not('manager_edu_date', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1)
    const page = (pageRaw ?? []) as CustomerRow[]
    customers.push(...page)
    if (page.length < PAGE) break
  }

  // 기한일별 그룹화 (파싱 불가는 건너뜀)
  const byDue = new Map<string, CustomerRow[]>()
  let unparsed = 0
  for (const c of customers) {
    const due = c.manager_edu_date ? eduDueDate(c.manager_edu_date) : null
    if (!due) { unparsed += 1; continue }
    const list = byDue.get(due) ?? []
    list.push(c)
    byDue.set(due, list)
  }

  let totalSent = 0
  const results: Record<string, number> = {}

  for (const rule of rules) {
    const targets = byDue.get(rule.dueDate) ?? []
    if (targets.length === 0) { results[rule.dueDate] = 0; continue }

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
      const message = rule.messageFn(customer.customer_name, customer.manager_edu_date ?? '')

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
          reference_type: 'customer',
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

    results[rule.dueDate] = batch.length
  }

  return NextResponse.json({
    ok: true,
    date: todayStr,
    withEduDate: customers.length,
    unparsed,
    sent: totalSent,
    breakdown: results,
  })
}
