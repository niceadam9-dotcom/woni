// 읽기 전용 — 「고객엔 담당이 있는데 계획 항목만 미배정」 = reconcileSpecialSlots의 null 하드코딩 흔적
// 이 상태의 항목은 자동시작 크론이 영구히 건너뛴다(auto-start-inspections/route.ts:48).
import { readFileSync } from 'node:fs'
const envFile = process.argv[2] ?? '.env.local'
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
console.log(`DB: ${process.env.NEXT_PUBLIC_SUPABASE_URL}  오늘=${today}`)

async function all(b) {
  const out = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await b().order('id').range(i, i + 999)
    if (error) { console.log('ERR', error.message); process.exit(2) }
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

const custs = await all(() => admin.from('customers').select('id, customer_name, assigned_employee_id, is_active'))
const assignedCust = new Map(custs.filter(c => c.is_active !== false && c.assigned_employee_id).map(c => [c.id, c]))
const items = await all(() => admin.from('inspection_plan_items')
  .select('id, customer_id, plan_type, status, scheduled_date, assigned_employee_id, inspection_id, created_at'))

const open = items.filter(i => !i.inspection_id && i.status !== 'cancelled')
// 결함 서명: 고객엔 담당이 있는데 항목은 미배정
const orphan = open.filter(i => !i.assigned_employee_id && assignedCust.has(i.customer_id))
const trulyUnassigned = open.filter(i => !i.assigned_employee_id && !assignedCust.has(i.customer_id))

console.log(`\n미시작 항목 ${open.length}건 중 미배정 = ${open.filter(i => !i.assigned_employee_id).length}`)
console.log(`  ├ 고객엔 담당 있음 (= 전파 누락 결함)   : ${orphan.length}건  🚨`)
console.log(`  └ 고객도 미배정 (= 원래 미배정)         : ${trulyUnassigned.length}건`)

const byType = new Map()
for (const i of orphan) byType.set(i.plan_type ?? '(null)', (byType.get(i.plan_type ?? '(null)') ?? 0) + 1)
console.log(`\n전파 누락분 plan_type별: ${[...byType.entries()].sort().map(([k, v]) => `${k}=${v}`).join(' ')}`)
console.log(`  그중 예정일 경과 = ${orphan.filter(i => (i.scheduled_date ?? '9999') < today).length}  <= 크론이 영구히 건너뛴 방치분`)
console.log(`  영향 고객 수 = ${new Set(orphan.map(i => i.customer_id)).size}`)

const byDay = new Map()
for (const i of orphan) { const d = (i.created_at ?? '').slice(0, 10); byDay.set(d, (byDay.get(d) ?? 0) + 1) }
console.log(`\n생성일 분포(전파 누락분): ${[...byDay.entries()].sort().map(([k, v]) => `${k}=${v}`).join(' ')}`)

console.log(`\n표본 8건:`)
for (const i of orphan.slice(0, 8))
  console.log(`  ${assignedCust.get(i.customer_id).customer_name} ${i.scheduled_date} ${i.plan_type} 생성=${(i.created_at ?? '').slice(0, 16)}`)
