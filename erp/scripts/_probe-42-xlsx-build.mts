/** 소방계획서_42 S2 프로브 — 격자→xlsx 조립기가 injectWorkbook과 맞물리는지 검사한다.
 *
 *  핵심 질문은 "파일이 만들어지는가"가 아니라 **"런타임 패처가 이 파일에 값을 넣을 수 있는가"** 다.
 *  빌더와 패처가 서로 다른 셀 모양을 전제하면 주입이 `missed`로 조용히 흘러나간다.
 *
 *  실행: npx tsx scripts/_probe-42-xlsx-build.mts
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import {
  parseTables, parseBorderFills, columnEdges, rowHeights,
  hwpToPt, hwpToPx, pxToColWidth, type HwpxTable, type HwpxBorderFill,
} from '../src/lib/hwpx-table.ts'
import { buildXlsx, cellRef, sanitizeSheetName, type BuildSheet, type BuildCell } from '../src/lib/xlsx-build.ts'
import { injectWorkbook, sheetFileMap } from '../src/lib/xlsx-inject.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const HWPX = resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`) }
}

/** hwpx 표 → BuildSheet.
 *  ⚠ 병합 셀을 **덮인 칸까지 펼친다** — hwpx는 좌상단 한 칸만 주지만 xlsx에서 테두리는
 *    구성 셀들의 바깥 변에서 나오므로, 덮인 칸을 안 만들면 병합 영역 테두리가 빠진다. */
function toSheet(t: HwpxTable, fills: Map<number, HwpxBorderFill>, name: string): BuildSheet {
  const edges = columnEdges(t)
  const colWidths = Array.from({ length: t.colCnt }, (_, i) =>
    pxToColWidth(hwpToPx(edges[i + 1] - edges[i])))
  const heights = rowHeights(t).map(hwpToPt)

  const cells: BuildCell[] = []
  const merges: string[] = []
  for (const c of t.cells) {
    const bf = fills.get(c.borderFillId)
    const style = {
      left: bf?.left ?? 'none', right: bf?.right ?? 'none',
      top: bf?.top ?? 'none', bottom: bf?.bottom ?? 'none',
      fill: bf?.faceColor ?? null,
      align: 'center',
    } as BuildCell['style']

    cells.push({ row: c.row, col: c.col, text: c.text, style })
    if (c.rowSpan > 1 || c.colSpan > 1) {
      merges.push(`${cellRef(c.row, c.col)}:${cellRef(c.row + c.rowSpan - 1, c.col + c.colSpan - 1)}`)
      for (let r = c.row; r < c.row + c.rowSpan; r++) {
        for (let k = c.col; k < c.col + c.colSpan; k++) {
          if (r === c.row && k === c.col) continue
          cells.push({ row: r, col: k, text: '', style })
        }
      }
    }
  }
  return { name, colWidths, rowHeights: heights, cells, merges }
}

const zipIn = await JSZip.loadAsync(readFileSync(HWPX))
const sectionXml = await zipIn.file('Contents/section0.xml')!.async('string')
const headerXml = await zipIn.file('Contents/header.xml')!.async('string')
const tables = parseTables(sectionXml)
const { fills } = parseBorderFills(headerXml)

// 1단계 범위(제1장)에 해당하는 앞 24표 전부 — 좁은 표(2x4)부터 26x23까지 실제 분포를 그대로 태운다.
// ⚠ 처음엔 6개만 골랐는데 글자 분모가 277이었다. 임계값을 277에 맞춰 내리는 건 결과에 잣대를
//   맞추는 것이라, 대신 표본을 늘려 분모를 실제로 키웠다.
const picks = Array.from({ length: Math.min(24, tables.length) }, (_, i) => i)
const sheets = picks.map((i, n) => toSheet(tables[i], fills, sanitizeSheetName(`T${i}`, `표본${n}`)))

console.log('\n[1] 입력 표본')
for (const [n, i] of picks.entries()) {
  console.log(`       #${i} ${tables[i].rowCnt}x${tables[i].colCnt} → 시트 "${sheets[n].name}" cells=${sheets[n].cells.length} merges=${sheets[n].merges.length}`)
}
check('표본을 하나라도 잡았다', sheets.length > 0, `${sheets.length}시트`)
const totalCells = sheets.reduce((s, x) => s + x.cells.length, 0)
check('셀이 0이 아니다(눈멂 가드)', totalCells > 0, `${totalCells}칸`)

console.log('\n[2] 조립')
const built = await buildXlsx(sheets)
check('바이트 생성', built.bytes.length > 0, `${built.bytes.length} bytes`)
check('스타일 중복 제거가 먹었다(고유 xf < 전체 셀)', built.styleCount < totalCells,
  `xf ${built.styleCount} vs cells ${totalCells}`)

console.log('\n[3] 구조 불변식 — 만들지 않기로 한 것들')
const z = await JSZip.loadAsync(built.bytes)
const names = Object.keys(z.files)
check('sharedStrings.xml 없음(고아 si PII 사고를 구조로 차단)', !names.includes('xl/sharedStrings.xml'))
check('xl/media 없음(이미지 0)', !names.some(n => n.startsWith('xl/media/')))
let formulaCount = 0
for (const n of names.filter(n => /^xl\/worksheets\/.*\.xml$/.test(n))) {
  formulaCount += ((await z.file(n)!.async('string')).match(/<f[\s>]/g) ?? []).length
}
check('수식 0개', formulaCount === 0, `<f> ${formulaCount}개`)

