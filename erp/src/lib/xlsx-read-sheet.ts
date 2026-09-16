/** xlsx 시트 **읽기** — `xlsx-build.ts`의 역함수.
 *
 *  서식 미리보기가 「실제 엑셀과 같은 그림」을 그리려면 **병합·열폭·행높이·테두리**를 알아야 한다.
 *  넷 다 자산(xlsx) 안에 이미 있는 사실이다.
 *
 *  🚨 **왜 manifest로 못 하나**: manifest의 `merges`는 **개수(숫자)**이지 범위가 아니다.
 *    이 양식은 60열 미세 격자라 병합이 없으면 표가 **아예 표가 아니다**. 그렇다고 빌드가
 *    manifest에 병합을 실으면 「자산과 manifest가 갈라졌나」를 지키는 검사를 하나 더 얻는다 —
 *    manifest는 *자산이 답할 수 없는 것*(hwpx 표↔시트 좌표=`gridTops`)만 싣는다는 선이 있다.
 *    **자산이 답할 수 있으면 자산에게 묻는다.**
 *
 *  🚨 **왜 SheetJS가 아닌가**: 커뮤니티판은 채움만 주고 **테두리·정렬을 안 준다**(실측:
 *    `ws['A1'].s`가 `{patternType,fgColor}`뿐). 테두리를 모르면 법정 서식이 표로 안 보이고,
 *    「이 칸이 값을 적는 슬롯인가」 판정도 못 한다 — 그 판정이 미리보기 셀 상태의 뿌리다.
 *    다만 SheetJS가 **아는 축**(병합·행높이·열폭·글자)은 교차검증에 쓴다(독립한 두 파서).
 *
 *  ⚠ 손수 파서가 위험하지 않은 이유: 쓰는 쪽(`xlsx-build.ts`)을 **우리가 소유**하고, 그 파일이
 *    셀 모양을 계약 3개로 못 박아 두었다. 이 모듈은 그 라이터의 역함수이고
 *    `test-fire-plan-preview.mts`의 **왕복 항등**이 그 관계를 붙든다 — 라이터가 바뀌면 붉어진다.
 */
import type JSZip from 'jszip'
import type { BorderKind } from '@/lib/hwpx-table'
import type { CellStyle, HAlign } from '@/lib/xlsx-build'
import { sheetFileMap } from '@/lib/xlsx-inject'

export type ReadCell = {
  /** 'A1' */
  ref: string
  /** 0-based */
  row: number
  col: number
  /** 셀 글자. 빈 셀은 '' */
  text: string
  /** 병합 좌상단이면 차지하는 칸 수, 아니면 null(병합에 **덮인** 칸도 null) */
  span: { rows: number; cols: number } | null
  /** 병합에 덮여 그려지지 않는 칸인가 — 미리보기가 건너뛴다 */
  covered: boolean
  style: CellStyle
}

export type ReadSheet = {
  name: string
  rows: number
  cols: number
  /** Excel 문자폭 단위(라이터가 쓴 그 값) */
  colWidths: number[]
  /** pt. 지정 없으면 0 */
  rowHeights: number[]
  /** 'A1:B2' */
  merges: string[]
  cells: ReadCell[]
}

/* ────────────────────────── 좌표 ────────────────────────── */

/** 'AB' → 27 (0-based) */
export function colIndex(name: string): number {
  let n = 0
  for (const ch of name) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** 'AB12' → { row: 11, col: 27 } (0-based) */
export function parseRef(ref: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)
  if (!m) throw new Error(`xlsx-read: 셀 참조 '${ref}'를 못 읽는다`)
  return { row: Number(m[2]) - 1, col: colIndex(m[1]) }
}

/* ────────────────────────── styles.xml ────────────────────────── */

/** `<border>` 한 벌 → 네 변의 종류. 라이터의 `borderXml`이 낸 모양을 되읽는다. */
function parseBorder(xml: string): Pick<CellStyle, 'left' | 'right' | 'top' | 'bottom'> {
  const side = (name: 'left' | 'right' | 'top' | 'bottom'): BorderKind => {
    // 자기닫힘(`<left/>`)이면 테두리 없음. 아니면 style 속성이 종류다.
    const m = new RegExp(`<${name}(/>|[^>]*>)`).exec(xml)
    if (!m || m[1] === '/>') return 'none'
    const st = /style="([^"]+)"/.exec(m[1])
    return (st?.[1] as BorderKind) ?? 'none'
  }
  return { left: side('left'), right: side('right'), top: side('top'), bottom: side('bottom') }
}

/** `<fill>` → '#RRGGBB' 또는 null. patternType이 solid일 때만 색이 있다. */
function parseFill(xml: string): string | null {
  if (!/patternType="solid"/.test(xml)) return null
  const m = /<fgColor[^>]*rgb="([0-9A-Fa-f]{6,8})"/.exec(xml)
  if (!m) return null
  const hex = m[1].length === 8 ? m[1].slice(2) : m[1]   // ARGB → RGB
  return `#${hex.toUpperCase()}`
}

