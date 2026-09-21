/** 표지 제목 크기 계약 — 「제목 절제」(2026-09-21 2차 사용자 지시)의 유일한 자.
 *
 *  1차 지시(「최소 몇 배 키워라」)로 상한을 96pt까지 올렸더니 **짧은 이름이 상한을 그대로 받아**
 *  제목이 폭의 79%를 먹고 사진과 맞먹는 덩치가 됐다(용문3 = 96pt 두 줄, image-26 실측).
 *  2차 지시는 「너무 크다 · 사진을 주역으로」 — 상한 54pt, **짧은 이름은 한 줄**.
 *
 *  ⭐ 「54pt인가」만 묻지 않는다. 그건 상수 하나를 베끼는 것이라 규칙이 망가져도 초록일 수 있다.
 *    실제로 물어야 하는 계약은 넷이다:
 *      ① 상한을 넘지 않는다              — 「너무 크다」가 재발하지 않는가
 *      ② 짧은 이름은 **한 줄**이다        — 1pt 더 크자고 제목을 가르지 않는가(종전 결함)
 *      ③ 어느 줄도 폭을 넘지 않는다       — 넘치면 엑셀이 조용히 잘라 인쇄한다
 *      ④ 띠+사진+정보가 **한 쪽**에 든다  — 넘치면 표지가 두 장이 된다
 *
 *  실행: npx tsx scripts/test-cover-title-size.mts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import {
  coverTitleLayout, coverTitleEm, COVER_WIDTH_PT, COVER_TITLE_MAX_ROW_PT,
} from '../src/lib/fire-plan-cover-title.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/** 사용자가 고른 상한 */
const CAP_PT = 54
/** 한 줄이어야 하는 이름 — 짧은 쪽(실고객 실명 분포에서 고른 대표) */
const SHORT_NAMES = ['용문3', '까뮤', '남한강휴게소']
/** 긴 쪽 — 여기서는 줄이 늘어도 좋다. 대신 «넘치지 않는가»가 핵심이 된다 */
const LONG_NAMES = [
  '원석비바체 아파트 비바체 아파트',
  '2신속사단사령부 영내 간부숙소 (남)',
  '외갓집체험마을 (외갓집영농조합법인)',
  '창인요양원 (창인직업재활시설 포함)',
]
const A4_BODY_PT = 838

let pass = 0
const fails: string[] = []
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✔ ${name}`) }
  else { fails.push(name); console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const titleOf = (n: string) => `[ ${n} ] 소방계획서`

console.log('① 상한 — 「너무 크다」가 재발하지 않는가')
for (const n of [...SHORT_NAMES, ...LONG_NAMES]) {
  const L = coverTitleLayout(titleOf(n))
  check(`${n} ≤ ${CAP_PT}pt`, L.fontPt <= CAP_PT, `${L.fontPt}pt`)
}

console.log('\n② 짧은 이름은 한 줄 — 1pt 더 크자고 제목을 가르지 않는다')
for (const n of SHORT_NAMES) {
  const L = coverTitleLayout(titleOf(n))
  check(`${n} 한 줄 (${L.fontPt}pt)`, L.lines.length === 1, `${L.lines.length}줄 ${JSON.stringify(L.lines)}`)
}
// 🎯 음성 짝 — 「전부 한 줄」로 만들어 버리면 긴 이름이 넘친다. 긴 쪽은 **갈라져야** 한다.
for (const n of LONG_NAMES) {
  const L = coverTitleLayout(titleOf(n))
  check(`${n} 는 갈라진다`, L.lines.length > 1, `${L.lines.length}줄`)
}

console.log('\n③ 어느 줄도 폭을 넘지 않는다 (제품의 SAFETY와 무관하게 하드 한도로)')
for (const n of [...SHORT_NAMES, ...LONG_NAMES]) {
  const L = coverTitleLayout(titleOf(n))
  const widest = Math.max(...L.lines.map(coverTitleEm)) * L.fontPt
  check(`${n} 최장 줄 ${widest.toFixed(0)}pt ≤ ${COVER_WIDTH_PT.toFixed(0)}pt`, widest <= COVER_WIDTH_PT,
    `${widest.toFixed(1)}pt · ${L.fontPt}pt × ${L.lines.length}줄`)
}

console.log('\n④ 한 쪽 — 제목 띠 + 사진 + 정보가 A4 한 장에 든다')
/* 표지의 **고정 행들**은 템플릿에서 직접 읽는다(상수를 베끼면 템플릿이 바뀌어도 초록이다).
 * ⚠ `ht="` 앞에 공백 필수 — 없으면 `customHeight="1"` 안의 `ht="1"`을 물어 전부 1pt로 읽힌다. */
const zip = await JSZip.loadAsync(readFileSync(resolve(ROOT, 'templates/fire-plan-workbook.xlsx')))
const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
const rows = new Map<number, number>()
for (const m of sheet.matchAll(/<row r="(\d+)"[^>]*\sht="([\d.]+)"/g)) rows.set(Number(m[1]), Number(m[2]))
const TITLE_ROW = 3
check('표지 행 높이를 읽었다(눈멂 가드)', rows.size >= 6, `${rows.size}행`)
const fixedPt = [...rows.entries()].filter(([r]) => r !== TITLE_ROW).reduce((a, [, h]) => a + h, 0)
console.log(`  고정 행 합(제목 제외) = ${fixedPt}pt · 사진 행 = ${rows.get(5)}pt`)
for (const n of [...SHORT_NAMES, ...LONG_NAMES]) {
  const L = coverTitleLayout(titleOf(n))
  const total = fixedPt + L.rowHeightPt
  check(`${n} 표지 합 ${total}pt ≤ ${A4_BODY_PT}pt`, total <= A4_BODY_PT,
    `${total}pt (제목 띠 ${L.rowHeightPt}pt)`)
}
/* 🎯 **최악의 경우**를 표본이 아니라 상한으로 묻는다. 위 일곱 이름은 지금 띠가 214pt까지만
 *   가므로 제동 장치(`MAX_ROW_PT`)에 닿지 않는다 — 표본만 보면 그 값을 600으로 바꿔도 초록이다
 *   (변이 M5가 실제로 살아남아 이 구멍을 알려 줬다). 상한 자체를 예산에 맞대면 그 구멍이 닫힌다:
 *   어떤 이름이 오더라도 띠는 이 값을 못 넘으므로, 이 한 줄이 **전 고객**을 덮는다. */
check(`띠 상한 ${COVER_TITLE_MAX_ROW_PT}pt + 고정 ${fixedPt}pt ≤ ${A4_BODY_PT}pt (최악의 경우)`,
  fixedPt + COVER_TITLE_MAX_ROW_PT <= A4_BODY_PT,
  `${fixedPt + COVER_TITLE_MAX_ROW_PT}pt — 사진을 키웠거나 띠 상한을 올렸다면 둘 중 하나를 되돌릴 것`)

console.log(`\n${fails.length ? '❌' : '✅'} ${pass}/${pass + fails.length}`)
if (fails.length) { console.log(fails.map(f => `   · ${f}`).join('\n')); process.exit(1) }
