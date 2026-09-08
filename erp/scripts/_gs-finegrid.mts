/** 미세 격자 **자동 생성기** — 손으로 만든 sj 격자를 대체한다 (소방계획서_45 후속 / A안).
 *
 *  왜 자동인가: sj는 사람이 눈대중으로 71열을 그려 서식 1.1 **한 장**만 있다. 95개 표를 그렇게
 *  만들 수는 없고, 눈대중이라 원본 비율과도 어긋난다(실측: 명칭 칸 경계 0.179 vs 원본 0.221).
 *
 *  어떻게: 양식 hwpx의 `columnEdges`(HWPUNIT 절대 경계)를 N등분 격자에 투영한다.
 *    subCol(i) = round(edges[i] / total * N)
 *  N을 키울수록 원본 비율에 가까워진다(양자화 오차 ≤ 1/N). 병합 전용 열(폭 0)도 경계가
 *  겹칠 뿐이라 자연히 처리된다 — D안이 열 **폭**을 쓰다 「3급」을 세로로 깨뜨린 함정을 피한다.
 *
 *  🚨 강순기는 실고객 문서다 — 산출물을 저장소 안에 쓰지 않는다.
 *  실행: npx tsx scripts/_gs-finegrid.mts [표번호]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import { parseTables, columnEdges, rowHeights, hwpToPt, type HwpxTable } from '../src/lib/hwpx-table.ts'
import { readSectionStream, walkRecords, extractTables, calibrateCellOffset, type Hwp5Table } from './hwp5-read.mts'

const HERE = dirname(fileURLToPath(import.meta.url))
const HWPX = resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')
const HWP = resolve(HERE, '../../erp_goal/_doc01/강순기건물 소방계획서 - 25. 01. 15 주윤종.hwp')
const OUT = 'F:\\AI\\sjfire\\_강순기_형식비교\\E_자동미세격자_강순기.xlsx'
const N = 60                       // 미세 격자 열 수 — 양자화 오차 ≤ 1/60 ≈ 1.7%

/* ── 원본 둘 읽기 ── */
const zf = await JSZip.loadAsync(readFileSync(HWPX))
const formTables = parseTables(await zf.file('Contents/section0.xml')!.async('string'))
const { bytes } = readSectionStream(readFileSync(HWP))
const records = walkRecords(bytes)
const cal = calibrateCellOffset(records, formTables.map(t => t.cells.map(c => ({ row: c.row, col: c.col }))))
if (!cal || cal.hitRate < 0.95) throw new Error('좌표 보정 실패')
const fillTables = extractTables(records, cal.offset)
if (fillTables.length !== formTables.length) throw new Error(`표 수 불일치 ${fillTables.length} vs ${formTables.length}`)
console.log(`양식 ${formTables.length}표 · 강순기 ${fillTables.length}표 · 좌표 ${(cal.hitRate * 100).toFixed(1)}%`)

/* ── 격자 투영 ── */
/** 열 폭을 **전 셀로** 푼다.
 *
 *  ⚠ `columnEdges`는 colSpan===1인 셀에서만 폭을 읽는다. 병합 셀만 걸치는 열은 폭이 **0**으로
 *  남고, 그 열만 차지하는 셀은 폭 0이 되어 **통째로 사라진다**(실측: 서식 1.1의 「대상물 급수」와
 *  「연면적」 값 두 칸이 1차에서 빠졌고, 열 폭을 그대로 쓴 판이 급수 값을 세로로 깨뜨린 것도 같은 원인이다).
 *  → 병합 셀의 폭에서 이미 아는 열들을 빼고 **모르는 열에 고르게 나눠준다**. */
