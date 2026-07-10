// 점검계획 데이터 불변식 검사 — 규칙 변경·데이터 정리 후 정합 확인용
// 실행: node scripts/check-plan-invariants.mjs  (위반 시 exit 1)
//
// INV-P1: 과거월 미처리 정기 0건 — "지난달 정기 생성 생략" 규칙 (e2569a6, 2026-07-10 잔재 12건 정리)
// INV-P2: 기준일(최초 점검시작일→사용승인일) 이전 planned_date 항목 0건 — 2차 역행 방지 (4090ee5)
// INV-P3: ⟦자동취소⟧ 마커 보유 항목은 반드시 cancelled — ADD-16 복원 마커 정합
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SERVICE_ROLE_KEY } from './_env.mjs'

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
const curYear = kstNow.getUTCFullYear()
const curMonth = kstNow.getUTCMonth() + 1

let violations = 0
function report(name, rows, format) {
  if (rows.length === 0) { console.log(`✅ ${name} — 위반 0건`); return }
  violations += rows.length
  console.log(`❌ ${name} — 위반 ${rows.length}건`)
  for (const r of rows) console.log('   -', format(r))
}

// ── INV-P1: 과거월(올해 현재월 이전 + 과거 연도) 미처리 정기 ──
const { data: p1a } = await admin.from('inspection_plan_items')
  .select('id, planned_date, status, customers(customer_name), inspection_plans!inner(year, month)')
  .eq('plan_type', 'monthly').in('status', ['planned', 'confirmed'])
  .eq('inspection_plans.year', curYear).lt('inspection_plans.month', curMonth)
const { data: p1b } = await admin.from('inspection_plan_items')
  .select('id, planned_date, status, customers(customer_name), inspection_plans!inner(year, month)')
  .eq('plan_type', 'monthly').in('status', ['planned', 'confirmed'])
  .lt('inspection_plans.year', curYear)
report('INV-P1 과거월 미처리 정기', [...(p1a ?? []), ...(p1b ?? [])],
  r => `${r.customers?.customer_name} ${r.inspection_plans.year}-${r.inspection_plans.month}월 ${r.planned_date} (${r.status})`)

// ── INV-P2: 기준일 이전 planned_date ──
const { data: customers } = await admin.from('customers').select('id, customer_name, use_approval_date')
// 기준일: 최초 점검시작일 우선 → 사용승인일 (loadAnchorDates와 동일 규칙)
const anchorMap = new Map()
{
  const { data: insp } = await admin.from('inspections')
    .select('customer_id, inspection_start_date').order('inspection_start_date', { ascending: true })
  for (const r of insp ?? [])
    if (r.inspection_start_date && !anchorMap.has(r.customer_id)) anchorMap.set(r.customer_id, r.inspection_start_date)
  for (const c of customers ?? [])
    if (!anchorMap.has(c.id) && c.use_approval_date) anchorMap.set(c.id, c.use_approval_date)
}
const custName = new Map((customers ?? []).map(c => [c.id, c.customer_name]))
const { data: allItems } = await admin.from('inspection_plan_items')
  .select('id, customer_id, planned_date, plan_type, status')
  .not('planned_date', 'is', null)
const p2 = (allItems ?? []).filter(i => {
  const anchor = anchorMap.get(i.customer_id)
  return anchor && i.planned_date < anchor
})
report('INV-P2 기준일 이전 항목', p2,
  r => `${custName.get(r.customer_id)} ${r.plan_type} ${r.planned_date} < 기준일 ${anchorMap.get(r.customer_id)} (${r.status})`)

// ── INV-P3: 자동취소 마커 정합 ──
const { data: p3 } = await admin.from('inspection_plan_items')
  .select('id, status, notes, customers(customer_name)')
  .like('notes', '%⟦자동취소:%').neq('status', 'cancelled')
report('INV-P3 자동취소 마커 정합', p3 ?? [],
  r => `${r.customers?.customer_name} status=${r.status} notes=${r.notes}`)

console.log(violations === 0 ? '\n🎉 불변식 전부 성립' : `\n⚠ 총 ${violations}건 위반`)
process.exit(violations > 0 ? 1 : 0)
