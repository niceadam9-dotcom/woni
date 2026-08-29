// 소방계획서_33 — test-fire-s2-s3 셋업을 그대로 재현해 무엇이 생성되는지 덤프한다.
// '7월 special_종합이 없다'가 내 변경 탓인지, 앵커가 없어 애초에 0건이었는지 가르기 위한 대조.
// 임포트 방식은 test-fire-s2-s3와 동일하게 맞춘다('@/lib/supabase/admin'은 server-only라 못 쓴다).
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import gen from '../src/lib/inspection-plan-generator.ts'
const { generateYearlyPlanItems, loadHolidaySet, loadAnchorDates } =
  gen as unknown as typeof import('../src/lib/inspection-plan-generator.ts')

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const raw = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)
const admin = raw as never as Parameters<typeof generateYearlyPlanItems>[0]
const YEAR = 2026

let customerId = ''
try {
  const { data: prof } = await raw.from('profiles').select('id').limit(1).single()
  const userId = (prof as { id: string }).id

  const { data: cust, error } = await raw.from('customers').insert({
    customer_code: `TEST-P33-${Math.random().toString(36).slice(2, 8)}`,
    customer_name: 'TEST-P33-종합',
    inspection_type: '종합', inspection_category: '소방안전관리', inspection_sub_type: '종합',
    use_approval_date: '2018-07-15', contract_date: '2026-01-05',
    is_active: true, created_by: userId, assigned_employee_id: userId,
  }).select('id').single()
  if (error) throw new Error(error.message)
  customerId = (cust as { id: string }).id

  const anchors = await loadAnchorDates(admin, [{ id: customerId }])
  console.log('anchorDate =', JSON.stringify(anchors.get(customerId) ?? null))

  const hdSet = await loadHolidaySet(admin, YEAR)
  const n = await generateYearlyPlanItems(admin,
    { id: customerId, inspection_type: '종합', use_approval_date: '2018-07-15', assigned_employee_id: userId } as never,
    YEAR, userId, hdSet)
  console.log('생성 건수 =', n)

  const { data: items } = await raw.from('inspection_plan_items')
    .select('plan_type, sequence_num, inspection_type, inspection_sub_type, inspection_plans!inner(year, month)')
    .eq('customer_id', customerId)
  const rows = (items ?? []).map((i: Record<string, unknown>) => ({
    month: (i.inspection_plans as { month: number }).month,
    seq: i.sequence_num, plan_type: i.plan_type,
    type: i.inspection_type, sub: i.inspection_sub_type,
  })).sort((a, b) => (a.month as number) - (b.month as number))
  console.log('특별:', JSON.stringify(rows.filter(r => String(r.plan_type).startsWith('special'))))
  console.log('정기 건수:', rows.filter(r => r.plan_type === 'monthly').length)
} finally {
  if (customerId) {
    await raw.from('inspection_plan_items').delete().eq('customer_id', customerId)
    await raw.from('customers').delete().eq('id', customerId)
  }
}
