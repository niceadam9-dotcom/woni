/** 격자 → xlsx 조립기 — 소방계획서_42 S2.
 *
 *  hwpx 파서(`hwpx-table.ts`)가 뽑은 격자를 **생 XML**로 써서 JSZip으로 묶는다.
 *
 *  ⚠ SheetJS(`XLSX.write`)를 쓰지 않는다 — 갑지에서 셀 11,138 → 1,977로 서식이 전멸했다
 *    (`xlsx-inject.ts` 머리주석). 여기는 파일을 **만드는** 쪽이라 더 강한 이유가 있다:
 *    `<mergeCells>`·`<cols>`·`styles.xml`·`<pageSetup>`을 전부 통제해야 하고, 런타임 패처
 *    `injectWorkbook`이 기대하는 셀 모양과 **정확히** 일치시켜야 한다.
 *
 *  injectWorkbook과의 계약 3가지(`xlsx-inject.ts` 실측):
 *   ① `setCell`의 정규식이 `<c r="A1"([^>]*?)(?:/>|>…</c>)` 이므로 **빈 셀은 자기닫힘**으로 쓰고
 *     스타일 `s=`를 속성에 남긴다. 그래야 주입이 서식을 보존한 채 값만 갈아끼운다.
 *   ② `sheetFileMap`이 `<sheet name="…" r:id="…"/>`(이 순서)와 `Relationship Id/Target`을
 *     정규식으로 읽는다 — workbook.xml·rels를 그 모양으로 낸다.
 *   ③ `escXml`은 **import해서 쓴다**. 그 함수의 제어문자·고아 서로게이트 규약이 실사고 3건에서
 *     왔고, 두 벌로 두면 한쪽만 낡는다(그 파일 주석의 명시적 지시).
 *
 *  ⭐ **sharedStrings.xml을 만들지 않는다** — 글자는 전부 inlineStr로 셀 안에 넣는다.
 *    소방계획서_27에서 **고아 sharedStrings**가 직원 실명·자격번호를 전 산출물에 실어 날랐다
 *    (셀이 덮여도 참조 0인 si가 파트 바이트에 남아 압축만 풀면 읽혔다). 그 파트를 아예 만들지
 *    않으면 그 사고가 **구조적으로 불가능**해진다 — 내용이 아니라 구조로 닫는다.
 *
 *  ⭐ **수식을 하나도 쓰지 않는다**(`<f>` 0개). 갑지를 괴롭힌 결함군 — 캐시 전파, 낡은 캐시,
 *    `keepFormulaWhenEmpty`, LibreOffice 재계산 무시(D-9) — 이 전부가 수식에서 나온다.
 *    수식이 없으면 `buildRefGraph`가 간선을 0개 찾고 전파가 일어나지 않는다.
 */
import JSZip from 'jszip'
import { escXml } from '@/lib/xlsx-inject'
import type { BorderKind } from '@/lib/hwpx-table'

export interface CellStyle {
  left: BorderKind
  right: BorderKind
  top: BorderKind
  bottom: BorderKind
  /** '#RRGGBB' — 채움 없으면 null */
  fill: string | null
  /** 가운데 정렬 여부(라벨 칸). false면 왼쪽 */
  center: boolean
}

export interface BuildCell {
  /** 0-based */
  row: number
  col: number
  /** 빈 문자열이면 값 없는 셀(자기닫힘)로 쓴다 */
  text: string
  style: CellStyle
}

export interface BuildSheet {
  name: string
  /** 열 너비(Excel 문자폭 단위). 길이 = 열 수 */
  colWidths: number[]
  /** 행 높이(pt). 길이 = 행 수 */
  rowHeights: number[]
  cells: BuildCell[]
  /** 'A1:B2' 형식 */
  merges: string[]
}

/* ────────────────────────── 좌표 ────────────────────────── */

