/** hwpx(한글 문서 XML) 표 파서 — 소방계획서_42 S1.
 *
 *  법정 양식 `erp_goal/_Data/양식-placeholder.hwpx`는 ZIP+XML이라 기계 판독된다.
 *  `Contents/section0.xml`의 `hp:tc`가 xlsx로 직역하는 데 필요한 걸 전부 들고 있다:
 *
 *    <hp:tc borderFillIDRef="91"> … <hp:t>용도</hp:t> …
 *      <hp:cellAddr colAddr="0" rowAddr="0"/>    ← 병합 반영 절대 좌표(오프셋 계산 불필요)
 *      <hp:cellSpan colSpan="1" rowSpan="2"/>    ← xlsx mergeCells 직역
 *      <hp:cellSz  width="9526" height="3696"/>  ← HWPUNIT
 *
 *  이 모듈은 **순수**하다 — 파일을 읽지 않는다(호출부가 zip에서 꺼낸 문자열을 넘긴다).
 *  xlsx 조립은 S2(`xlsx-build.ts`)의 몫이고 여기서는 격자·테두리·치수만 뽑는다.
 *
 *  ⚠ 정규식으로 표를 뜯지 않는다. `<hp:tbl>` 안에 `<hp:tbl>`이 들어가는 **중첩표**가 실재하고
 *    (제2장 서식 2.3·2.4), 정규식은 그 짝을 맞추지 못해 격자가 조용히 깨진다.
 *    태그 단위 스캐너 + 스택으로 깊이를 세는 이유다.
 */

/** xlsx 테두리 종류로 접은 값 */
export type BorderKind = 'none' | 'thin' | 'medium' | 'thick' | 'double' | 'dashed'

export interface HwpxBorderFill {
  id: number
  left: BorderKind
  right: BorderKind
  top: BorderKind
  bottom: BorderKind
  /** '#RRGGBB' — 채움 없음(`none`)이면 null */
  faceColor: string | null
}

export interface HwpxCell {
  /** 병합을 반영한 절대 격자 좌표(0-based) */
  row: number
  col: number
  rowSpan: number
  colSpan: number
  /** HWPUNIT(1/7200 inch) */
  widthHwp: number
  heightHwp: number
  /** 셀 안의 글. 문단이 여럿이면 '\n'으로 잇는다 */
  text: string
  borderFillId: number
}

export interface HwpxTable {
  /** 문서 내 등장 순서(0-based) — 강순기 대조·manifest의 표 식별자 */
  index: number
  rowCnt: number
  colCnt: number
  /** 중첩 깊이. 0이 최상위, 표 안의 표는 1 이상 */
  depth: number
  /** 부모 표의 index. 최상위면 null */
  parent: number | null
  cells: HwpxCell[]
}

/* ────────────────────────── 단위 환산 (HWPUNIT = 1/7200 inch) ────────────────────────── */

/** 행 높이 → pt. 7200/72 = 100이라 정확히 나눠떨어진다 */
export function hwpToPt(hwp: number): number {
  return hwp / 100
}

/** 열 너비 → px(96dpi). 7200/96 = 75 */
export function hwpToPx(hwp: number): number {
  return hwp / 75
}

/** px → Excel `<col width>` 단위(기본 글꼴 문자폭 기준) */
export function pxToColWidth(px: number): number {
  return Math.max(0, (px - 5) / 7)
}

/* ────────────────────────── 테두리 매핑 ────────────────────────── */

/** `width="0.12 mm"` → 0.12 */
function parseMm(width: string | undefined): number {
  if (!width) return 0
  const m = /(-?[\d.]+)/.exec(width)
  return m ? Number(m[1]) : 0
}

/**
 * hwpx 테두리 `type`+`width` → xlsx 테두리.
 *
 * ⚠ **모르는 type을 조용히 'thin'으로 떨구지 않는다.** 그렇게 하면 서식이 틀어져도
 *   빌드가 초록으로 통과한다 — 호출부가 `unknownBorderTypes`를 보고 실패시켜야 한다.
 *   실측(양식-placeholder.hwpx): 실제 쓰인 조합은 NONE/SOLID/DASH/DOUBLE_SLIM 4종뿐이다.
 */
