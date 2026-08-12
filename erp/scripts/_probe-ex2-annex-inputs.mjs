// EX-2 — 외관점검표 ③ 서식 고유 값 저장·조회가 실제로 통하는지 (소방계획서_19)
// 실행: node scripts/_probe-ex2-annex-inputs.mjs   (스테이징)
//
// 왜 필요한가: 독립 판정이 "앱 화이트리스트와 DB CHECK 양쪽이 exterior를 막아
// 오버레이가 죽은 코드"라고 잡았다. 마이그레이션 126으로 CHECK를 열었으니 실제 upsert로 확인한다.
// 화이트리스트(서버 액션)는 세션이 필요해 여기서 못 태우므로 DB 계층만 본다.
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const raw = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } })

let pass = 0, fail = 0
const check = (n, c, d = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ''}`) } }

// 외관 대상(정기·일반) 회차 1건을 빌려 쓴다 — 값은 넣었다가 지운다
const { data: insp } = await raw.from('inspections')
  .select('id, plan_type').not('plan_type', 'is', null).neq('plan_type', 'special_작동').neq('plan_type', 'special_종합')
  .limit(1).maybeSingle()

if (!insp) {
  console.log('⏭  외관 대상 회차가 없어 건너뜀')
  process.exit(0)
}

const { error: upErr } = await raw.from('annex_inputs').upsert({
  inspection_id: insp.id, annex_no: 'exterior',
  fields: { reportDate: '2026-07-15', note: 'EX-2 프로브' },
}, { onConflict: 'inspection_id,annex_no' })
check('exterior upsert 성공(CHECK 통과)', !upErr, upErr?.message)

const { data: back } = await raw.from('annex_inputs').select('fields')
  .eq('inspection_id', insp.id).eq('annex_no', 'exterior').maybeSingle()
check('저장분 재조회 — 값 일치', back?.fields?.note === 'EX-2 프로브', JSON.stringify(back?.fields))

// 허용되지 않는 값은 여전히 거부되어야 한다(제약이 통째로 풀린 게 아님을 확인)
const { error: badErr } = await raw.from('annex_inputs').upsert({
  inspection_id: insp.id, annex_no: 'report99', fields: {},
}, { onConflict: 'inspection_id,annex_no' })
check('미허용 서식은 여전히 거부', !!badErr, badErr ? '거부됨' : '통과해 버림')

await raw.from('annex_inputs').delete().eq('inspection_id', insp.id).eq('annex_no', 'exterior')
const { data: gone } = await raw.from('annex_inputs').select('id')
  .eq('inspection_id', insp.id).eq('annex_no', 'exterior').maybeSingle()
check('프로브 시험분 정리', !gone)

console.log(`\n${fail === 0 ? '✅' : '❌'} EX-2 저장 경로 ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