/** 스타일 표 — cellXfs 인덱스 → CellStyle */
function parseStyles(xml: string): CellStyle[] {
  const block = (tag: string) => {
    const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml)
    return m?.[1] ?? ''
  }
  const borders = [...block('borders').matchAll(/<border[^>]*>[\s\S]*?<\/border>/g)].map(m => m[0])
  const fills = [...block('fills').matchAll(/<fill>[\s\S]*?<\/fill>/g)].map(m => m[0])
  const xfs = [...block('cellXfs').matchAll(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m => m[0])

  return xfs.map(xf => {
    const bId = Number(/borderId="(\d+)"/.exec(xf)?.[1] ?? 0)
    const fId = Number(/fillId="(\d+)"/.exec(xf)?.[1] ?? 0)
    const align = (/horizontal="(left|center|right)"/.exec(xf)?.[1] as HAlign) ?? 'left'
    return {
      ...parseBorder(borders[bId] ?? ''),
      fill: parseFill(fills[fId] ?? ''),
      align,
    }
  })
}

/* ────────────────────────── 시트 ────────────────────────── */

const EMPTY_STYLE: CellStyle = {
  left: 'none', right: 'none', top: 'none', bottom: 'none', fill: null, align: 'left',
}

/** xml 실체 참조를 되돌린다 — 라이터의 `escXml` 역함수.
 *  ⚠ `&amp;`를 **마지막에** 푼다. 먼저 풀면 `&amp;lt;`가 `<`가 되어 원문이 바뀐다. */
function unescXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&amp;/g, '&')
}

/** 한 시트를 격자로 읽는다.
 *
 *  ⚠ `zip`은 **읽기만** 한다(캐시된 템플릿을 여럿이 공유한다).
 */
export async function readSheetGrid(zip: JSZip, sheetName: string): Promise<ReadSheet> {
  const files = await sheetFileMap(zip)
  const path = files.get(sheetName)
  if (!path) {
    throw new Error(`xlsx-read: 시트 '${sheetName}' 없음 (있는 것: ${[...files.keys()].join(' · ')})`)
  }
  const file = zip.file(path)
  if (!file) throw new Error(`xlsx-read: 시트 '${sheetName}'의 파트 '${path}'가 zip에 없다`)

  const xml = await file.async('string')
  const stylesFile = zip.file('xl/styles.xml')
  const styles = stylesFile ? parseStyles(await stylesFile.async('string')) : []

  // ── 병합 ──
  const merges = [...xml.matchAll(/<mergeCell ref="([^"]+)"/g)].map(m => m[1])
  /** 덮인 칸 → 좌상단 ref */
  const covered = new Map<string, string>()
  /** 좌상단 ref → span */
  const spanOf = new Map<string, { rows: number; cols: number }>()
  for (const range of merges) {
    const [a, b] = range.split(':')
    const s = parseRef(a), e = parseRef(b)
    spanOf.set(a, { rows: e.row - s.row + 1, cols: e.col - s.col + 1 })
    for (let r = s.row; r <= e.row; r++) {
      for (let c = s.col; c <= e.col; c++) {
        if (r === s.row && c === s.col) continue   // 좌상단은 그리는 칸이다
        covered.set(`${r}:${c}`, a)
      }
    }
  }

  // ── 열 너비 ──
  const colWidths: number[] = []
  for (const m of xml.matchAll(/<col min="(\d+)" max="(\d+)"[^>]*width="([\d.]+)"/g)) {
    const lo = Number(m[1]) - 1, hi = Number(m[2]) - 1, w = Number(m[3])
    for (let i = lo; i <= hi; i++) colWidths[i] = w
  }

  // ── 행·셀 ──
  const rowHeights: number[] = []
  const cells: ReadCell[] = []
  for (const rm of xml.matchAll(/<row ([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const attrs = rm[1], body = rm[2] ?? ''
    const r = Number(/r="(\d+)"/.exec(attrs)?.[1] ?? 0) - 1
    if (r < 0) continue
    rowHeights[r] = Number(/ht="([\d.]+)"/.exec(attrs)?.[1] ?? 0)

    for (const cm of body.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = cm[1], cAttrs = cm[2], inner = cm[3] ?? ''
      const { row, col } = parseRef(ref)
      const sIdx = Number(/s="(\d+)"/.exec(cAttrs)?.[1] ?? -1)
      // 라이터는 inlineStr만 쓴다(sharedStrings를 아예 안 만든다 — 그 파일 머리주석)
      const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)
      cells.push({
        ref, row, col,
        text: t ? unescXml(t[1]) : '',
        span: spanOf.get(ref) ?? null,
        covered: covered.has(`${row}:${col}`),
        style: styles[sIdx] ?? EMPTY_STYLE,
      })
    }
  }

  // ── 치수 ──
  // `<dimension>`을 믿지 않고 **실제로 읽은 것**에서 낸다 — dimension은 라이터가 적은 주장이고,
  // 이 모듈이 재는 것은 「실제로 무엇이 들어 있나」다. 둘이 어긋나면 검사가 그걸 드러내야 한다.
  const rows = Math.max(rowHeights.length, ...cells.map(c => c.row + 1), 0)
  const cols = Math.max(colWidths.length, ...cells.map(c => c.col + 1), 0)

  return {
    name: sheetName,
    rows, cols,
    colWidths: Array.from({ length: cols }, (_, i) => colWidths[i] ?? 0),
    rowHeights: Array.from({ length: rows }, (_, i) => rowHeights[i] ?? 0),
    merges, cells,
  }
}