/** 0-based 열 번호 → 'A','B',…,'AA' */
export function colName(col: number): string {
  let s = ''
  let n = col + 1
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** 0-based (row,col) → 'A1' */
export function cellRef(row: number, col: number): string {
  return `${colName(col)}${row + 1}`
}

/* ────────────────────────── 시트명 규약 (S3-2) ────────────────────────── */

const SHEET_NAME_FORBIDDEN = /[:\\/?*[\]]/g

/**
 * 엑셀 시트명 규약으로 다듬는다 — 31자 상한·금지문자 제거·앞뒤 작은따옴표 금지.
 *
 * ⚠ 자를 때 **서식 번호는 절대 자르지 않는다**. `1.11.4` 같은 번호가 잘리면 어느 서식인지
 *   식별 불가가 되고, manifest·앵커·강순기 대조가 전부 그 이름을 키로 쓴다.
 */
export function sanitizeSheetName(no: string, title: string): string {
  const n = no.replace(SHEET_NAME_FORBIDDEN, '').trim()
  const t = title.replace(SHEET_NAME_FORBIDDEN, '').replace(/^'+|'+$/g, '').trim()
  if (n.length >= 31) return n.slice(0, 31) // 번호만으로 넘치면 그때만 번호를 자른다
  const room = 31 - n.length - 1
  const cut = t.length > room ? t.slice(0, room) : t
  return cut ? `${n} ${cut}` : n
}

/* ────────────────────────── 스타일 표 ────────────────────────── */

const BORDER_XML: Record<BorderKind, string> = {
  none: '',
  thin: ' style="thin"',
  medium: ' style="medium"',
  thick: ' style="thick"',
  double: ' style="double"',
  dashed: ' style="dashed"',
}

function borderKey(s: CellStyle): string {
  return `${s.left}|${s.right}|${s.top}|${s.bottom}`
}

function borderXml(s: CellStyle): string {
  const side = (name: string, k: BorderKind) =>
    k === 'none'
      ? `<${name}/>`
      : `<${name}${BORDER_XML[k]}><color rgb="FF000000"/></${name}>`
  return `<border>${side('left', s.left)}${side('right', s.right)}${side('top', s.top)}${side('bottom', s.bottom)}<diagonal/></border>`
}

/** '#RRGGBB' → 'FFRRGGBB' */
function argb(hex: string): string {
  const h = hex.replace('#', '').toUpperCase()
  return h.length === 6 ? `FF${h}` : h.length === 8 ? h : 'FFFFFFFF'
}

interface StyleTables {
  borders: string[]
  fills: string[]
  xfs: string[]
  /** 스타일 키 → cellXfs 인덱스 */
  index: Map<string, number>
}

function newStyleTables(): StyleTables {
  return {
    borders: ['<border><left/><right/><top/><bottom/><diagonal/></border>'],
    // ⚠ fills 0·1은 규격이 요구하는 고정 항목이다(none·gray125). 빼면 Excel이 파일을 고친다.
    fills: [
      '<fill><patternFill patternType="none"/></fill>',
      '<fill><patternFill patternType="gray125"/></fill>',
    ],
    xfs: [],
    index: new Map(),
  }
}

function styleIndex(t: StyleTables, s: CellStyle): number {
  const key = `${borderKey(s)}|${s.fill ?? '-'}|${s.center ? 'c' : 'l'}`
  const hit = t.index.get(key)
  if (hit !== undefined) return hit

  const bKey = borderKey(s)
  let bIdx = t.borders.findIndex((_, i) => t.borders[i] === borderXml(s))
  if (bIdx < 0) { t.borders.push(borderXml(s)); bIdx = t.borders.length - 1 }
  void bKey

  let fIdx = 0
  if (s.fill) {
    const xml = `<fill><patternFill patternType="solid"><fgColor rgb="${argb(s.fill)}"/><bgColor indexed="64"/></patternFill></fill>`
    fIdx = t.fills.indexOf(xml)
    if (fIdx < 0) { t.fills.push(xml); fIdx = t.fills.length - 1 }
  }

  // wrapText: 원본 셀이 여러 줄을 담으므로 항상 켠다. vertical=center는 hwpx 기본과 같다.
  const align = `<alignment horizontal="${s.center ? 'center' : 'left'}" vertical="center" wrapText="1"/>`
  t.xfs.push(
    `<xf numFmtId="0" fontId="0" fillId="${fIdx}" borderId="${bIdx}" xfId="0"`
    + ` applyFont="1" applyFill="${s.fill ? 1 : 0}" applyBorder="1" applyAlignment="1">${align}</xf>`,
  )
  const idx = t.xfs.length - 1
  t.index.set(key, idx)
  return idx
}

function stylesXml(t: StyleTables): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<fonts count="1"><font><sz val="10"/><color theme="1"/><name val="맑은 고딕"/><family val="2"/><charset val="129"/></font></fonts>`
    + `<fills count="${t.fills.length}">${t.fills.join('')}</fills>`
    + `<borders count="${t.borders.length}">${t.borders.join('')}</borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="${t.xfs.length || 1}">${t.xfs.length ? t.xfs.join('') : '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'}</cellXfs>`
    + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
    + `</styleSheet>`
}

/* ────────────────────────── 시트 XML ────────────────────────── */

function sheetXml(sh: BuildSheet, t: StyleTables): string {
  const rows = new Map<number, BuildCell[]>()
  for (const c of sh.cells) {
    const arr = rows.get(c.row) ?? []
    arr.push(c)
    rows.set(c.row, arr)
  }

  const nRows = sh.rowHeights.length
  const nCols = sh.colWidths.length
  const dim = nRows && nCols ? `A1:${cellRef(nRows - 1, nCols - 1)}` : 'A1'

  const cols = sh.colWidths.length
    ? `<cols>${sh.colWidths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w.toFixed(2)}" customWidth="1"/>`)
        .join('')}</cols>`
    : ''

  const body: string[] = []
  for (let r = 0; r < nRows; r++) {
    const cs = (rows.get(r) ?? []).sort((a, b) => a.col - b.col)
    const ht = sh.rowHeights[r]
    const attrs = `r="${r + 1}"${ht > 0 ? ` ht="${ht.toFixed(1)}" customHeight="1"` : ''}`
    if (!cs.length) { body.push(`<row ${attrs}/>`); continue }
    const cells = cs.map(c => {
      const s = styleIndex(t, c.style)
      const ref = cellRef(c.row, c.col)
      // ⚠ 빈 셀은 자기닫힘 — injectWorkbook.setCell의 정규식이 이 모양을 받는다(계약 ①)
      if (!c.text) return `<c r="${ref}" s="${s}"/>`
      return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escXml(c.text)}</t></is></c>`
    })
    body.push(`<row ${attrs}>${cells.join('')}</row>`)
  }

  const merges = sh.merges.length
    ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    : ''

  // Q-3 a안 — 전 시트에 인쇄 설정을 박아 「통합 문서 전체 인쇄」 한 번으로 연속 출력되게 한다.
  // fitToWidth가 먹으려면 sheetPr의 pageSetUpPr fitToPage가 함께 있어야 한다.
  const pageSetup =
    '<printOptions horizontalCentered="1"/>'
    + '<pageMargins left="0.28" right="0.28" top="0.35" bottom="0.35" header="0.2" footer="0.2"/>'
    + '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>'

  // ⚠ 요소 순서는 스키마(CT_Worksheet)가 고정한다 —
  //    sheetPr → dimension → sheetViews → sheetFormatPr → cols → sheetData → mergeCells
  //    → printOptions → pageMargins → pageSetup. 어기면 Excel이 '복구' 대화상자를 띄운다.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
    + `<dimension ref="${dim}"/>`
    + '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + cols
    + `<sheetData>${body.join('')}</sheetData>`
    + merges
    + pageSetup
    + '</worksheet>'
}