export function mapBorder(type: string | undefined, width: string | undefined): BorderKind | null {
  if (!type) return null
  const t = type.toUpperCase()
  if (t === 'NONE') return 'none'
  if (t.startsWith('DOUBLE')) return 'double'
  if (t === 'DASH' || t === 'DOT' || t === 'DASH_DOT' || t === 'DASH_DOT_DOT') return 'dashed'
  if (t === 'SOLID' || t === 'THICK') {
    const mm = parseMm(width)
    if (mm <= 0.15) return 'thin'
    if (mm <= 0.6) return 'medium'
    return 'thick'
  }
  return null // 미지 — 호출부가 실패시킨다
}

export interface BorderFillResult {
  fills: Map<number, HwpxBorderFill>
  /** 매핑표에 없는 type 조합. 비어 있지 않으면 빌드를 세운다 */
  unknownBorderTypes: string[]
}

/** `Contents/header.xml` → borderFill 표 */
export function parseBorderFills(headerXml: string): BorderFillResult {
  const fills = new Map<number, HwpxBorderFill>()
  const unknown = new Set<string>()

  let cur: { id: number; sides: Partial<Record<'left' | 'right' | 'top' | 'bottom', BorderKind>>; face: string | null } | null = null

  scanXml(headerXml, {
    open(name, attrs) {
      if (name === 'hh:borderFill') {
        const id = Number(getAttr(attrs, 'id') ?? -1)
        cur = { id, sides: {}, face: null }
        return
      }
      if (!cur) return
      const side =
        name === 'hh:leftBorder' ? 'left'
        : name === 'hh:rightBorder' ? 'right'
        : name === 'hh:topBorder' ? 'top'
        : name === 'hh:bottomBorder' ? 'bottom'
        : null
      if (side) {
        const type = getAttr(attrs, 'type') ?? undefined
        const width = getAttr(attrs, 'width') ?? undefined
        const kind = mapBorder(type, width)
        if (kind === null) unknown.add(`${type ?? '(no type)'}|${width ?? '(no width)'}`)
        cur.sides[side] = kind ?? 'thin' // 폴백은 두되 unknown에 남겨 호출부가 세운다
        return
      }
      if (name === 'hc:winBrush') {
        const face = getAttr(attrs, 'faceColor')
        cur.face = face && face.toLowerCase() !== 'none' ? face : null
      }
    },
    close(name) {
      if (name !== 'hh:borderFill' || !cur) return
      fills.set(cur.id, {
        id: cur.id,
        left: cur.sides.left ?? 'none',
        right: cur.sides.right ?? 'none',
        top: cur.sides.top ?? 'none',
        bottom: cur.sides.bottom ?? 'none',
        faceColor: cur.face,
      })
      cur = null
    },
    text() {},
  })

  return { fills, unknownBorderTypes: [...unknown] }
}

/* ────────────────────────── 표 파서 ────────────────────────── */

interface CellBuild {
  row: number
  col: number
  rowSpan: number
  colSpan: number
  widthHwp: number
  heightHwp: number
  borderFillId: number
  parts: string[]
  /** 현재 문단에 이미 글이 실렸는가 — 문단 사이 '\n' 삽입 판정 */
  paraOpen: boolean
}

