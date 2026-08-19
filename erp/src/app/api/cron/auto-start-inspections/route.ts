import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { startInspectionCore } from '@/lib/inspection-start'

// 정기(monthly) 당일 자동 시작 (2026-07-23 사용자 확정 — [시작] 클릭 없이 점검업무 반영)
// 매일 아침 호출: 확정일이 오늘(놓친 날 대비 3일 캐치업)인 미시작 항목을 자동 시작.
// 담당 미배정 항목은 건너뜀(자동 배정할 주체 없음) — [시작] 버튼 폴백으로 수동 처리.
// 자체점검(special_*)은 점검일 확정 시점에 즉시 자동 시작되므로 제외.
// event는 대상에서 제거 (소방계획서_6 W-26·D-4) — 일반관리도 자체점검 체계, 미시작 event는 W-12가 정리.
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
    .eq('plan_type', 'monthly')
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
