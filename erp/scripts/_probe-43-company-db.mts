/** D-8 — DB `company_profile` 실값 vs 템플릿 동결 리터럴 대조 (소방계획서_43).
 *  배선하려면 '무엇으로 덮을 것인가'가 있어야 한다. 상호가 템플릿에 4종으로 박혀 있는데
 *  DB에 몇 개의 값이 있는지가 배선 가능 여부를 가른다.
 *  실행: npx tsx --conditions=react-server scripts/_probe-43-company-db.mts */
import './_env.mjs'
import { createAdminClient } from '../src/lib/supabase/admin'
import { ANCHORS } from '../src/lib/xlsx-anchors'

const admin = createAdminClient()
// ⚠ select('*')로 실컬럼을 본다 — 목록을 손으로 적으면 없는 컬럼 하나가 조용한 0행이 된다
const { data, error } = await admin.from('company_profile').select('*').limit(1)
if (error) { console.error('조회 실패:', error.message); process.exit(1) }
const row = (data?.[0] ?? {}) as Record<string, unknown>

console.log('── company_profile 실값 ──')
for (const k of Object.keys(row).sort()) {
  const v = row[k]
  if (v === null || v === '' || k.endsWith('_at') || k === 'id' || k === 'updated_by') continue
  console.log(`  ${k.padEnd(24)} ${JSON.stringify(v)}`)
}

console.log('\n── 템플릿 상호 4변형이 DB 값에서 파생 가능한가 ──')
const forms = ['㈜승진소방이엔지', '주식회사 승진소방 ENG', '㈜승진소방 ENG', '㈜승진소방ENG', '승진소방 ENG']
const cand: Array<[string, string]> = Object.entries(row)
  .filter(([, v]) => typeof v === 'string' && (v as string).includes('승진소방'))
  .map(([k, v]) => [k, v as string])
console.log(`  DB에서 상호를 담은 칸: ${cand.length ? cand.map(([k, v]) => `${k}="${v}"`).join(' · ') : '(없음)'}`)
for (const f of forms) {
  const exact = cand.filter(([, v]) => v === f).map(([k]) => k)
  console.log(`  "${f}" ${exact.length ? `← ${exact.join(',')} 와 정확히 일치` : '← DB에 같은 표기 없음(그대로 만들 수 없다)'}`)
}

console.log('\n── 이미 앵커가 있는 자리인가 ──')
for (const ref of ['보고서!C17', '공문!A1', '공문!A2', '계약서!C3']) {
  const [sheet, cell] = ref.split('!')
  const a = ANCHORS.filter(x => x.sheet === sheet && x.cell === cell)
  console.log(`  ${ref.padEnd(12)} ${a.length ? `앵커 ${a.map(x => x.field).join(',')}` : '미배선'}`)
}
