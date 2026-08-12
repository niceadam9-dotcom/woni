/** [독립 판정] EX-2 — 마이그레이션 126(annex_inputs CHECK에 exterior 추가)이 스테이징에 적용됐는가.
 *  실행: node scripts/_judge-af-ex2.mjs   (.env.local = 스테이징)
 *
 *  무변경 판정법: 존재하지 않는 inspection_id로 insert를 시도한다.
 *   - CHECK가 exterior를 막으면 23514(check_violation) — 126 미적용
 *   - CHECK를 통과하면 FK 위반 23503(foreign_key_violation) — 126 적용
 *  두 경우 모두 행이 남지 않으므로 실데이터를 건드리지 않는다.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const raw = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } })

let pass = 0, fail = 0
const check = (n, c, d = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ''}`) } }

console.log(`대상 프로젝트: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)

const { count: before } = await raw.from('annex_inputs').select('id', { count: 'exact', head: true })
console.log(`annex_inputs 사전 건수: ${before}`)

const GHOST = '00000000-0000-4000-8000-0000000ex200'.replace('ex2', 'abc') // 실재하지 않는 UUID
const probe = async (annexNo) => {
  const { error } = await raw.from('annex_inputs').insert({ inspection_id: GHOST, annex_no: annexNo, fields: {} })
  return error ?? {}
}

const eExterior = await probe('exterior')
const eReport10 = await probe('report10')
const eBogus = await probe('report99')

console.log(`  exterior → code=${eExterior.code} ${eExterior.message ?? ''}`)
console.log(`  report10 → code=${eReport10.code} ${eReport10.message ?? ''}`)
console.log(`  report99 → code=${eBogus.code} ${eBogus.message ?? ''}`)

check('대조군 report10은 CHECK 통과(FK에서만 걸림)', eReport10.code === '23503', `code=${eReport10.code}`)
check('대조군 report99는 CHECK 위반', eBogus.code === '23514', `code=${eBogus.code}`)
const applied = eExterior.code === '23503'
check('마이그레이션 126 적용 — exterior가 CHECK를 통과', applied,
  eExterior.code === '23514' ? '여전히 CHECK 위반 = 126 미적용' : `code=${eExterior.code}`)

const { count: after } = await raw.from('annex_inputs').select('id', { count: 'exact', head: true })
check('annex_inputs 건수 무변경', before === after, `${before} → ${after}`)

console.log(`\n${fail === 0 ? '✅' : '❌'} EX-2 DB 계층 ${pass}/${pass + fail} (126 적용=${applied})`)
process.exit(fail === 0 ? 0 : 1)
