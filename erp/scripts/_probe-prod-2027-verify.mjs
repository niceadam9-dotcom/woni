// 운영 2027 롤링 생성 검증 — 월별 건수 + 서림사 배치. 읽기 전용
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const envFile = process.argv[2] ?? '.env.local.prod-backup'
const env = Object.fromEntries(
  readFileSync(new URL(`../${envFile}`, import.meta.url), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: plans } = await sb.from('inspection_plans').select('id, month').eq('year', 2027).order('month')
let total = 0
for (const p of plans ?? []) {
  const { count } = await sb.from('inspection_plan_items').select('id', { count: 'exact', head: true }).eq('plan_id', p.id)
  total += count
  console.log(`2027-${String(p.month).padStart(2, '0')}: ${count}건`)
}
console.log('total 2027:', total)

const { data: custs } = await sb.from('customers')
  .select('id, customer_name, inspection_sub_type, plan_anchor_date')
  .ilike('customer_name', '%서림사%')
for (const c of custs ?? []) {
  const { data: items } = await sb.from('inspection_plan_items')
    .select('sequence_num, plan_type, planned_date, status, inspection_plans!inner(year, month)')
    .eq('customer_id', c.id).eq('inspection_plans.year', 2027).order('planned_date')
  console.log(`\n=== ${c.customer_name} (${c.inspection_sub_type}, anchor=${c.plan_anchor_date}) 2027: ${(items ?? []).length}건 ===`)
  for (const it of items ?? []) {
    const p = it.inspection_plans
    console.log(`${p.year}-${String(p.month).padStart(2, '0')} seq${it.sequence_num} ${it.plan_type} planned=${it.planned_date} ${it.status}`)
  }
}
