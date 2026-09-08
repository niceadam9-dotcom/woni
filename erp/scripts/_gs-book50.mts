/** 강순기 소방계획서 → **50시트·시트당 1인쇄쪽** 엑셀 (미세 격자).
 *
 *  · 95표 → 50시트 묶음은 `fire-plan-xlsx-manifest.json`의 검증된 지도를 **읽어 쓴다**(다시 정하지 않는다).
 *    머리띠 표(1행)는 따로 두지 않고 본문 시트의 **제목 행**으로 올린다 — 사용자 확정.
 *  · 격자는 표마다 `columnEdges`를 N등분에 투영한다. 한 시트에 열 수가 다른 표가 섞여도(2.4 개별임무카드
 *    6장, 2.3 조직도) 각자 투영되므로 문제가 없다 — 성긴 격자였다면 열 경계 합집합으로 쪼개졌을 자리다.
 *  · 인쇄: `fitToWidth=1 fitToHeight=1` → **시트 = 정확히 1쪽**. 판정축은 PDF 쪽수 == 50이다.
 *
 *  🚨 강순기는 실고객 문서다 — 산출물을 저장소 안에 쓰지 않는다.
 *  실행: npx tsx scripts/_gs-book50.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import { parseTables, columnEdges, rowHeights, hwpToPt, type HwpxTable } from '../src/lib/hwpx-table.ts'
import { readSectionStream, walkRecords, extractTables, calibrateCellOffset, type Hwp5Table } from './hwp5-read.mts'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = 'F:\\AI\\sjfire\\_강순기_형식비교\\강순기_소방계획서_50쪽.xlsx'
const N = 60                       // 미세 격자 열 수

/* ── 원본 ── */
const zf = await JSZip.loadAsync(readFileSync(resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')))
const form = parseTables(await zf.file('Contents/section0.xml')!.async('string'))
const { bytes } = readSectionStream(readFileSync(resolve(HERE, '../../erp_goal/_doc01/강순기건물 소방계획서 - 25. 01. 15 주윤종.hwp')))
const rec = walkRecords(bytes)
const cal = calibrateCellOffset(rec, form.map(t => t.cells.map(c => ({ row: c.row, col: c.col }))))
if (!cal || cal.hitRate < 0.95) throw new Error('좌표 보정 실패')
const fill = extractTables(rec, cal.offset)
if (fill.length !== form.length) throw new Error(`표 수 불일치 ${fill.length} vs ${form.length}`)

interface MSheet { name: string; no: string | null; tables: number[]; rows: number; cols: number; bannerRows: number[]; gridTops: { table: number; top: number; rows: number }[] }
const manifest = JSON.parse(readFileSync(resolve(HERE, '../src/lib/fire-plan-xlsx-manifest.json'), 'utf8')) as { sheets: MSheet[] }
console.log(`양식 ${form.length}표 · 강순기 ${fill.length}표 · 좌표 ${(cal.hitRate * 100).toFixed(1)}% · 매니페스트 ${manifest.sheets.length}시트`)

/* ── 열 폭 풀기 (병합 셀에서 역산 — columnEdges의 폭 0 열 문제) ── */
function solveWidths(t: HwpxTable): number[] {
  const w = new Array<number>(t.colCnt).fill(0)
  for (const c of t.cells) if (c.colSpan === 1 && c.widthHwp > 0) w[c.col] = Math.max(w[c.col], c.widthHwp)
  const spans = t.cells.filter(c => c.colSpan > 1 && c.widthHwp > 0).sort((a, b) => a.colSpan - b.colSpan)
  for (let p = 0; p < 4; p++) {
    let changed = false
    for (const c of spans) {
      const cols = Array.from({ length: c.colSpan }, (_, k) => c.col + k).filter(i => i < t.colCnt)
      const unknown = cols.filter(i => w[i] === 0)
      if (!unknown.length) continue
      const rest = c.widthHwp - cols.reduce((a, i) => a + w[i], 0)
      if (rest <= 0) continue
      const each = Math.round(rest / unknown.length)
      for (const i of unknown) w[i] = each
      changed = true
    }
    if (!changed) break
  }
  return w.map(x => (x > 0 ? x : 1))
}
function projectCols(t: HwpxTable): number[] {
  const w = solveWidths(t)
  const total = w.reduce((a, b) => a + b, 0) || 1
  const map = [0]
  let acc = 0
  for (const x of w) { acc += x; map.push(Math.round((acc / total) * N)) }
  for (let i = 1; i < map.length; i++) if (map[i] <= map[i - 1]) map[i] = map[i - 1] + 1
  return map
}
/** ⚠ 공백을 지우지 않는다 — 대조용 정규화를 출력에 쓰면 건물명·주소의 띄어쓰기가 통째로 사라진다 */
const textOf = (t: Hwp5Table) => {
  const m = new Map<string, string>()
  for (const c of t.cells) if (c.row !== null && c.col !== null) m.set(`${c.row},${c.col}`, c.text.replace(/\s+/g, ' ').trim())
  return m
}

/* ── OOXML ── */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const colName = (i: number) => { let s = '', n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 } while (n >= 0); return s }
const addr = (r: number, c: number) => `${colName(c)}${r + 1}`

const STYLE_BODY = 1, STYLE_BANNER = 2

function buildSheet(ms: MSheet) {
  /* 표별 시작 행.
   *  ⚠ 머리띠 행은 **`bannerRows`가 알려준다** — 0부터 채우면 안 된다. 표지는 gridTops가 0행이고
   *    머리띠가 2행이라, 0부터 채우자 머리띠가 본문을 덮어 「☐ 근린생활시설」이 사라졌다.
   *  ⚠ 머리띠 표가 여러 행일 수 있다(2.3 조직도의 머리 블록 #50은 3x2). 그 경우 행을 그대로
   *    펼치면 중첩 격자표와 겹친다 → 글자를 **한 줄로 모아** 제목 띠로 얹는다(글자를 잃지 않는다). */
  const topOf = new Map<number, number>()
  for (const g of ms.gridTops ?? []) topOf.set(g.table, g.top)
  const bannerTables = ms.tables.filter(t => !topOf.has(t))
  const bannerRowList = (ms.bannerRows ?? []).slice()
  bannerTables.forEach((t, i) => topOf.set(t, bannerRowList[i] ?? (bannerRowList[bannerRowList.length - 1] ?? 0)))

  const merges: string[] = []
  const byRow = new Map<number, Map<number, string>>()   // row → col → cell xml
  const heightAt = new Map<number, number>()
  const dropped: string[] = []
  const wroteText = new Set<string>()
  const wantText = new Set<string>()

  const put = (r: number, c: number, xml: string) => {
    if (!byRow.has(r)) byRow.set(r, new Map())
    byRow.get(r)!.set(c, xml)
  }

  for (const ti of ms.tables) {
    const ft = form[ti], xt = fill[ti]
    const top = topOf.get(ti)!
    const isBanner = !(ms.gridTops ?? []).some(g => g.table === ti)
    const map = projectCols(ft)
    const txt = textOf(xt)
    const hs = rowHeights(ft)
    for (const v of txt.values()) if (v) wantText.add(v)

    /* ⚠ 1행짜리 머리띠는 **칸을 그대로 둔다** — 「서식 1.1」과 「건축물 일반현황」은 원본에서 두 칸이고,
     *   합치면 그 구조가 깨진다(합쳤다가 검증이 73개를 '누락'으로 잡았다).
     *   여러 행짜리 머리 블록(2.3 조직도의 #50 3x2)만 한 줄로 모은다 — 안 그러면 중첩 격자와 겹친다. */
    if (isBanner && ft.rowCnt > 1) {
      const parts = ft.cells
        .slice().sort((a, b) => a.row - b.row || a.col - b.col)
        .map(c => txt.get(`${c.row},${c.col}`) ?? '').filter(Boolean)
      for (const p of parts) wroteText.add(p)
      const line = parts.join('   ')
      merges.push(`<mergeCell ref="${addr(top, 0)}:${addr(top, N - 1)}"/>`)
      put(top, 0, `<c r="${addr(top, 0)}" s="${STYLE_BANNER}"${line ? ` t="inlineStr"><is><t xml:space="preserve">${esc(line)}</t></is></c>` : '/>'}`)
      for (let cc = 1; cc < N; cc++) put(top, cc, `<c r="${addr(top, cc)}" s="${STYLE_BANNER}"/>`)
      heightAt.set(top, Math.max(heightAt.get(top) ?? 0, 20))
      continue
    }

    for (const c of ft.cells) {
      const c0 = map[c.col], c1 = map[Math.min(c.col + c.colSpan, ft.colCnt)] - 1
      const r0 = top + c.row, r1 = top + c.row + c.rowSpan - 1
      if (c1 < c0) { dropped.push(`표#${ti} r${c.row}c${c.col}="${(txt.get(`${c.row},${c.col}`) ?? '').slice(0, 12)}"`); continue }
      const v = txt.get(`${c.row},${c.col}`) ?? ''
      if (v) wroteText.add(v)
      const st = isBanner ? STYLE_BANNER : STYLE_BODY
      if (c1 > c0 || r1 > r0) merges.push(`<mergeCell ref="${addr(r0, c0)}:${addr(r1, c1)}"/>`)
      put(r0, c0, `<c r="${addr(r0, c0)}" s="${st}"${v ? ` t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>` : '/>'}`)
      for (let r = r0; r <= r1; r++) for (let cc = c0; cc <= c1; cc++) {
        if (r === r0 && cc === c0) continue
        put(r, cc, `<c r="${addr(r, cc)}" s="${st}"/>`)
      }
    }
    for (let i = 0; i < hs.length; i++) if (hs[i]) heightAt.set(top + i, Math.max(11, hwpToPt(hs[i])))
  }

  if (dropped.length) throw new Error(`«${ms.name}»: 격자에 자리가 없어 버려진 셀 ${dropped.length}개 — ${dropped.slice(0, 4).join(' ')}`)
  const missing = [...wantText].filter(v => !wroteText.has(v))
  if (missing.length) throw new Error(`«${ms.name}»: 원문 글자 ${missing.length}개 누락 — ${missing.slice(0, 4).join(' | ')}`)

  const maxRow = Math.max(...byRow.keys())
  const rowsXml = [...byRow.keys()].sort((a, b) => a - b).map(r => {
    const cells = [...byRow.get(r)!.entries()].sort((a, b) => a[0] - b[0]).map(x => x[1]).join('')
    const h = heightAt.get(r)
    return `<row r="${r + 1}"${h ? ` ht="${h.toFixed(1)}" customHeight="1"` : ''}>${cells}</row>`
  }).join('')

  /* 넓은 표는 가로로 — 세로로 1쪽에 욱여넣으면 글자가 읽을 수 없이 작아진다 */
  const wide = ms.cols >= 14
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${addr(maxRow, N - 1)}"/>
<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="13.5"/>
<cols><col min="1" max="${N}" width="2.2" customWidth="1"/></cols>
<sheetData>${rowsXml}</sheetData>
${merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : ''}
<printOptions horizontalCentered="1"/>
<pageMargins left="0.35" right="0.35" top="0.45" bottom="0.45" header="0.2" footer="0.2"/>
<pageSetup paperSize="9" orientation="${wide ? 'landscape' : 'portrait'}" scale="100" fitToWidth="1" fitToHeight="1"/>
</worksheet>`
  return { name: ms.name, xml, wide }
}

/* ── 시트 이름: 엑셀 제한(31자·중복·금지문자) ── */
const used = new Set<string>()
const safeName = (raw: string) => {
  let n = raw.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31)
  let k = 2
  while (used.has(n)) n = `${n.slice(0, 28)}_${k++}`
  used.add(n)
  return n
}

const built: { name: string; xml: string; wide: boolean }[] = []
const failed: string[] = []
for (const ms of manifest.sheets) {
  try {
    const s = buildSheet(ms)
    built.push({ ...s, name: safeName(s.name) })
  } catch (e) { failed.push((e as Error).message.split('\n')[0]) }
}
console.log(`\n시트 ${built.length}/${manifest.sheets.length} · 실패 ${failed.length}${failed.length ? '\n  ' + failed.join('\n  ') : ''}`)
console.log(`가로 방향 ${built.filter(b => b.wide).length}장 · 세로 ${built.filter(b => !b.wide).length}장`)
if (built.length !== manifest.sheets.length) { console.log('전건이 아니면 쓰지 않는다'); process.exit(1) }

/* ── 조립 ── */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="9"/><name val="맑은 고딕"/></font><font><sz val="12"/><b/><name val="맑은 고딕"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
</cellXfs><cellStyles count="1"><cellStyle name="표준" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

const zip = new JSZip()
zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${built.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`)
zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${built.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`)
zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${built.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${built.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)
zip.file('xl/styles.xml', STYLES)
built.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, s.xml))

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
console.log(`\n✅ ${built.length}시트 → ${OUT}`)
console.log('   판정: PDF로 변환해 **쪽수 == 50** 이면 「시트당 1쪽」이 지켜진 것이다')
