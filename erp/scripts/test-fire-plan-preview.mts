/** xlsx 리더·템플릿 캐시 검사 — `src/lib/xlsx-read-sheet.ts`, `src/lib/fire-plan-template-cache.ts`.
 *
 *  이 리더는 서식 미리보기의 **바닥**이다. 여기가 틀리면 미리보기가 실제 엑셀과 다른 그림을
 *  그리는데, 그건 기능이 아니라 **거짓말**이다. 그래서 「그럴듯한가」가 아니라 **두 독립 축**으로
 *  증명한다:
 *
 *   [1] SheetJS 교차검증 — 독립한 다른 파서가 같은 답을 내는가(병합·행높이·열폭·글자)
 *   [2] 라이터 왕복 항등 — `buildXlsx`로 쓴 것을 되읽으면 그대로인가(테두리·채움·정렬 포함)
 *
 *  ⚠ [1]만으로는 부족하다. SheetJS는 **테두리·정렬을 모른다** — 그 축은 [2]만 붙든다.
 *    반대로 [2]만이면 「내 라이터와 내 리더가 같이 틀린」 경우를 못 본다. 둘이 상보적이다.
 *
 *  실행: npx tsx scripts/test-fire-plan-preview.mts
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { readSheetGrid, parseRef, colIndex } from '../src/lib/xlsx-read-sheet.ts'
import { buildXlsx, type BuildSheet, type CellStyle } from '../src/lib/xlsx-build.ts'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'
import { FIRE_PLAN_MANIFEST } from '../src/lib/fire-plan-xlsx-manifest.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const XLSX_PATH = resolve(HERE, '../templates/fire-plan-workbook.xlsx')

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`) }
}

const bytes = new Uint8Array(readFileSync(XLSX_PATH))
const zip = await JSZip.loadAsync(bytes)
const wb = XLSX.read(bytes, { cellStyles: true })

/* ══════════════════════ [0] 눈멂 가드 ══════════════════════
 *  분모부터 세운다. 0장을 훑고 「전건 일치」라 말하면 항진명제다. */
console.log('\n[0] 눈멂 가드 — 분모')
const SHEETS = FIRE_PLAN_MANIFEST.sheets.map(s => s.name)
check('시트 목록이 있다', SHEETS.length === 50, `${SHEETS.length}장`)
check('SheetJS도 같은 시트 수를 본다', wb.SheetNames.length === SHEETS.length,
  `${wb.SheetNames.length}장`)

/* ══════════════════════ [1] 리더 ↔ SheetJS 교차검증 ══════════════════════ */
console.log('\n[1] 리더 ↔ SheetJS — 독립한 두 파서가 같은 답을 내는가')
let cmpCells = 0, cmpMerges = 0, cmpRows = 0, cmpCols = 0
const bad: string[] = []
for (const name of SHEETS) {
  const g = await readSheetGrid(zip, name)
  const ws = wb.Sheets[name]
  if (!ws) { bad.push(`${name}: SheetJS에 시트 없음`); continue }

  // 병합 — 집합으로 비교(순서는 계약이 아니다)
  const mine = new Set(g.merges)
  const theirs = new Set((ws['!merges'] ?? []).map(m =>
    `${XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })}:${XLSX.utils.encode_cell({ r: m.e.r, c: m.e.c })}`))
  if (mine.size !== theirs.size || [...mine].some(x => !theirs.has(x))) {
    bad.push(`${name}: 병합 ${mine.size} vs ${theirs.size}`)
  }
  cmpMerges += mine.size

  // 행 높이
  for (let r = 0; r < g.rows; r++) {
    const theirH = (ws['!rows'] ?? [])[r]?.hpt
    if (theirH === undefined) continue
    if (Math.abs(theirH - g.rowHeights[r]) > 0.05) bad.push(`${name}: 행${r + 1} 높이 ${g.rowHeights[r]} vs ${theirH}`)
    cmpRows++
  }
  // 열 폭
  for (let c = 0; c < g.cols; c++) {
    const theirW = (ws['!cols'] ?? [])[c]?.width
    if (theirW === undefined) continue
    if (Math.abs(theirW - g.colWidths[c]) > 0.02) bad.push(`${name}: 열${c + 1} 폭 ${g.colWidths[c]} vs ${theirW}`)
    cmpCols++
  }
  // 글자
  for (const cell of g.cells) {
    const their = ws[cell.ref]
    const theirText = their?.v === undefined || their?.v === null ? '' : String(their.v)
    if (theirText !== cell.text) bad.push(`${name}!${cell.ref}: '${cell.text}' vs '${theirText}'`)
    cmpCells++
  }
}
check('비교가 실제로 돌았다(0건이면 공허)', cmpCells > 0 && cmpMerges > 0 && cmpRows > 0 && cmpCols > 0,
  `셀 ${cmpCells} · 병합 ${cmpMerges} · 행 ${cmpRows} · 열 ${cmpCols}`)
