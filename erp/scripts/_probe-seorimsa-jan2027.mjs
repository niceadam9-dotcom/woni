// 서림사 2027-01 정기 부재 원인 실측 — 읽기 전용 일회성 프로브
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// 2027년 계획(월별)과 항목 수 — 다른 고객은 있는지 교차 확인
{
  const { data: plans, error } = await sb.from('inspection_plans')
    .select('id, year, month').eq('year', 2027).order('month')
  if (error) console.error('plans2027 error:', error)
  console.log('2027 plans:', JSON.stringify(plans))
  for (const p of plans ?? []) {
    const { count } = await sb.from('inspection_plan_items')
      .select('id', { count: 'exact', head: true }).eq('plan_id', p.id)
    console.log(`2027-${String(p.month).padStart(2, '0')} items: ${count}`)
  }
}

const { data: custs, error: ce } = await sb.from('customers')
  .select('id, customer_name, inspection_type, inspection_category, inspection_sub_type, plan_anchor_date')
  .ilike('customer_name', '%서림사%')
if (ce) { console.error('customers error:', ce); process.exit(1) }
console.log('customers:', JSON.stringify(custs, null, 1))

for (const c of custs ?? []) {
  const { data: items, error: ie } = await sb.from('inspection_plan_items')
    .select('sequence_num, plan_type, planned_date, scheduled_date, status, inspection_plans!inner(year, month)')
    .eq('customer_id', c.id)
    .gte('inspection_plans.year', 2026)
    .order('planned_date', { ascending: true })
  if (ie) { console.error('items error:', ie); continue }
  console.log(`\n=== ${c.customer_name} plan items 2026~ (${(items ?? []).length} rows) ===`)
  for (const it of items ?? []) {
    const p = it.inspection_plans
    console.log(`${p.year}-${String(p.month).padStart(2, '0')} seq${it.sequence_num} ${it.plan_type} planned=${it.planned_date} status=${it.status}`)
  }
}
