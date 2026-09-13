import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { startInspectionCore } from '@/lib/inspection-start'

// 정기(monthly)·자체점검(special_*) 당일 자동 시작 (2026-07-23 사용자 확정 — [시작] 클릭 없이 점검업무 반영)
// 매일 아침 호출: 확정일이 오늘(놓친 날 대비 3일 캐치업)인 미시작 항목을 자동 시작.
// 담당 미배정 항목은 건너뜀(자동 배정할 주체 없음) — [시작] 버튼 폴백으로 수동 처리.
// event는 대상에서 제거 (소방계획서_6 W-26·D-4) — 일반관리도 자체점검 체계, 미시작 event는 W-12가 정리.
//
// ⚠ special_*는 2026-09-13에 대상으로 **추가**했다. 종전 주석은 "자체점검은 점검일 확정 시점에
// 즉시 자동 시작되므로 제외"였는데, 그 전제가 점검확정 폐지(마이그 161·162)로 무너졌다:
// 확정 시점에 시작시키던 것은 `confirmPlanItemStageOneAction`인데, 이제 계획 항목이 **생성 시점에
// 이미 confirmed + scheduled_date**를 갖고 태어나 아무도 그 함수를 부르지 않는다.
// 즉 신규 특별점검은 사람이 [작성 시작]을 누를 때까지 시작되지 않았다 — 규약이 아니라 구멍이었다.
// 마감일 갈라짐은 startInspectionCore가 막는다(비어 있으면 lib/plan-step-dates로 계산해 채운다).
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  // CRON_SECRET이 없으면 검사를 통째로 건너뛰던 종전 조건(`cronSecret && …`)은 무인증 구멍이었다 —
  // 값이 빠지는 순간 이 엔드포인트가 누구에게나 열린다. 미설정이면 아예 거부한다(sync-holidays와 동일 규약).
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const todayStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0]
  const from = new Date(todayStr)
  from.setDate(from.getDate() - 3)
  const fromStr = from.toISOString().split('T')[0]

  const { data: itemsRaw } = await admin
    .from('inspection_plan_items')
    .select('id, customer_id, assigned_employee_id, scheduled_date, plan_type')
    .in('plan_type', ['monthly', 'special_종합', 'special_작동'])
    .eq('status', 'confirmed')
    .is('inspection_id', null)
    .gte('scheduled_date', fromStr)
    .lte('scheduled_date', todayStr)

  const items = (itemsRaw ?? []) as Array<{
    id: string; customer_id: string; assigned_employee_id: string | null; scheduled_date: string; plan_type: string
  }>

  let started = 0
  let skippedUnassigned = 0
  const errors: string[] = []
  for (const item of items) {
    if (!item.assigned_employee_id) { skippedUnassigned++; continue }
    const res = await startInspectionCore(admin, item.assigned_employee_id, item.id)
    if (res.error) errors.push(`${item.id}: ${res.error}`)
    else started++
  }

  return NextResponse.json({
    ok: true, date: todayStr, candidates: items.length,
    started, skippedUnassigned, errors: errors.slice(0, 10),
  })
}
