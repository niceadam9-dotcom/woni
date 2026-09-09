import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { filterNotifiableRecipients } from '@/lib/notify'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { activeStepsByInspection, isStepActive } from '@/lib/active-steps'

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

  /* 소방계획서_45 — **해당없음 단계에는 알림을 보내지 않는다.**
   * 종전에는 `due_date` 일치 + `status != completed`만 봐서 activeStepNums 필터가 아예 없었고,
   * 점검표 모두 합격이라 화면에서 '해당없음'으로 흐려진 ⑤⑥에 「[D-3] 이행조치 마감」 알림이
   * 실제로 발송됐다 — 화면은 "할 일 없음", 알림은 "마감 임박"이라 말하는 상태.
   *
   * ⭐3차 판정 후 §S11: 판정을 여기 **지역 함수로 두었던 것**이 화면 다섯 곳이 같은 거짓말을
   * 계속하게 두었다(사이드바 영구 빨강·대시보드·점검 달력·계획 패널·개인 일정). 그래서
   * `lib/active-steps.ts`로 승격해 여섯 표면이 한 벌을 쓴다 — 여기서는 그것을 부르기만 한다.
   * R-4(3차 판정)로 잡힌 「plan_type 조회만 맨몸」도 그 모듈에서 함께 고쳐졌다. */

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
    // ⚠ R-6(3차 판정): 대상이 0건인 날은 `results`·`skippedNa` 어디에도 키가 안 생겨 '규칙이 안 돌았다'와
    // '대상이 없었다'가 다시 구별되지 않았다 — S9-7이 없애려던 모호성이 이 경로에 그대로 남아 있었다.
    // 형제 크론들(defect-action-notify·insurance-expiry-notify)처럼 0을 **명시**한다.
    results[rule.dueDate] ??= 0
    skippedNa[rule.dueDate] ??= 0
    if (rawSteps.length === 0) continue

    // 해당없음 단계(모두 합격이면 ⑤⑥)를 여기서 떨어뜨린다 — 발송 직전이 아니라 **집계 전**이라
    // `results[dueDate]`에도 잡히지 않는다(보냈다고 보고되던 수치가 실제 발송과 어긋나지 않게)
    const activeByInsp = await activeStepsByInspection(
      admin, [...new Set(rawSteps.map(s => s.inspection_id))], 'deadline-notify')
    const steps = rawSteps.filter(s => isStepActive(activeByInsp, s.inspection_id, s.step_num))
    // 필터 발화를 운영에서 **관측 가능하게** 남긴다 — 전건이 걸러진 날짜는 results에 키조차 안 생겨
    // '규칙이 안 돌았다'와 '해당없음이라 안 보냈다'를 구별할 수 없었다(2차 판정 지적)
    // ⚠ 단위는 **단계 수**다(results는 알림 행 수 = 단계 × 수신자). 같은 JSON에 실리므로 합·비교가
    // 성립하지 않는다는 것을 이름으로 못 박는다(R-7). ⑤⑥ 해당없음과 정기 레거시 ②~⑥ 제외가
    // 한 칸에 합산되는 것도 그대로다 — 둘 다 activeStepNums의 같은 판정에서 나온다.
    skippedNa[rule.dueDate] = rawSteps.length - steps.length
    if (steps.length === 0) continue

    const stepIds = steps.map(s => s.id)

    // 오늘 이미 발송된 알림 제외 — **멱등의 유일한 근거**다.
    //
    // 🎯 3차 독립 판정 R-5(중대): 2차 판정 수리가 상류 상한을 20배로 풀면서(fetchAllRows maxRows
    // 20,000) 이 하류 조회는 맨몸으로 뒀다. 반환 행수는 `단계 수 × 수신자 수`라 임계가 1000행이
    // 아니라 **단계 200건 수준**이고(매니저 5인), 잘리면 alreadyNotified가 불완전해져 같은 날
    // 재실행·캐치업에서 **중복 알림이 대량 발송**된다. 상류를 풀었으면 하류도 함께 풀어야 한다.
    // ⚠ 잘렸는데도 그냥 진행하면 중복을 보내므로, 불완전하면 **이 규칙을 건너뛴다**(안 보내는 쪽).
    const existingRes = await fetchAllRows<{ reference_id: string | null }>((from, to) => admin
      .from('notifications')
      .select('reference_id')
      .in('reference_id', stepIds)
      .eq('type', rule.type)
      .gte('created_at', `${todayStr}T00:00:00+09:00`)
      .order('id').range(from, to))

    if (existingRes.error || existingRes.truncated) {
      console.error('[deadline-notify] 기발송 조회 불완전 — 중복 발송을 막기 위해 이 규칙을 건너뜁니다:', rule.dueDate, existingRes.error)
      continue
    }

    const alreadyNotified = new Set(
      existingRes.rows.map(n => n.reference_id).filter(Boolean) as string[]
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
      // ⚠ R-8(3차 판정): 종전에는 반환값을 버리고 `totalSent += batch.length`를 무조건 더해,
      // insert가 실패해도 응답이 `ok:true, sent:N`이었다 — 운영은 발송됐다고 믿는다.
      // 형제 크론 둘(defect-action-notify:115·insurance-expiry-notify:169)은 검사 후 500을 낸다.
      const { error: insErr } = await admin.from('notifications').insert(batch as Record<string, unknown>[])
      if (insErr) {
        console.error('[deadline-notify] 알림 저장 실패:', rule.dueDate, insErr)
        return NextResponse.json({ ok: false, error: insErr.message, dueDate: rule.dueDate }, { status: 500 })
      }
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
