// 소방계획서_33 S4-4 — 초과 판정 술어를 sub_type 축으로 넓혔을 때 **늘어나는 행 수**를 먼저 잰다.
// 가드/판정 술어를 바꿀 땐 영향 범위를 세고 시작한다([[feedback_guard_blast_radius]]).
// 읽기 전용. 실행: node scripts/_probe-33-s44.mjs [envFile]
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const envFile = process.argv[2] || '.env.local'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const env = Object.fromEntries(
  readFileSync(join(root, envFile), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } })
console.log(`대상 DB: ${env.NEXT_PUBLIC_SUPABASE_URL}\n`)

const JONGHAP = String.fromCodePoint(0xC885, 0xD569)

const { data: custs } = await admin.from('customers')
  .select('id, customer_name, inspection_type, inspection_sub_type, plan_anchor_date')
  .eq('is_active', true)

const oldPred = c => c.inspection_type === JONGHAP
const newPred = c => c.inspection_sub_type === JONGHAP
  || (c.inspection_sub_type == null && c.inspection_type === JONGHAP)

const onlyNew = (custs ?? []).filter(c => newPred(c) && !oldPred(c))
const onlyOld = (custs ?? []).filter(c => oldPred(c) && !newPred(c))
console.log(`활성 고객 ${custs.length}`)
console.log(`  구 술어(inspection_type='종합')  : ${(custs ?? []).filter(oldPred).length}`)
console.log(`  신 술어(sub_type 우선)          : ${(custs ?? []).filter(newPred).length}`)
console.log(`  ▲새로 2차 판정 대상이 되는 고객  : ${onlyNew.length}`)
for (const c of onlyNew) console.log(`     + ${c.customer_name} type=${c.inspection_type} sub=${c.inspection_sub_type} anchor=${c.plan_anchor_date}`)
console.log(`  ▼빠지는 고객(있으면 안 된다)     : ${onlyOld.length}`)
for (const c of onlyOld) console.log(`     - ${c.customer_name} type=${c.inspection_type} sub=${c.inspection_sub_type}`)

// 실제로 '초과'로 뜨려면 기준일이 있고 2차 달이 지났고 그 달 항목이 없어야 한다.
// 화면과 같은 조건으로 세어 **실제 늘어나는 초과 행**을 판정한다.
const now = new Date(Date.now() + 9 * 3600_000)
const year = now.getUTCFullYear(), month = now.getUTCMonth() + 1

const { data: plans } = await admin.from('inspection_plans').select('id, month').eq('year', year)
const planMonth = Object.fromEntries((plans ?? []).map(p => [p.id, p.month]))
const { data: yItems } = await admin.from('inspection_plan_items')
  .select('customer_id, sequence_num, plan_id').in('plan_id', (plans ?? []).map(p => p.id))
const handled = new Set((yItems ?? []).map(i => `${i.customer_id}-${i.sequence_num}-${planMonth[i.plan_id]}`))

let added = 0
for (const c of onlyNew) {
  if (!c.plan_anchor_date) { console.log(`     (${c.customer_name}: 기준일 없음 → 초과 판정 대상 아님)`); continue }
  const am = new Date(c.plan_anchor_date).getMonth() + 1
  const sm = ((am - 1 + 6) % 12) + 1
  const wraps = sm < am
  if (!wraps && sm < month && !handled.has(`${c.id}-2-${sm}`)) { added++; console.log(`     ⚠ ${c.customer_name}: ${sm}월 2차가 초과로 새로 뜬다`) }
  else console.log(`     (${c.customer_name}: 2차월=${sm} wraps=${wraps} 이미처리=${handled.has(`${c.id}-2-${sm}`)} → 안 뜬다)`)
}
console.log(`\n▶ 화면에 **실제로 새로 뜨는 초과 행**: ${added}건`)
