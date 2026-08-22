// 롤링 생성 후 검증 — 종합 고객 2027 배치 + 방금 생성된 2026 보충분 6건 식별. 읽기 전용
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// 감상골(하반기 앵커 종합) 2027 — 2차가 2월에 생겼는지
const { data: comp } = await sb.from('customers').select('id, customer_name, plan_anchor_date')
  .eq('customer_name', '감상골').limit(1)
for (const c of comp ?? []) {
  const { data: items } = await sb.from('inspection_plan_items')
    .select('sequence_num, plan_type, planned_date, status, inspection_plans!inner(year, month)')
    .eq('customer_id', c.id).eq('inspection_plans.year', 2027).order('planned_date')
  console.log(`=== [종합] ${c.customer_name} 2027 (${(items ?? []).length}건) ===`)
  for (const it of items ?? []) {
    const p = it.inspection_plans
    console.log(`${p.year}-${String(p.month).padStart(2, '0')} seq${it.sequence_num} ${it.plan_type} planned=${it.planned_date} ${it.status}`)
  }
}

// 방금(30분 내) 생성된 2026년 항목 — 보충 6건 식별
const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
const { data: recent, error } = await sb.from('inspection_plan_items')
  .select('customer_id, sequence_num, plan_type, planned_date, status, created_at, inspection_plans!inner(year, month), customers(customer_name)')
  .gte('created_at', cutoff).eq('inspection_plans.year', 2026)
if (error) console.error('recent error:', error)
console.log(`\n=== 방금 생성된 2026 항목 (${(recent ?? []).length}건) ===`)
for (const it of recent ?? []) {
  const p = it.inspection_plans
  console.log(`${it.customers?.customer_name} ${p.year}-${String(p.month).padStart(2, '0')} seq${it.sequence_num} ${it.plan_type} planned=${it.planned_date} ${it.status}`)
}
