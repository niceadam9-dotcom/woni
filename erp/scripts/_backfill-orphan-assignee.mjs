// 백필 — 「고객엔 담당이 있는데 계획 항목만 미배정」인 **미시작** 항목에 고객 담당을 채운다.
//
// 왜 남았나: `reconcile-special-slots.ts`가 생성기에 `assigned_employee_id: null`을 박아 넘겼다
// (2026-09-14 수리). 그 코드가 만든 항목은 고객에 담당이 있어도 미배정으로 태어났고, 자동시작
// 크론이 미배정을 건너뛰므로(auto-start-inspections:48) **아무도 시작하지 않는다**.
//
// 🚨 안전 규약
//  · **시작된 항목은 건드리지 않는다**(inspection_id 있음) — 이미 수행한 점검의 담당을 소급해
//    바꾸면 별지 서식의 점검자란이 사실과 달라진다.
//  · 취소된 항목도 제외. 고객이 **미배정이면 손대지 않는다** — 없는 담당을 지어내지 않는다.
//  · 기본은 드라이런. `--apply`를 줘야 쓴다.
//
// 실행: node scripts/_backfill-orphan-assignee.mjs [.env.local|.env.production] [--apply]
import { readFileSync } from 'node:fs'
const envFile = process.argv[2] ?? '.env.local'
const APPLY = process.argv.includes('--apply')
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
}
const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
console.log(`DB: ${process.env.NEXT_PUBLIC_SUPABASE_URL} (${envFile})  ${APPLY ? '=== APPLY ===' : '(드라이런)'}`)

async function all(b) {
  const out = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await b().order('id').range(i, i + 999)
    if (error) { console.log('ERR', error.message); process.exit(2) }
    out.push(...(data ?? [])); if (!data || data.length < 1000) break
  }
  return out
}

const custs = await all(() => admin.from('customers').select('id, customer_name, assigned_employee_id, is_active'))
const assigned = new Map(custs.filter(c => c.is_active !== false && c.assigned_employee_id).map(c => [c.id, c]))
const items = await all(() => admin.from('inspection_plan_items')
  .select('id, customer_id, plan_type, status, scheduled_date, assigned_employee_id, inspection_id'))

const targets = items.filter(i =>
  !i.assigned_employee_id &&          // 항목이 미배정이고
  !i.inspection_id &&                 // 아직 시작 전이며
  i.status !== 'cancelled' &&         // 취소가 아니고
  assigned.has(i.customer_id))        // 고객엔 담당이 있다

console.log(`\n대상 ${targets.length}건 (고객 ${new Set(targets.map(t => t.customer_id)).size}명)`)
for (const t of targets) {
  const c = assigned.get(t.customer_id)
  console.log(`  ${c.customer_name}  ${t.scheduled_date}  ${t.plan_type}  → ${c.assigned_employee_id.slice(0, 8)}…`)
}
// 손대지 않는 것도 세어 보여 준다 — 「왜 이건 안 고쳤나」가 나중에 질문이 되지 않도록
const started = items.filter(i => !i.assigned_employee_id && i.inspection_id && assigned.has(i.customer_id))
const noOwner = items.filter(i => !i.assigned_employee_id && !i.inspection_id && !assigned.has(i.customer_id))
console.log(`\n제외: 이미 시작됨 ${started.length}건(소급 금지) · 고객도 미배정 ${noOwner.length}건(지어내지 않음)`)

if (!APPLY) { console.log('\n드라이런 — 적용하려면 --apply'); process.exit(0) }
if (targets.length === 0) { console.log('\n대상 0건 — 할 일 없음'); process.exit(0) }

let ok = 0
for (const t of targets) {
  const { error } = await admin.from('inspection_plan_items')
    .update({ assigned_employee_id: assigned.get(t.customer_id).assigned_employee_id })
    .eq('id', t.id)
    .is('inspection_id', null)        // 경합 안전망 — 그사이 시작됐으면 건너뛴다
  if (error) console.log(`  실패 ${t.id}: ${error.message}`)
  else ok++
}
console.log(`\n적용 ${ok}/${targets.length}`)

// 되읽기 판정 — 적용 응답이 아니라 결과로 본다
const after = await all(() => admin.from('inspection_plan_items')
  .select('id, customer_id, assigned_employee_id, inspection_id, status'))
const left = after.filter(i => !i.assigned_employee_id && !i.inspection_id && i.status !== 'cancelled' && assigned.has(i.customer_id))
console.log(left.length === 0 ? '✅ 전파 누락 0건' : `❌ 아직 ${left.length}건 남음`)
process.exit(left.length === 0 ? 0 : 1)
