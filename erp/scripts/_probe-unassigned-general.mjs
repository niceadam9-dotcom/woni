// 읽기 전용 — 일반(종합)/일반(작동) 등 계획 항목·고객의 담당 미배정 실태 실측
// 실행: node scripts/_probe-unassigned-general.mjs [.env.local|.env.production]
import { readFileSync } from 'node:fs'
const envFile = process.argv[2] ?? '.env.local'
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

console.log(`DB: ${process.env.NEXT_PUBLIC_SUPABASE_URL} (${envFile})`)

// 1000행 상한 회피 — 전량 페이지 순회
async function fetchAll(builder) {
  const out = []
  for (let fromIdx = 0; ; fromIdx += 1000) {
    const { data, error } = await builder().range(fromIdx, fromIdx + 999)
    if (error) { console.log('ERR', error.message); process.exit(2) }
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

// 고객 담당 미배정
const custs = await fetchAll(() => admin.from('customers')
  .select('id, customer_name, inspection_type, assigned_employee_id, is_active'))
const activeCusts = custs.filter(c => c.is_active !== false)
const unassignedCusts = activeCusts.filter(c => !c.assigned_employee_id)
console.log(`customers active=${activeCusts.length} unassigned=${unassignedCusts.length}`)
for (const c of unassignedCusts.slice(0, 10)) console.log(`  - ${c.customer_name} (${c.inspection_type})`)

// 계획 항목 — plan_type별 미배정(미시작만: inspection_id null)
const items = await fetchAll(() => admin.from('inspection_plan_items')
  .select('id, plan_type, status, scheduled_date, planned_date, assigned_employee_id, inspection_id, customer_id, inspection_plans!inner(year)'))
const open = items.filter(i => !i.inspection_id && i.status !== 'canceled')
const byType = new Map()
for (const i of open) {
  const k = i.plan_type ?? '(null)'
  const e = byType.get(k) ?? { total: 0, unassigned: 0 }
  e.total++
  if (!i.assigned_employee_id) e.unassigned++
  byType.set(k, e)
}
console.log('미시작(open) 계획 항목 plan_type별:')
for (const [k, v] of [...byType.entries()].sort()) console.log(`  ${k}: total=${v.total} unassigned=${v.unassigned}`)

// 미배정 항목의 상태·연도 분포 (special_*만 = 일반/소방안전관리 종합·작동)
const unSpecial = open.filter(i => !i.assigned_employee_id && String(i.plan_type ?? '').startsWith('special_'))
const byYearStatus = new Map()
for (const i of unSpecial) {
  const k = `${i.inspection_plans?.year}·${i.status}`
  byYearStatus.set(k, (byYearStatus.get(k) ?? 0) + 1)
}
console.log(`special_* 미배정 미시작 = ${unSpecial.length}`)
for (const [k, v] of [...byYearStatus.entries()].sort()) console.log(`  ${k}: ${v}`)

// 그중 이미 예정일이 지난 건(방치 위험 실증)
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
const overdue = unSpecial.filter(i => (i.scheduled_date ?? i.planned_date ?? '9999') < today)
console.log(`special_* 미배정 + 예정일 경과 = ${overdue.length}`)