function solveWidths(t: HwpxTable): number[] {
  const w = new Array<number>(t.colCnt).fill(0)
  for (const c of t.cells) if (c.colSpan === 1 && c.widthHwp > 0) w[c.col] = Math.max(w[c.col], c.widthHwp)
  // 좁은 폭부터 풀어야 미지수가 적은 식이 먼저 풀린다
  const spans = t.cells.filter(c => c.colSpan > 1 && c.widthHwp > 0).sort((a, b) => a.colSpan - b.colSpan)
  for (let pass = 0; pass < 4; pass++) {
    let changed = false
    for (const c of spans) {
      const cols = Array.from({ length: c.colSpan }, (_, k) => c.col + k).filter(i => i < t.colCnt)
      const unknown = cols.filter(i => w[i] === 0)
      if (!unknown.length) continue
      const known = cols.reduce((a, i) => a + w[i], 0)
      const rest = c.widthHwp - known
      if (rest <= 0) continue
      const each = Math.round(rest / unknown.length)
      for (const i of unknown) w[i] = each
      changed = true
    }
    if (!changed) break
  }
  const zero = w.filter(x => x === 0).length
  if (zero) console.log(`  ⚠ 폭을 못 푼 열 ${zero}개 — 최소 폭으로 둔다`)
  return w.map(x => (x > 0 ? x : 1))
}

function projectCols(t: HwpxTable): number[] {
  const w = solveWidths(t)
  const total = w.reduce((a, b) => a + b, 0) || 1
  const map = [0]
  let acc = 0
  for (let i = 0; i < w.length; i++) { acc += w[i]; map.push(Math.round((acc / total) * N)) }
  // 어떤 열도 0칸이 되어선 안 된다 — 0칸이면 그 열만 차지하는 셀이 사라진다
  for (let i = 1; i < map.length; i++) if (map[i] <= map[i - 1]) map[i] = map[i - 1] + 1
  return map
}

/* ── 텍스트: 강순기 표에서 (row,col)로 집는다 ── */
function textOf(t: Hwp5Table): Map<string, string> {
  const m = new Map<string, string>()
  // ⚠ 공백을 **지우지 않는다**. 1차에서 `replace(/ /g,'')`로 정규화한 것이 그대로 산출물에 나가
  //   건물명·주소의 띄어쓰기가 통째로 사라졌다(「A 건물」→「A건물」). 대조용 정규화를 출력에 쓰면 안 된다.
  for (const c of t.cells) if (c.row !== null && c.col !== null) m.set(`${c.row},${c.col}`, c.text.replace(/\s+/g, ' ').trim())
  return m
}

/* ── OOXML 조각 ── */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const colName = (i: number) => { let s = '', n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 } while (n >= 0); return s }
const addr = (r: number, c: number) => `${colName(c)}${r + 1}`