check('두 파서의 답이 전건 일치', bad.length === 0, bad.slice(0, 6).join(' / '))

/* ══════════════════════ [2] 라이터 ↔ 리더 왕복 항등 ══════════════════════
 *  ⭐ SheetJS가 **모르는 축**(테두리·채움·정렬)은 여기서만 증명된다. */
console.log('\n[2] 라이터 ↔ 리더 왕복 항등 — buildXlsx로 쓴 것을 되읽으면 그대로인가')
const S = (o: Partial<CellStyle>): CellStyle =>
  ({ left: 'none', right: 'none', top: 'none', bottom: 'none', fill: null, align: 'center', ...o })
const fixture: BuildSheet = {
  name: '왕복시험',
  colWidths: [8.5, 12.25, 3],
  rowHeights: [18.5, 33, 0],
  merges: ['A1:B1', 'A3:C3'],
  cells: [
    { row: 0, col: 0, text: '가나다 <&> "따옴표"', style: S({ left: 'thin', right: 'medium', top: 'thick', bottom: 'double', align: 'left' }) },
    // B1 — A1:B1에 **덮이는** 칸. 이게 없으면 covered 단언이 돌 양성 표본이 아예 없다
    { row: 0, col: 1, text: '', style: S({ top: 'thick' }) },
    { row: 0, col: 2, text: '', style: S({ fill: '#4C4C4C' }) },
    { row: 1, col: 0, text: '줄1\n줄2', style: S({ align: 'right', bottom: 'dashed' }) },
    { row: 1, col: 1, text: '☐ 상자', style: S({ fill: '#E0E5FA', left: 'thin', right: 'thin' }) },
    { row: 2, col: 0, text: '병합 셋', style: S({ top: 'thin' }) },
  ],
}
const built = await buildXlsx([fixture])
const rtZip = await JSZip.loadAsync(built.bytes)
const rt = await readSheetGrid(rtZip, '왕복시험')

check('병합이 그대로', rt.merges.join(',') === fixture.merges.join(','), rt.merges.join(','))
check('열 폭이 그대로', rt.colWidths.slice(0, 3).join(',') === '8.5,12.25,3', rt.colWidths.slice(0, 3).join(','))
check('행 높이가 그대로(미지정은 0)', rt.rowHeights.slice(0, 3).join(',') === '18.5,33,0', rt.rowHeights.slice(0, 3).join(','))
let rtBad: string[] = []
for (const want of fixture.cells) {
  const got = rt.cells.find(c => c.row === want.row && c.col === want.col)
  if (!got) { rtBad.push(`${want.row},${want.col} 없음`); continue }
  if (got.text !== want.text) rtBad.push(`${got.ref} 글자 '${got.text}' ≠ '${want.text}'`)
  for (const k of ['left', 'right', 'top', 'bottom', 'fill', 'align'] as const) {
    if (got.style[k] !== want.style[k]) rtBad.push(`${got.ref}.${k} ${String(got.style[k])} ≠ ${String(want.style[k])}`)
  }
}
check('셀 글자·테두리·채움·정렬이 그대로', rtBad.length === 0, rtBad.slice(0, 6).join(' / '))
check('병합 좌상단만 span을 갖는다', rt.cells.find(c => c.ref === 'A1')?.span?.cols === 2
  && rt.cells.find(c => c.ref === 'C1')?.span === null)
