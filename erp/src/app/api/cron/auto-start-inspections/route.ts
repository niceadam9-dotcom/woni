import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { startInspectionCore } from '@/lib/inspection-start'

// 정기(monthly)·일반관리(event) 당일 자동 시작 (2026-07-23 사용자 확정 — [시작] 클릭 없이 점검업무 반영)
// 매일 아침 호출: 확정일이 오늘(놓친 날 대비 3일 캐치업)인 미시작 항목을 자동 시작.
// 담당 미배정 항목은 건너뜀(자동 배정할 주체 없음) — [시작] 버튼 폴백으로 수동 처리.
// 특별점검은 점검일 확정 시점에 즉시 자동 시작되므로 제외.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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
    .in('plan_type', ['monthly', 'event'])
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