interface Built { name: string; xml: string }
function buildSheet(form: HwpxTable, fill: Hwp5Table, title: string): Built {
  const map = projectCols(form)
  const heights = rowHeights(form)
  const txt = textOf(fill)

  const merges: string[] = []
  const cellByRow = new Map<number, string[]>()
  const styled = new Set<string>()

  const dropped: string[] = []
  for (const c of form.cells) {
    const c0 = map[c.col], c1 = map[Math.min(c.col + c.colSpan, form.colCnt)] - 1
    if (c1 < c0) {
      // 🚨 여기서 조용히 넘어가면 값이 **소리 없이 사라진다** — 1차에 급수·연면적 값이 그렇게 없어졌다
      dropped.push(`r${c.row}c${c.col}="${(txt.get(`${c.row},${c.col}`) ?? '').slice(0, 12)}"`)
      continue
    }
    const r0 = c.row, r1 = c.row + c.rowSpan - 1
    if (c1 > c0 || r1 > r0) merges.push(`<mergeCell ref="${addr(r0, c0)}:${addr(r1, c1)}"/>`)
    const v = txt.get(`${c.row},${c.col}`) ?? ''
    if (!cellByRow.has(r0)) cellByRow.set(r0, [])
    cellByRow.get(r0)!.push(
      `<c r="${addr(r0, c0)}" s="1"${v ? ` t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>` : '/>'}`)
    styled.add(`${r0},${c0}`)
    // 병합에 덮인 칸도 테두리를 받아야 선이 끊기지 않는다
    for (let r = r0; r <= r1; r++) for (let cc = c0; cc <= c1; cc++) {
      if (r === r0 && cc === c0) continue
      if (!cellByRow.has(r)) cellByRow.set(r, [])
      cellByRow.get(r)!.push(`<c r="${addr(r, cc)}" s="1"/>`)
    }
  }

  if (dropped.length) throw new Error(`표 «${title}»: 격자에 자리가 없어 버려진 셀 ${dropped.length}개 — ${dropped.slice(0, 6).join(' ')}`)

  /* 텍스트 전수 대조 — '몇 개 썼다'가 아니라 '원문의 글자가 전부 실렸는가'를 본다 */
  const wrote = new Set<string>()
  for (const c of form.cells) { const v = txt.get(`${c.row},${c.col}`); if (v) wrote.add(v) }
  const missing = [...new Set([...txt.values()].filter(Boolean))].filter(v => !wrote.has(v))
  if (missing.length) throw new Error(`표 «${title}»: 원문 글자 ${missing.length}개가 격자에 자리가 없다 — ${missing.slice(0, 5).join(' | ')}`)

  const rowsXml = [...cellByRow.keys()].sort((a, b) => a - b).map(r => {
    const cells = cellByRow.get(r)!
      .sort((a, b) => {
        const ca = a.match(/r="([A-Z]+)/)![1], cb = b.match(/r="([A-Z]+)/)![1]
        return ca.length - cb.length || ca.localeCompare(cb)
      })
    const ht = heights[r] ? ` ht="${Math.max(12, hwpToPt(heights[r])).toFixed(1)}" customHeight="1"` : ''
    return `<row r="${r + 1}"${ht}>${cells.join('')}</row>`
  }).join('')

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${addr(form.rowCnt - 1, N - 1)}"/>
<sheetViews><sheetView workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="13.5"/>
<cols><col min="1" max="${N}" width="2.2" customWidth="1"/></cols>
<sheetData>${rowsXml}</sheetData>
${merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : ''}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>
</worksheet>`
  return { name: title, xml }
}

/* ── 대상 표 고르기 ── */
const arg = process.argv[2]
const targets = arg === 'all'
  ? formTables.map((_, i) => i)
  : arg
    ? [Number(arg)]
    : [formTables.findIndex(t => t.cells.some(c => c.text.replace(/\s/g, '').includes('도로명주소')))]

/** 시트 이름 — 표 안/앞의 「서식 N.N」 배너를 찾아 쓰고, 없으면 표번호. 엑셀 31자 제한·중복 회피 */
const used = new Set<string>()
function sheetName(i: number): string {
  const first = formTables[i].cells.map(c => c.text.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const banner = first.map(v => v.match(/서식\s*([\d.]+)/)?.[1]).find(Boolean)
    ?? formTables[Math.max(0, i - 1)].cells.map(c => c.text.match(/서식\s*([\d.]+)/)?.[1]).find(Boolean)
  let base = banner ? `${banner} (표${i})` : `표${i}`
  base = base.replace(/[\\/?*[\]:]/g, '').slice(0, 31)
  let n = base, k = 2
  while (used.has(n)) { n = `${base.slice(0, 28)}_${k++}` }
  used.add(n)
  return n
}

const sheets: Built[] = []
const failed: string[] = []
for (const i of targets) {
  try {
    sheets.push(buildSheet(formTables[i], fillTables[i], sheetName(i)))
  } catch (e) {
    failed.push(`표#${i} (${formTables[i].rowCnt}x${formTables[i].colCnt}): ${(e as Error).message.split('\n')[0]}`)
  }
}
console.log(`\n생성 ${sheets.length}/${targets.length} 시트 · 실패 ${failed.length}`)
if (failed.length) console.log('실패 목록:\n' + failed.map(f => '  ' + f).join('\n'))
if (!sheets.length) { console.log('만들 시트가 없다 — 파일을 쓰지 않는다'); process.exit(1) }

/* ── 최소 xlsx 조립 ── */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font><sz val="9"/><name val="맑은 고딕"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="표준" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

const zip = new JSZip()
zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`)
zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`)
zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)
zip.file('xl/styles.xml', STYLES)
sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, s.xml))

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
console.log(`\n✅ → ${OUT}`)