// 🚨 **양성·음성 짝으로** 묻는다. 처음엔 좌상단 A3의 `covered===false`만 물었는데, 그건
//    `covered`를 아예 안 세워도 통과한다(변이 M6이 그렇게 뚫었다). 덮인 칸이 실제로 서는지가 양성이다.
check('병합에 덮인 칸은 covered=true (양성)', rt.cells.find(c => c.ref === 'B1')?.covered === true,
  `B1.covered=${rt.cells.find(c => c.ref === 'B1')?.covered}`)
check('병합 좌상단은 covered=false (음성)', rt.cells.find(c => c.ref === 'A1')?.covered === false)
check('병합 밖 칸은 covered=false (음성)', rt.cells.find(c => c.ref === 'C1')?.covered === false)

/* ══════════════════════ [3] 템플릿 캐시 — 공유 바이트가 오염되지 않는가 ══════════════════════
 *  🚨 이게 캐시 도입의 **유일한 진짜 위험**이다. `injectWorkbook`이 원본을 안 건드린다고
 *    주석에 적혀 있지만(`xlsx-inject.ts:210`), **주석은 증거가 아니다**. 해시로 묻는다. */
console.log('\n[3] 공유 템플릿 바이트가 주입 뒤에도 그대로인가')
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const before = sha(bytes)
const injected = await injectWorkbook(bytes, [
  { sheet: SHEETS[2], cell: 'L4', value: '__오염시험__' },
])
check('주입이 실제로 돌았다', injected.missed.length === 0 && injected.bytes.byteLength > 0,
  `미착지 ${injected.missed.length}`)
check('원본 바이트 불변(캐시 공유 안전)', sha(bytes) === before)
check('산출물은 원본과 다르다(주입이 헛돌지 않았다)', sha(injected.bytes) !== before)

/* ══════════════════════ [4] 좌표 유틸 ══════════════════════ */
console.log('\n[4] 좌표 유틸')
check("colIndex('A')=0", colIndex('A') === 0)
check("colIndex('Z')=25", colIndex('Z') === 25)
check("colIndex('AA')=26", colIndex('AA') === 26)
check("colIndex('BH')=59 (60열 격자의 마지막)", colIndex('BH') === 59)
check("parseRef('AB12')", JSON.stringify(parseRef('AB12')) === JSON.stringify({ row: 11, col: 27 }))
let threw = false
try { parseRef('12AB') } catch { threw = true }
check('망가진 참조는 throw(조용한 0 반환 금지)', threw)

/* ══════════════════════ [5] 실제 서식에서 테두리를 정말로 읽는가 ══════════════════════
 *  🚨 [1]은 SheetJS가 모르는 축을 못 본다. 「테두리를 전부 none으로 읽어도」 [1]은 초록이다.
 *    그러니 실제 자산에서 테두리·채움이 **실제로 잡히는지**를 따로 센다. */
console.log('\n[5] 실제 자산에서 테두리·채움이 잡히는가')
const g11 = await readSheetGrid(zip, '1.1 건축물 일반현황')
const bordered = g11.cells.filter(c =>
  c.style.left !== 'none' || c.style.right !== 'none' || c.style.top !== 'none' || c.style.bottom !== 'none')
const filled = g11.cells.filter(c => c.style.fill)
const aligns = new Set(g11.cells.map(c => c.style.align))
check('1.1에 테두리 있는 칸이 있다', bordered.length > 0, `${bordered.length}칸 / 전체 ${g11.cells.length}`)
check('1.1에 채움 있는 칸이 있다', filled.length > 0, `${filled.length}칸`)
check('정렬이 한 값으로 뭉개지지 않았다', aligns.size > 1, [...aligns].join(','))
check('1.1 격자가 60열이다', g11.cols === 60, `${g11.cols}열`)

console.log(`\n=== pass ${pass} / fail ${fail} ===`)
process.exit(fail ? 1 : 0)
