// 특별점검 주기 확인 — 작동(연1회)·종합(연2회 6개월 간격) 실데이터 대조. 읽기 전용
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// 종합 고객 3곳의 2026년 항목 배치 — 2차(+6개월) 실배치 확인
const { data: comps } = await sb.from('customers')
  .select('id, customer_name, plan_anchor_date, inspection_sub_type')
  .eq('is_active', true).eq('inspection_sub_type', '종합').limit(3)

for (const c of comps ?? []) {
  const { data: items } = await sb.from('inspection_plan_items')
    .select('sequence_num, plan_type, planned_date, status, inspection_plans!inner(year, month)')
    .eq('customer_id', c.id).eq('inspection_plans.year', 2026)
    .order('planned_date')
  console.log(`\n=== [종합] ${c.customer_name} anchor=${c.plan_anchor_date} (2026: ${(items ?? []).length}건) ===`)
  for (const it of items ?? []) {
    const p = it.inspection_plans
    console.log(`${p.year}-${String(p.month).padStart(2, '0')} seq${it.sequence_num} ${it.plan_type} planned=${it.planned_date} ${it.status}`)
  }
}