console.log('\n[4] injectWorkbook 계약 — 패처가 이 파일을 읽고 쓸 수 있는가')
const map = await sheetFileMap(z)
check('sheetFileMap이 전 시트를 찾는다', map.size === sheets.length,
  `${map.size}/${sheets.length} — ${[...map.keys()].join(', ')}`)

// 값이 있던 칸과 비어 있던 칸 양쪽에 주입한다(자기닫힘 셀도 받아야 한다)
const s0 = sheets[0]
const filled = s0.cells.find(c => c.text)!
const empty = s0.cells.find(c => !c.text)!
const targets = [
  { sheet: s0.name, cell: cellRef(filled.row, filled.col), value: '주입-값있던칸' },
  { sheet: s0.name, cell: cellRef(empty.row, empty.col), value: '주입-빈칸' },
  { sheet: s0.name, cell: cellRef(filled.row, filled.col + 1), value: null },
]
const inj = await injectWorkbook(built.bytes, targets)
check('missed 0 — 전 대상 착지', inj.missed.length === 0, inj.missed.join(',') || 'none')
check('전파 0 — 수식이 없으므로 폐포도 없다', inj.propagated === 0, `${inj.propagated}`)
check('touched = 직접 대상 수', inj.touched.length === targets.length, `${inj.touched.length}`)

const z2 = await JSZip.loadAsync(inj.bytes)
const sx = await z2.file(map.get(s0.name)!)!.async('string')
check('값있던 칸이 교체됐다', sx.includes('주입-값있던칸'))
check('빈 칸(자기닫힘)에도 값이 들어갔다', sx.includes('주입-빈칸'))

console.log('\n[5] SheetJS 되읽기 — 병합·시트가 살아남는가')
const wb = XLSX.read(inj.bytes, { cellStyles: false })
check('시트 수 보존', wb.SheetNames.length === sheets.length, `${wb.SheetNames.length}`)
const wantMerges = sheets.reduce((s, x) => s + x.merges.length, 0)
const gotMerges = wb.SheetNames.reduce((s, n) => s + ((wb.Sheets[n]!['!merges'] as unknown[] | undefined)?.length ?? 0), 0)
check('병합 총수 보존', gotMerges === wantMerges, `${gotMerges}/${wantMerges}`)
const ws0 = wb.Sheets[wb.SheetNames[0]]!
const injected = ws0[cellRef(filled.row, filled.col)] as { v?: unknown } | undefined
check('되읽기에서 주입값이 보인다', injected?.v === '주입-값있던칸', String(injected?.v))

console.log('\n[6] 원본 대조 — 텍스트가 제자리에 보존됐는가 (전 표본)')
// ⚠ 처음엔 표 #0 하나만 봤는데 분모가 2였다 — 2/2 초록은 아무것도 보증하지 않는다.
//   전 표본으로 넓혀 분모를 키운다.
const cleanWb = XLSX.read(built.bytes, { cellStyles: false })
let want = 0, got = 0
const mismatches: string[] = []
picks.forEach((ti, n) => {
  const t = tables[ti]
  const ws = cleanWb.Sheets[sheets[n].name]!
  for (const c of t.cells) {
    if (!c.text.trim()) continue
    want++
    const cell = ws[cellRef(c.row, c.col)] as { v?: unknown } | undefined
    if (String(cell?.v ?? '').trim() === c.text.trim()) got++
    else if (mismatches.length < 6) mismatches.push(`#${ti} ${cellRef(c.row, c.col)} 기대=${JSON.stringify(c.text.slice(0, 20))} 실제=${JSON.stringify(String(cell?.v ?? '').slice(0, 20))}`)
  }
})
check('분모가 충분한가(글자 든 칸 ≥ 300)', want >= 300, `${want}칸`)
check('원본 텍스트 전건이 제자리에 있다', got === want, `${got}/${want}`)
for (const m of mismatches) console.log(`       ${m}`)

console.log('\n[7] LibreOffice 실개봉 — 파일이 정말 열리는가')
// ⚠ 프로필 격리 필수 — 공유 트리에 타 세션이 있고 LO는 프로필 락이 하나라 겹치면 ETIMEDOUT
const SOFFICE = 'C:/Program Files/LibreOffice/program/soffice.com'
if (!existsSync(SOFFICE)) {
  console.log('       (soffice 없음 — 건너뜀)')
} else {
  const tmp = mkdtempSync(join(tmpdir(), 'p42-'))
  const xlsxPath = join(tmp, 'probe.xlsx')
  writeFileSync(xlsxPath, built.bytes)
  const r = spawnSync(SOFFICE, [
    `-env:UserInstallation=file:///${join(tmp, 'loprofile').replace(/\\/g, '/')}`,
    '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', tmp, xlsxPath,
  ], { encoding: 'utf8', timeout: 180_000 })
  const pdf = join(tmp, 'probe.pdf')
  check('LibreOffice가 오류 없이 변환', r.status === 0, `exit=${r.status} ${(r.stderr ?? '').slice(0, 120)}`)
  check('PDF가 생성됐다(=파일이 열렸다)', existsSync(pdf),
    existsSync(pdf) ? `${statSync(pdf).size} bytes` : '없음')
  console.log(`       tmp: ${tmp}`)
}

console.log(`\n=== pass ${pass} / fail ${fail} ===`)
process.exit(fail ? 1 : 0)