/** `Contents/section0.xml` → 표 목록(중첩 포함, 등장 순서) */
export function parseTables(sectionXml: string): HwpxTable[] {
  const out: HwpxTable[] = []
  const tblStack: HwpxTable[] = []
  const cellStack: CellBuild[] = []
  let textDepth = 0

  scanXml(sectionXml, {
    open(name, attrs, selfClosing) {
      switch (name) {
        case 'hp:tbl': {
          const t: HwpxTable = {
            index: out.length,
            rowCnt: Number(getAttr(attrs, 'rowCnt') ?? 0),
            colCnt: Number(getAttr(attrs, 'colCnt') ?? 0),
            depth: tblStack.length,
            parent: tblStack.length ? tblStack[tblStack.length - 1].index : null,
            cells: [],
          }
          out.push(t)
          tblStack.push(t)
          // 자기 닫힘 표는 없지만 방어적으로
          if (selfClosing) tblStack.pop()
          return
        }
        case 'hp:tc': {
          cellStack.push({
            row: 0, col: 0, rowSpan: 1, colSpan: 1,
            widthHwp: 0, heightHwp: 0,
            borderFillId: Number(getAttr(attrs, 'borderFillIDRef') ?? 0),
            parts: [], paraOpen: false,
          })
          return
        }
        case 'hp:cellAddr': {
          const c = cellStack[cellStack.length - 1]
          if (!c) return
          c.col = Number(getAttr(attrs, 'colAddr') ?? 0)
          c.row = Number(getAttr(attrs, 'rowAddr') ?? 0)
          return
        }
        case 'hp:cellSpan': {
          const c = cellStack[cellStack.length - 1]
          if (!c) return
          c.colSpan = Number(getAttr(attrs, 'colSpan') ?? 1)
          c.rowSpan = Number(getAttr(attrs, 'rowSpan') ?? 1)
          return
        }
        case 'hp:cellSz': {
          const c = cellStack[cellStack.length - 1]
          if (!c) return
          c.widthHwp = Number(getAttr(attrs, 'width') ?? 0)
          c.heightHwp = Number(getAttr(attrs, 'height') ?? 0)
          return
        }
        case 'hp:p': {
          // 문단이 바뀌면 줄바꿈. 첫 문단 앞에는 넣지 않는다.
          const c = cellStack[cellStack.length - 1]
          if (c && c.parts.length) c.paraOpen = true
          return
        }
        case 'hp:t':
          textDepth++
          if (selfClosing) textDepth--
          return
        default:
          return
      }
    },

    close(name) {
      switch (name) {
        case 'hp:tbl':
          tblStack.pop()
          return
        case 'hp:tc': {
          const c = cellStack.pop()
          const t = tblStack[tblStack.length - 1]
          if (!c || !t) return
          t.cells.push({
            row: c.row, col: c.col,
            rowSpan: c.rowSpan, colSpan: c.colSpan,
            widthHwp: c.widthHwp, heightHwp: c.heightHwp,
            text: c.parts.join(''),
            borderFillId: c.borderFillId,
          })
          return
        }
        case 'hp:t':
          if (textDepth > 0) textDepth--
          return
        default:
          return
      }
    },

    text(raw) {
      if (textDepth <= 0) return
      const c = cellStack[cellStack.length - 1]
      if (!c) return // 표 밖의 본문 글 — 42는 표만 쓴다
      if (c.paraOpen) { c.parts.push('\n'); c.paraOpen = false }
      c.parts.push(unescapeXml(raw))
    },
  })

  return out
}

/* ────────────────────────── 격자 검증 ────────────────────────── */

export interface GridProblem {
  tableIndex: number
  kind: 'overlap' | 'hole' | 'out-of-range' | 'count-mismatch'
  detail: string
}

/**
 * 표의 셀들이 rowCnt×colCnt 격자를 **정확히 한 번씩** 덮는지 검사한다.
 *
 * 빌드 게이트의 첫 관문이다(42 S1-3). 여기가 통과해야 xlsx 병합이 원본과 같아진다 —
 * 겹치면 병합이 충돌하고, 구멍이 나면 테두리가 빠진다. 둘 다 육안으로는 잘 안 보인다.
 */
export function validateGrid(t: HwpxTable): GridProblem[] {
  const problems: GridProblem[] = []
  const seen = new Uint8Array(t.rowCnt * t.colCnt)

  for (const c of t.cells) {
    if (c.row < 0 || c.col < 0 || c.row + c.rowSpan > t.rowCnt || c.col + c.colSpan > t.colCnt) {
      problems.push({
        tableIndex: t.index, kind: 'out-of-range',
        detail: `cell(${c.row},${c.col}) span(${c.rowSpan}x${c.colSpan}) 가 격자 ${t.rowCnt}x${t.colCnt} 밖`,
      })
      continue
    }
    for (let r = c.row; r < c.row + c.rowSpan; r++) {
      for (let k = c.col; k < c.col + c.colSpan; k++) {
        const at = r * t.colCnt + k
        if (seen[at]) {
          problems.push({
            tableIndex: t.index, kind: 'overlap',
            detail: `(${r},${k}) 를 두 셀이 덮는다`,
          })
        }
        seen[at] = 1
      }
    }
  }

  for (let r = 0; r < t.rowCnt; r++) {
    for (let k = 0; k < t.colCnt; k++) {
      if (!seen[r * t.colCnt + k]) {
        problems.push({ tableIndex: t.index, kind: 'hole', detail: `(${r},${k}) 를 덮는 셀이 없다` })
      }
    }
  }

  return problems
}

