import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { filterNotifiableRecipients } from '@/lib/notify'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { activeStepNums, isSelfInspection } from '@/lib/inspection-step-status'

// Vercel Cron 또는 외부 스케줄러에서 매일 09:00 호출
// Authorization: Bearer {CRON_SECRET} 헤더 필수
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  // CRON_SECRET이 없으면 검사를 통째로 건너뛰던 종전 조건(`cronSecret && …`)은 무인증 구멍이었다 —
  // 값이 빠지는 순간 이 엔드포인트가 누구에게나 열린다. 미설정이면 아예 거부한다(sync-holidays와 동일 규약).
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  // 컨테이너 TZ가 UTC라 00:05 KST 발화 시 toISOString()이 전날이 됨 — +9h 시프트로 KST 날짜 고정
  const todayStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0]

  function shiftDate(base: string, days: number): string {
    const d = new Date(base)
    d.setDate(d.getDate() + days)
    return d.toISOString().split('T')[0]
  }

  type Rule = {
    dueDate: string
    type: 'inspection_step_due' | 'inspection_step_overdue'
    titleFn: (customerName: string, stepName: string) => string
    messageFn: (customerName: string, stepName: string) => string
  }

  const rules: Rule[] = [
    {
      dueDate: shiftDate(todayStr, 3),
      type: 'inspection_step_due',
      titleFn: (c, s) => `[D-3] ${c} ${s} 마감 3일 전`,
      messageFn: (c, s) => `${c} — ${s} 마감이 3일 남았습니다.`,
    },
    {
      dueDate: shiftDate(todayStr, 1),
      type: 'inspection_step_due',
      titleFn: (c, s) => `[D-1] ${c} ${s} 내일 마감`,
      messageFn: (c, s) => `${c} — ${s} 마감이 내일입니다.`,
    },
    {
      dueDate: todayStr,
      type: 'inspection_step_due',
      titleFn: (c, s) => `[오늘 마감] ${c} ${s}`,
      messageFn: (c, s) => `${c} — ${s} 오늘이 마감입니다.`,
    },
    {
      dueDate: shiftDate(todayStr, -1),
      type: 'inspection_step_overdue',
      titleFn: (c, s) => `[지연] ${c} ${s} 기한 초과`,
      messageFn: (c, s) => `${c} — ${s} 마감이 초과되었습니다. 즉시 처리해 주세요.`,
    },
  ]

  // 알림 대상: manager/admin 전원
  const { data: managersRaw } = await admin
    .from('profiles')
    .select('id, role')
    .in('role', ['manager', 'admin'])
    .eq('is_active', true)
    .eq('is_system', false)

  const managerIds = ((managersRaw ?? []) as Array<{ id: string; role: string }>).map(p => p.id)

  type StepWithJoin = {
    id: string
    name_ko: string
    step_num: number
    inspection_id: string
    inspection: {
      assigned_employee_id: string | null
      plan_type: string | null
      customer: { customer_name: string } | null
    } | null
  }

  /** 소방계획서_45 — **해당없음 단계에는 알림을 보내지 않는다.**
   *  종전에는 `due_date` 일치 + `status != completed`만 봐서 activeStepNums 필터가 아예 없었다.
   *  그 결과 점검표 모두 합격이라 화면에서 '해당없음'으로 흐려진 ⑤⑥에 대해 「[D-3] 이행조치 마감」
   *  알림이 실제로 발송됐다 — 화면은 "할 일 없음", 알림은 "마감 임박"이라 말하는 상태.
   *  판정은 화면·목록·현황판과 **같은 원천**(activeStepNums × hasSheetDefect)을 쓴다. */
  async function activeStepsByInspection(ids: string[]): Promise<Map<string, Set<number>>> {
    const out = new Map<string, Set<number>>()
    if (ids.length === 0) return out
    const [inspRes, defRes, xRes] = await Promise.all([
      admin.from('inspections').select('id, plan_type').in('id', ids),
      fetchAllRows<{ inspection_id: string }>((from, to) => admin.from('inspection_defects')
        .select('inspection_id').in('inspection_id', ids).order('id').range(from, to)),
      fetchAllRows<{ inspection_id: string }>((from, to) => admin.from('inspection_sheet_responses')
        .select('inspection_id').in('inspection_id', ids).eq('result', 'X').order('id').range(from, to)),
    ])
    // 조회가 불완전하면 **알림을 지우는 쪽으로 기울지 않는다** — 못 받은 건 '불량 있음'으로 보수 판정한다.
    // (여기서 조용히 0으로 접으면 조치가 필요한 회차의 마감 알림이 사라진다 — 놓치는 쪽이 더 위험하다)
    const incomplete = !!(defRes.error || defRes.truncated || xRes.error || xRes.truncated)
    if (incomplete) console.error('[deadline-notify] 불량·✕ 조회 불완전 — 전 단계를 활성으로 보수 판정합니다', defRes.error, xRes.error)
    const needsRepair = new Set([...defRes.rows, ...xRes.rows].map(r => r.inspection_id))
    for (const i of (inspRes.data ?? []) as Array<{ id: string; plan_type: string | null }>) {
      out.set(i.id, new Set(activeStepNums(isSelfInspection(i.plan_type), incomplete || needsRepair.has(i.id))))
    }
    return out
  }

  let totalSent = 0
  const results: Record<string, number> = {}
  /** 해당없음(⑤⑥)이라 걸러낸 단계 수 — 응답에 함께 실어 필터가 실제로 발화했음을 관측한다 */
  const skippedNa: Record<string, number> = {}

  for (const rule of rules) {
    // ⚠ 2026-09-08 2차 판정: 이 상류 조회가 1000행에서 조용히 잘리고 있었다. 정기 점검은 마감일이
    // 점검일과 같아 같은 날짜로 대량이 몰릴 수 있고, 초과분은 오류 없이 알림에서 **사라진다** —
    // 하류 필터를 아무리 보수적으로 짜도 상류에서 없어진 행은 못 살린다.
    const stepsRes = await fetchAllRows<Record<string, unknown>>((from, to) => admin
      .from('inspection_steps')
      .select('id, name_ko, step_num, inspection_id, inspection:inspections(assigned_employee_id, plan_type, customer:customers(customer_name))')
      .eq('due_date', rule.dueDate)
      .neq('status', 'completed')
      .order('id').range(from, to))
    if (stepsRes.error) console.error('[deadline-notify] 대상 단계 조회 실패 — 이 규칙의 알림이 누락됩니다:', rule.dueDate, stepsRes.error)
    else if (stepsRes.truncated) console.error('[deadline-notify] 대상 단계 조회가 상한에서 잘렸습니다 — 알림 누락:', rule.dueDate)

    const rawSteps = stepsRes.rows as unknown as StepWithJoin[]
    if (rawSteps.length === 0) continue

    // 해당없음 단계(모두 합격이면 ⑤⑥)를 여기서 떨어뜨린다 — 발송 직전이 아니라 **집계 전**이라
    // `results[dueDate]`에도 잡히지 않는다(보냈다고 보고되던 수치가 실제 발송과 어긋나지 않게)
    const activeByInsp = await activeStepsByInspection([...new Set(rawSteps.map(s => s.inspection_id))])
    const steps = rawSteps.filter(s => activeByInsp.get(s.inspection_id)?.has(s.step_num) ?? true)
    // 필터 발화를 운영에서 **관측 가능하게** 남긴다 — 전건이 걸러진 날짜는 results에 키조차 안 생겨
    // '규칙이 안 돌았다'와 '해당없음이라 안 보냈다'를 구별할 수 없었다(2차 판정 지적)
    if (steps.length < rawSteps.length) skippedNa[rule.dueDate] = rawSteps.length - steps.length
    if (steps.length === 0) continue

    const stepIds = steps.map(s => s.id)

    // 오늘 이미 발송된 알림 제외
    const { data: existingRaw } = await admin
      .from('notifications')
      .select('reference_id')
      .in('reference_id', stepIds)
      .eq('type', rule.type)
      .gte('created_at', `${todayStr}T00:00:00+09:00`)

    const alreadyNotified = new Set(
      ((existingRaw ?? []) as Array<{ reference_id: string | null }>)
        .map(n => n.reference_id)
        .filter(Boolean) as string[]
    )

    const batch: Record<string, unknown>[] = []

    // 마감 임박 알림을 끈 수신자 제외 (수신 설정 — 제안.md 2단계)
    const candidateIds = [
      ...managerIds,
      ...steps.map(s => s.inspection?.assigned_employee_id).filter(Boolean) as string[],
    ]
    const notifiable = await filterNotifiableRecipients(admin, candidateIds, 'deadline')

    for (const step of steps) {
      if (alreadyNotified.has(step.id)) continue
      const insp = step.inspection
      if (!insp) continue

      const customerName = insp.customer?.customer_name ?? '—'
      const title = rule.titleFn(customerName, step.name_ko)
      const message = rule.messageFn(customerName, step.name_ko)

      // 담당자 + manager/admin 모두에게 발송 (deadline 알림을 끈 사람 제외)
      const recipients = new Set<string>(managerIds)
      if (insp.assigned_employee_id) recipients.add(insp.assigned_employee_id)

      for (const recipientId of recipients) {
        if (!notifiable.has(recipientId)) continue
        batch.push({
          recipient_id: recipientId,
          title,
          message,
          type: rule.type,
          reference_id: step.id,
          reference_type: 'inspection',
        })
      }
    }

    if (batch.length > 0) {
      await admin.from('notifications').insert(batch as Record<string, unknown>[])
      totalSent += batch.length
    }

    results[rule.dueDate] = batch.length
  }

  return NextResponse.json({
    ok: true,
    date: todayStr,
    sent: totalSent,
    breakdown: results,
    skippedNa,
  })
}
