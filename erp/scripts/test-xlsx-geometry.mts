/** 격자 → px 환산의 **정답지 검사** — `xlsx-geometry`가 Excel과 같은 값을 내는가.
 *
 *  ## 왜 이 파일이 따로 있어야 하는가
 *
 *  그림 배치 검사(`test-fire-plan-images`)는 기대값을 **제품과 같은 환산 함수**로 만든다.
 *  그래서 그 함수가 틀리면 제품과 검사가 **함께** 틀려 늘 「일관」이고, 실제로 2026-09-21까지
 *  표지 사진이 160px 밀려 나가는 동안 「그림이 상자 안에서 가운데」가 초록이었다
 *  (변이 M1~M3이 전부 생존해 그 눈멂을 실증했다).
 *
 *  ⭐ 그래서 여기는 **산식 밖의 기준**을 쓴다: Excel이 직접 답한 값이다.
 *    `_probe-excel-colpx.mts`로 실제 Excel에 물어 받은 실측치를 아래에 박아 둔다.
 *
 *      표지 A5:BH5 = 585pt = **780px** (Excel COM `Range.Width`, 2026-09-21)
 *      한 열(XML width 1.80) = 9.75pt = **13px**
 *      행 5 = 399.75pt = **533px**
 *
 *    옛 산식 `round(w*7+5)`는 같은 XML에서 열당 18px·상자 1080px을 냈다 — **+300px**.
 *
 *  🚨 **입력 눈금을 헷갈리지 말 것.** Excel의 `ColumnWidth`(1.14)와 시트 XML의 `width`(1.80)는
 *    다른 값이다 — XML 쪽이 칸 안쪽 여백을 품는다. 제품은 XML을 읽으므로 환산에도 XML 값을 넣는다.
 *    옛 결함의 정체가 바로 이것이다: `w*7+5`는 ColumnWidth 의미의 식인데 XML 값에 먹여
 *    **여백을 두 번** 더했다.
 *
 *  실행: npx tsx scripts/test-xlsx-geometry.mts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import { colWidthToPx, rowHeightToPx } from '../src/lib/xlsx-geometry.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/** Excel COM 실측 정답지 — `_probe-excel-colpx.mts`가 준 값. 바꾸려면 **다시 물어보고** 바꿀 것. */
const EXCEL = {
  colXmlWidth: 1.8,
  colPx: 13,
  coverBoxCols: 60,
  coverBoxPx: 780,
  photoRowPt: 400,   // 템플릿 값(Excel은 399.75로 되읽는다 — 부동소수 왕복)
  photoRowPx: 533,
}

let pass = 0
const fails: string[] = []
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✔ ${name}`) }
  else { fails.push(name); console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('① Excel 실측 정답지와 대조')
check(`열 폭 ${EXCEL.colXmlWidth}자 → ${EXCEL.colPx}px`,
  colWidthToPx(EXCEL.colXmlWidth) === EXCEL.colPx, `${colWidthToPx(EXCEL.colXmlWidth)}px`)
check(`${EXCEL.coverBoxCols}열 상자 → ${EXCEL.coverBoxPx}px`,
  colWidthToPx(EXCEL.colXmlWidth) * EXCEL.coverBoxCols === EXCEL.coverBoxPx,
  `${colWidthToPx(EXCEL.colXmlWidth) * EXCEL.coverBoxCols}px`)
check(`행 ${EXCEL.photoRowPt}pt → ${EXCEL.photoRowPx}px`,
  rowHeightToPx(EXCEL.photoRowPt) === EXCEL.photoRowPx, `${rowHeightToPx(EXCEL.photoRowPt)}px`)

// 🎯 음성 — 옛 산식이 **되살아나면** 잡는다. 이 한 줄이 되돌림을 막는 자물쇠다.
console.log('\n② 옛 산식 부활 차단')
const old = Math.round(EXCEL.colXmlWidth * 7 + 5)
check(`옛 산식(${old}px)과 달라야 한다`, colWidthToPx(EXCEL.colXmlWidth) !== old,
  `지금 ${colWidthToPx(EXCEL.colXmlWidth)}px · 옛 ${old}px`)

/* ③ 템플릿이 그 전제 위에 서 있는가 — 열 폭이 바뀌면 위 정답지를 다시 받아야 한다 */
console.log('\n③ 전제 — 템플릿 격자가 정답지와 같은가')
const zip = await JSZip.loadAsync(readFileSync(resolve(ROOT, 'templates/fire-plan-workbook.xlsx')))
const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
const widths = [...sheet.matchAll(/<col min="(\d+)" max="(\d+)" width="([\d.]+)"/g)]
const distinct = [...new Set(widths.map(m => Number(m[3])))]
check('표지 열 폭이 한 가지', distinct.length === 1, distinct.join('/'))
check(`그 값이 ${EXCEL.colXmlWidth}자 (다르면 Excel에 다시 물을 것)`,
  distinct[0] === EXCEL.colXmlWidth, `${distinct[0]}자`)
const nCols = widths.reduce((a, m) => a + (Number(m[2]) - Number(m[1]) + 1), 0)
check(`열 수 ${EXCEL.coverBoxCols}`, nCols === EXCEL.coverBoxCols, `${nCols}열`)

console.log(`\n${fails.length ? '❌' : '✅'} ${pass}/${pass + fails.length}`)
if (fails.length) { console.log(fails.map(f => `   · ${f}`).join('\n')); process.exit(1) }
