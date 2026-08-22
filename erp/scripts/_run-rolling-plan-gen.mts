// 롤링 계획 생성 1회 실행 — 새 크론(generate-yearly-plans 롤링)과 동일 로직을 스테이징 DB에 적용.
// 생성기 본체(inspection-plan-generator)를 그대로 import — 로직 중복 없음. 멱등이라 재실행 안전.
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

// 생성자 프로필 — 라우트와 동일 규약 (시스템 계정 우선)
let createdBy: string | null = null
{
  const { data: sys } = await admin.from('profiles').select('id').eq('is_system', true).limit(1)
  if (sys?.length) createdBy = (sys[0] as { id: string }).id
  else {
    const { data: adm } = await admin.from('profiles').select('id').eq('role', 'admin').eq('is_active', true).limit(1)
    if (adm?.length) createdBy = (adm[0] as { id: string }).id
  }
}
if (!createdBy) { console.error('생성자 프로필 없음'); process.exit(1) }

const { data: customers, error } = await admin
  .from('customers')
  .select('id, customer_name, inspection_type, inspection_category, inspection_sub_type, plan_anchor_date, assigned_employee_id')
  .eq('is_active', true)
  .in('inspection_type', ['종합', '작동', '일반관리'])
if (error) { console.error(error); process.exit(1) }

type CustRow = {
  id: string; customer_name: string; inspection_type: InspectionType
  inspection_category: string | null; inspection_sub_type: string | null
  plan_anchor_date: string | null; assigned_employee_id: string | null
}
const list = (customers ?? []) as unknown as CustRow[]
console.log(`활성 고객 ${list.length}명`)

for (const year of [2026, 2027]) {
  const hdSet = await loadHolidaySet(admin, year)
  let created = 0
  const errors: string[] = []
  for (const c of list) {
    try {
      created += await generateYearlyPlanItems(admin, c, year, createdBy, hdSet)
    } catch (e) {
      errors.push(`${c.customer_name}: ${String(e)}`)
    }
  }
  console.log(`${year}: created=${created} errors=${errors.length}`)
  for (const e of errors) console.log('  ' + e)
}
