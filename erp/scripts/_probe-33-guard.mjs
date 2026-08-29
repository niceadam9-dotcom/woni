// 소방계획서_33 — 가드 축 이동의 직접 증거. 실제 INSERT를 시도하고 되돌린다.
// 실행: node scripts/_probe-33-guard.mjs [envFile]
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const envFile = process.argv[2] || '.env.local'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const env = Object.fromEntries(
  readFileSync(join(root, envFile), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } })
console.log(`대상 DB: ${env.NEXT_PUBLIC_SUPABASE_URL} (${envFile})\n`)

const JONGHAP = String.fromCodePoint(0xC885, 0xD569)
const JAKDONG = String.fromCodePoint(0xC791, 0xB3D9)

let pass = 0, fail = 0
const created = []
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`✅ ${name}`) }
  else { fail++; console.log(`❌ ${name} — ${detail}`) }
}

// 대상 고객 2종 찾기
const { data: custs } = await admin.from('customers')
  .select('id, customer_name, inspection_type, inspection_sub_type').limit(2000)
const comp = custs.find(c => c.inspection_sub_type === JONGHAP)
const oper = custs.find(c => c.inspection_sub_type === JAKDONG)
if (!comp || !oper) { console.error('종합/작동 고객 표본을 찾지 못했습니다.'); process.exit(1) }
console.log(`종합 고객: ${comp.customer_name} / 작동 고객: ${oper.customer_name}\n`)

const YEAR = 2999   // 실데이터와 겹치지 않는 연도 (uq_inspections_special_year_seq 회피)

// assigned_employee_id는 NOT NULL — 아무 직원이나 하나 빌린다
const { data: emps } = await admin.from('profiles').select('id').limit(1)
const EMP = emps?.[0]?.id
if (!EMP) { console.error('직원 표본을 찾지 못했습니다.'); process.exit(1) }

async function tryInsert(label, customerId, seq, itype) {
  // year는 생성열(inspection_start_date에서 유도) — 직접 넣으면 거부된다
  const { data, error } = await admin.from('inspections').insert({
    customer_id: customerId, inspection_type: itype, sequence_num: seq,
    inspection_start_date: `${YEAR}-01-05`, status: 'scheduled',
    assigned_employee_id: EMP, created_by: EMP,
  }).select('id').single()
  if (data?.id) created.push(data.id)
  return { ok: !error, error }
}

// ⓐ 종합 고객 + 2차 + '작동' → **성공해야 한다** (축 이동의 직접 증거. 종전 트리거는 이걸 막았다)
{
  const r = await tryInsert('a', comp.id, 2, JAKDONG)
  check('ⓐ 종합 고객의 2차를 작동으로 저장 — 허용', r.ok, `거부됨: ${r.error?.message}`)
}
// ⓑ 작동 고객 + 2차 → **차단돼야 한다** (가드가 살아 있다)
{
  const r = await tryInsert('b', oper.id, 2, JAKDONG)
  check('ⓑ 작동 전용 고객의 2차 — 차단', !r.ok && /sequence_num=2/.test(r.error?.message ?? ''),
    r.ok ? '통과돼 버렸다(가드 소실)' : `다른 이유로 실패: ${r.error?.message}`)
}
// ⓒ 종합 고객 + 1차 + '종합' → 성공 (평시 경로 무손상)
{
  const r = await tryInsert('c', comp.id, 1, JONGHAP)
  check('ⓒ 종합 고객의 1차 종합 — 허용(회귀 없음)', r.ok, `거부됨: ${r.error?.message}`)
}
// ⓓ UPDATE 경로도 같은 축인가 — 종합 고객의 1차를 2차로 올려도 통과해야 한다.
// 트리거는 BEFORE INSERT **OR UPDATE**라 UPDATE 축을 따로 확인해야 한다(백필이 UPDATE였다).
// ⓐ가 만든 2차를 먼저 지운다 — 안 지우면 uq_inspections_special_year_seq에 걸려
// **트리거가 아니라 유니크 제약 때문에** 실패하고, 그걸 가드 실패로 오독하게 된다.
{
  const seq2 = created[0]
  const seq1 = created[created.length - 1]
  await admin.from('inspections').delete().eq('id', seq2)
  const { error } = await admin.from('inspections')
    .update({ sequence_num: 2, inspection_type: JAKDONG }).eq('id', seq1)
  check('ⓓ UPDATE로 2차 전환(종합 고객) — 허용', !error, `거부됨: ${error?.message}`)
}

// 정리
for (const id of created) await admin.from('inspections').delete().eq('id', id)
const { data: leftover } = await admin.from('inspections').select('id').eq('year', YEAR)
check('정리 — 남은 테스트 행 0건', (leftover ?? []).length === 0, `${leftover?.length}건 남음`)

console.log(`\n${pass}/${pass + fail} 통과`)
process.exit(fail === 0 ? 0 : 1)
