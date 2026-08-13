// 128 적용 확인 — 3인자 판이 있고, 2인자 호출이 **모호하지 않게** 동작하는지(구판 잔존 탐지)
// 실행: node scripts/_probe-128-applied.mjs
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
if (!url?.includes('nwflnzugwylhpdyodyog')) { console.error(`중단 — 스테이징이 아님: ${url}`); process.exit(2) }
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY)

// 존재하지 않는 점검 id로 호출 — 함수는 no-op이라 부작용이 없고 시그니처 해석만 검사한다
const NIL = '00000000-0000-0000-0000-000000000000'
const three = await db.rpc('recalc_inspection_steps',
  { p_inspection_id: NIL, p_base_date: '2026-01-02', p_include_completed: true })
const two = await db.rpc('recalc_inspection_steps',
  { p_inspection_id: NIL, p_base_date: '2026-01-02' })

let fail = 0
const ok = (n, c, d = '') => { if (c) console.log(`  ✅ ${n}`); else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ''}`) } }

ok('3인자(p_include_completed) 판이 있다 — 128 적용됨', !three.error, three.error?.message ?? '')
ok('2인자 호출도 성공한다 — DEFAULT로 해석(구판이 남아 모호해지지 않았다)',
  !two.error, two.error?.message ?? '')
ok('2인자 호출이 모호성 오류가 아니다(구판 DROP 확인)',
  !/is not unique|모호|ambiguous/i.test(two.error?.message ?? ''))

console.log(fail ? `\n❌ ${fail}건 실패` : '\n✅ 128 적용 확인 — 3인자 단일 시그니처')
process.exit(fail ? 1 : 0)
