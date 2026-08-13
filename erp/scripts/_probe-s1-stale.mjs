// test-fire-s1 케이스 1·2 실패가 **내 배치 변경 때문인지, 기준일 정책 때문인지** 가른다.
// 두 케이스의 고객은 use_approval_date만 있고 plan_anchor_date·점검 이력이 없다.
// 2026-07-14 결정으로 사용승인일 폴백이 제거됐으므로 기준일이 없어 어떤 구현이든 0건이 맞다.
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const { data: p } = await db.from('profiles').select('id').limit(1).single()
const { data: c } = await db.from('customers').insert({
  customer_name: '[S1STALE] 사용승인일만', customer_code: `S1S${Date.now().toString(36).slice(-8)}`,
  inspection_type: '작동', inspection_category: '소방안전관리', inspection_sub_type: '작동',
  use_approval_date: '2020-03-15', is_active: true, created_by: p.id,
}).select('id, plan_anchor_date, use_approval_date').single()

const { count: inspCount } = await db.from('inspections')
  .select('id', { count: 'exact', head: true }).eq('customer_id', c.id)

console.log(`plan_anchor_date: ${c.plan_anchor_date ?? '(없음)'}`)
console.log(`use_approval_date: ${c.use_approval_date}`)
console.log(`점검 이력: ${inspCount ?? 0}건`)
console.log(c.plan_anchor_date === null && (inspCount ?? 0) === 0
  ? '→ 기준일 원천이 둘 다 없다. loadAnchorDates가 빈 값을 주므로 generateYearlyPlanItems는\n' +
    '  `if (!anchorDate) return 0`에서 **배치 변경 이전 코드도 똑같이** 0건을 반환한다.\n' +
    '  즉 test-fire-s1 케이스 1·2 실패는 2026-07-14 사용승인일 폴백 제거 이후 방치된 **테스트 노후화**다.'
  : '→ 전제와 다름 — 재확인 필요')

await db.from('customers').delete().eq('id', c.id)
console.log('정리 완료')
