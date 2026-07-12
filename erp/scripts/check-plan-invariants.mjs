// 점검계획 데이터 불변식 검사 — 규칙 변경·데이터 정리 후 정합 확인용
// 실행: node scripts/check-plan-invariants.mjs  (위반 시 exit 1)
//
// INV-P1: 과거월 미처리 정기 0건 — "지난달 정기 생성 생략" 규칙 (e2569a6, 2026-07-10 잔재 12건 정리)
// INV-P2: 기준일(최초 점검시작일→사용승인일) 이전 planned_date 항목 0건 — 2차 역행 방지 (4090ee5)
// INV-P3: ⟦자동취소⟧ 마커 보유 항목은 반드시 cancelled — ADD-16 복원 마커 정합
// INV-P4: 비활성(퇴사) 직원 담당의 미완료 계획·점검 0건 — 달력 재배정 배너의 원인 (완료·취소는 이력이라 허용)
// INV-P5: 활성 고객의 담당직원은 활성이어야 함 — 위반 시 연간계획 생성마다 비활성 담당 항목이 재생산됨
// INV-P6: 진행중 점검에 연결된 계획 항목의 담당 = 점검 담당 — 불일치 시 모니터링·점검확정에 옛 담당이 표시됨
// INV-P7: completed 계획 항목은 반드시 점검에 연결 — 점검 삭제 시 되돌리기 누락(GAP-2) 검출 (구 INV-3 편입)
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
const { data: customers } = await admin.from('customers').select('id, customer_name, use_approval_date, plan_anchor_date')
// 기준일: 점검계획일(수동) → 최초 점검시작일 → 사용승인일 (loadAnchorDates와 동일 규칙)
const anchorMap = new Map()
{
  for (const c of customers ?? [])
    if (c.plan_anchor_date) anchorMap.set(c.id, c.plan_anchor_date)
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

// ── INV-P4: 비활성 직원 담당의 미완료 계획·점검 ──
const { data: inactiveProfiles } = await admin.from('profiles')
  .select('id, name').eq('is_active', false)
const inactiveIds = (inactiveProfiles ?? []).map(p => p.id)
const inactiveName = new Map((inactiveProfiles ?? []).map(p => [p.id, p.name]))
let p4 = []
if (inactiveIds.length > 0) {
  const [{ data: p4Items }, { data: p4Insp }] = await Promise.all([
    admin.from('inspection_plan_items')
      .select('id, assigned_employee_id, plan_type, planned_date, status, customers(customer_name)')
      .in('assigned_employee_id', inactiveIds).in('status', ['planned', 'confirmed']),
    admin.from('inspections')
      .select('id, assigned_employee_id, inspection_type, inspection_start_date, status, customers(customer_name)')
      .in('assigned_employee_id', inactiveIds).not('status', 'in', '("completed","cancelled")'),
  ])
  p4 = [
    ...(p4Items ?? []).map(r => ({ ...r, kind: '계획', when: r.planned_date, what: r.plan_type })),
    ...(p4Insp ?? []).map(r => ({ ...r, kind: '점검', when: r.inspection_start_date, what: r.inspection_type })),
  ]
}
report('INV-P4 비활성 직원 담당 미완료 항목', p4,
  r => `[${r.kind}] ${r.customers?.customer_name} ${r.what} ${r.when} (${r.status}) — 담당: ${inactiveName.get(r.assigned_employee_id)}`)

// ── INV-P5: 활성 고객의 담당직원은 활성 ──
const { data: activeCust } = await admin.from('customers')
  .select('id, customer_name, assigned_employee_id').eq('is_active', true)
const p5Active = (activeCust ?? []).filter(c => c.assigned_employee_id && inactiveIds.includes(c.assigned_employee_id))
report('INV-P5 활성 고객의 비활성 담당', p5Active,
  r => `${r.customer_name} — 담당: ${inactiveName.get(r.assigned_employee_id)} (비활성) → 고객 담당 변경 필요`)

// ── INV-P6: 진행중 점검 ↔ 연결 계획 항목 담당 일치 ──
const { data: linkedItems } = await admin.from('inspection_plan_items')
  .select('id, assigned_employee_id, customers(customer_name), inspections:inspection_id(status, assigned_employee_id)')
  .not('inspection_id', 'is', null)
const p6 = (linkedItems ?? []).filter(r => {
  const insp = r.inspections
  return insp && !['completed', 'cancelled'].includes(insp.status)
    && r.assigned_employee_id !== insp.assigned_employee_id
})
report('INV-P6 진행중 점검·항목 담당 일치', p6,
  r => `${r.customers?.customer_name} — 항목 담당 ≠ 점검 담당 (점검 ${r.inspections.status})`)

// ── INV-P7: completed 항목은 점검 연결 필수 (구 INV-3) ──
const { data: p7 } = await admin.from('inspection_plan_items')
  .select('id, planned_date, customers(customer_name)')
  .eq('status', 'completed').is('inspection_id', null)
report('INV-P7 완료 항목의 점검 연결', p7 ?? [],
  r => `${r.customers?.customer_name} ${r.planned_date} — 완료 상태인데 연결 점검 없음`)

console.log(violations === 0 ? '\n🎉 불변식 전부 성립' : `\n⚠ 총 ${violations}건 위반`)
process.exit(violations > 0 ? 1 : 0)