/** 표의 열 경계 벡터(HWPUNIT 누적합) — 시트 병합 판정용(42 S3-1: 경계가 같은 연속 표만 합친다) */
export function columnEdges(t: HwpxTable): number[] {
  const widths = new Array<number>(t.colCnt).fill(0)
  // colSpan=1 인 셀만 열 너비의 증거가 된다(병합 셀은 여러 열에 걸쳐 있어 나눌 수 없다)
  for (const c of t.cells) {
    if (c.colSpan === 1 && c.widthHwp > 0) widths[c.col] = Math.max(widths[c.col], c.widthHwp)
  }
  const edges: number[] = [0]
  for (let i = 0; i < t.colCnt; i++) edges.push(edges[i] + widths[i])
  return edges
}

/** 행 높이(HWPUNIT) — rowSpan=1 인 셀만 증거가 된다 */
export function rowHeights(t: HwpxTable): number[] {
  const h = new Array<number>(t.rowCnt).fill(0)
  for (const c of t.cells) {
    if (c.rowSpan === 1 && c.heightHwp > 0) h[c.row] = Math.max(h[c.row], c.heightHwp)
  }
  return h
}

/* ────────────────────────── XML 스캐너 (의존성 없음) ────────────────────────── */

interface ScanHandlers {
  open(name: string, attrs: string, selfClosing: boolean): void
  close(name: string): void
  text(raw: string): void
}

/**
 * 태그 단위 스캐너. Node에 DOM이 없고 새 의존성을 들이지 않기 위해 직접 쓴다.
 * 따옴표 안의 '>' 를 종료로 오인하지 않는다.
 */
function scanXml(xml: string, on: ScanHandlers): void {
  let i = 0
  const n = xml.length

  while (i < n) {
    const lt = xml.indexOf('<', i)
    if (lt < 0) {
      if (i < n) on.text(xml.slice(i))
      return
    }
    if (lt > i) on.text(xml.slice(i, lt))

    if (xml.startsWith('<!--', lt)) {
      const e = xml.indexOf('-->', lt)
      i = e < 0 ? n : e + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt)
      const end = e < 0 ? n : e
      on.text(xml.slice(lt + 9, end))
      i = e < 0 ? n : e + 3
      continue
    }
    if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) {
      const e = xml.indexOf('>', lt)
      i = e < 0 ? n : e + 1
      continue
    }

    // '>' 찾기 — 따옴표 안은 건너뛴다
    let j = lt + 1
    let quote = ''
    while (j < n) {
      const ch = xml[j]
      if (quote) {
        if (ch === quote) quote = ''
      } else if (ch === '"' || ch === "'") {
        quote = ch
      } else if (ch === '>') {
        break
      }
      j++
    }
    const raw = xml.slice(lt + 1, j)
    i = j + 1

    if (raw.startsWith('/')) {
      on.close(raw.slice(1).trim())
      continue
    }
    const selfClosing = raw.endsWith('/')
    const body = selfClosing ? raw.slice(0, -1) : raw
    const sp = body.search(/[\s]/)
    const name = sp < 0 ? body : body.slice(0, sp)
    const attrs = sp < 0 ? '' : body.slice(sp + 1)
    on.open(name, attrs, selfClosing)
    if (selfClosing) on.close(name)
  }
}

const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/** 태그의 속성 문자열에서 한 키를 꺼낸다 */
export function getAttr(attrs: string, key: string): string | null {
  ATTR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ATTR_RE.exec(attrs))) {
    if (m[1] === key) return m[2] !== undefined ? m[2] : (m[3] ?? '')
  }
  return null
}

/** XML 실체 참조 해제. 숫자 참조(&#xAC00; 등)도 푼다 */
export function unescapeXml(s: string): string {
  if (s.indexOf('&') < 0) return s
  return s.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(lt|gt|amp|quot|apos));/g, (_, dec, hex, name) => {
    if (dec) return String.fromCodePoint(Number(dec))
    if (hex) return String.fromCodePoint(parseInt(hex, 16))
    switch (name) {
      case 'lt': return '<'
      case 'gt': return '>'
      case 'amp': return '&'
      case 'quot': return '"'
      case 'apos': return "'"
      default: return _
    }
  })
}
