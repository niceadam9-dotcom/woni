// 2026 패스 단독 재실행 — created=6이 실저장인지(재실행 0) 유령인지(재실행 6) 판별
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { generateYearlyPlanItems, loadHolidaySet } from '../src/lib/inspection-plan-generator'
import type { InspectionType } from '../src/types'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
)
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!) as never as Parameters<typeof generateYearlyPlanItems>[0]

const { data: sys } = await admin.from('profiles').select('id').eq('is_system', true).limit(1)
let createdBy = (sys?.[0] as { id: string } | undefined)?.id
if (!createdBy) {
  const { data: adm } = await admin.from('profiles').select('id').eq('role', 'admin').eq('is_active', true).limit(1)
  createdBy = (adm?.[0] as { id: string } | undefined)?.id
}
if (!createdBy) { console.error('no creator'); process.exit(1) }

const { data: customers } = await admin
  .from('customers')
  .select('id, customer_name, inspection_type, inspection_category, inspection_sub_type, plan_anchor_date, assigned_employee_id')
  .eq('is_active', true)
  .in('inspection_type', ['종합', '작동', '일반관리'])

type CustRow = {
  id: string; customer_name: string; inspection_type: InspectionType
  inspection_category: string | null; inspection_sub_type: string | null
  plan_anchor_date: string | null; assigned_employee_id: string | null
}
const hdSet = await loadHolidaySet(admin, 2026)
for (const c of (customers ?? []) as unknown as CustRow[]) {
  const n = await generateYearlyPlanItems(admin, c, 2026, createdBy, hdSet)
  if (n > 0) console.log(`created ${n}: ${c.customer_name} (${c.id})`)
}
console.log('done')
