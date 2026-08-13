// R5-9 판정 검증 — "펌프성능시험 표가 붙는 설비"를 원문에서 직접 센다 (읽기 전용).
// 판정자 A는 _form/_별지4호_현행판_추출.txt로 7개(5번 화재조기진압 포함), 구현자는 _doc01 XML로 6개를 셌다.
// 이 리포엔 '추출 txt를 근거로 삼아 오판'한 전력이 있어(19.md A4-4), 두 원문을 함께 대조한다.
// 실행: node scripts/_probe-pump-table-source.mjs
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const GOAL = 'F:\\AI\\ERP\\erp_goal'

/** 별지 4호 점검표의 설비 제목 — 번호. 설비명 형태로 나타난다 */
const FACILITY_RE = /(?:^|[\s>])(\d{1,2})\s*[.．]\s*(옥내소화전설비|스프링클러설비|간이스프링클러설비|화재조기진압용\s*스프링클러설비|물분무소화설비|미분무소화설비|포소화설비|이산화탄소소화설비|할론소화설비|할로겐화합물[^\s<]*소화설비|분말소화설비|옥외소화전설비)/g

function scan(label, text) {
  // 텍스트를 순서대로 훑으며 '설비 제목'과 '펌프성능시험' 출현을 시간순으로 기록
  const events = []
  const facRe = new RegExp(FACILITY_RE.source, 'g')
  let m
  while ((m = facRe.exec(text))) events.push({ at: m.index, kind: 'fac', no: Number(m[1]), name: m[2].replace(/\s+/g, '') })
  const pumpRe = /펌프성능시험/g
  while ((m = pumpRe.exec(text))) events.push({ at: m.index, kind: 'pump' })
  events.sort((a, b) => a.at - b.at)

  const hits = []
  let cur = null
  for (const e of events) {
    if (e.kind === 'fac') cur = e
    else if (cur) hits.push(`${cur.no}. ${cur.name}`)
    else hits.push('(설비 미상)')
  }
  const uniq = [...new Set(hits)]
  console.log(`\n── ${label}`)
  console.log(`   '펌프성능시험' 출현 ${hits.length}회 · 직전 설비 기준 고유 ${uniq.length}개`)
  for (const u of uniq) console.log(`     · ${u}`)
  return uniq
}

// ① _doc01 별지 4호 XML (구현자 근거)
const doc01 = readdirSync(join(GOAL, '_doc01')).find(f => f.startsWith('[별지 4]') && f.endsWith('.xml'))
const aSet = doc01
  ? scan(`_doc01/${doc01}`, readFileSync(join(GOAL, '_doc01', doc01), 'utf8').replace(/<[^>]+>/g, ' '))
  : (console.log('\n── _doc01 별지4호 XML 없음'), [])

// ② _form 추출 txt (판정자 A 근거)
let bSet = []
try {
  bSet = scan('_form/_별지4호_현행판_추출.txt', readFileSync(join(GOAL, '_form', '_별지4호_현행판_추출.txt'), 'utf8'))
} catch { console.log('\n── _form 추출 txt 없음') }

console.log('\n── 두 원문 차이')
const only = (x, y) => x.filter(v => !y.includes(v))
console.log('  _doc01 에만:', only(aSet, bSet).join(' / ') || '없음')
console.log('  추출txt 에만:', only(bSet, aSet).join(' / ') || '없음')

// ③ 구현이 선언한 설비
const impl = readFileSync('src/lib/pump-test.ts', 'utf8')
const nums = (impl.match(/PUMP_TEST_SHEETS\s*=\s*\[([^\]]+)\]/) || [])[1] ?? ''
console.log('\n── 구현(pump-test.ts PUMP_TEST_SHEETS):', nums.trim())