/* ────────────────────────── 조립 ────────────────────────── */

export interface BuildResult {
  bytes: Uint8Array
  /** 시트명 → zip 경로 (manifest 기록용) */
  sheetPaths: Map<string, string>
  /** 만들어진 cellXfs 수 — 스타일 중복 제거가 실제로 먹었는지 보는 축 */
  styleCount: number
}

export async function buildXlsx(sheets: BuildSheet[]): Promise<BuildResult> {
  if (!sheets.length) throw new Error('xlsx-build: 시트가 0개다')

  const names = new Set<string>()
  for (const s of sheets) {
    if (!s.name) throw new Error('xlsx-build: 시트명이 비었다')
    if (s.name.length > 31) throw new Error(`xlsx-build: 시트명 31자 초과 — ${s.name}`)
    if (SHEET_NAME_FORBIDDEN.test(s.name)) throw new Error(`xlsx-build: 시트명 금지문자 — ${s.name}`)
    if (names.has(s.name)) throw new Error(`xlsx-build: 시트명 중복 — ${s.name}`)
    names.add(s.name)
  }

  const t = newStyleTables()
  const zip = new JSZip()
  const sheetPaths = new Map<string, string>()

  const sheetEntries: string[] = []
  const relEntries: string[] = []

  sheets.forEach((sh, i) => {
    const path = `xl/worksheets/sheet${i + 1}.xml`
    zip.file(path, sheetXml(sh, t))
    sheetPaths.set(sh.name, path)
    // ⚠ name → r:id 순서 — sheetFileMap의 정규식이 이 순서를 전제한다(계약 ②)
    sheetEntries.push(`<sheet name="${escXml(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    relEntries.push(
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
  })

  const styleRid = `rId${sheets.length + 1}`
  relEntries.push(
    `<Relationship Id="${styleRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
  )

  zip.file('xl/styles.xml', stylesXml(t))

  zip.file('xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheets>${sheetEntries.join('')}</sheets></workbook>`)

  zip.file('xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relEntries.join('')}</Relationships>`)

  zip.file('_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>')

  // ⭐ sharedStrings.xml 없음 — 머리주석 참조(고아 si PII 사고를 구조로 차단)
  const overrides = sheets
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join('')
  zip.file('[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + overrides
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '</Types>')

  const bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
  return { bytes, sheetPaths, styleCount: t.xfs.length }
}
