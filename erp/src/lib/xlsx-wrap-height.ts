/** 줄바꿈 높이 자동 확장 — 「글자가 잘리지 않게」의 단일 원천.
 *
 *  `xlsx-build.ts`는 **모든 칸에 `wrapText="1"`을 건다**(원본 hwpx 칸이 여러 줄을 담기 때문).
 *  그런데 행 높이는 hwpx의 것을 그대로 쓴다 — 한글 원본은 칸마다 글자 크기가 다른데 우리는
 *  **전 칸을 10pt 한 벌**로 쓰므로, 좁은 칸에서는 원본보다 글자가 커져 한 줄이 두 줄이 된다.
 *  그러면 두 번째 줄이 행 높이를 넘어 **아래 테두리에 잘린다**(실측: 서식 2.1 `□ 비상연락팀`·
 *  `□ 주간` — 상자만 첫 줄에 남고 이름이 잘렸다).
 *
 *  그래서 여기서 **필요한 줄 수를 재고 행을 늘린다**. 규약 셋:
 *   · **늘리기만 한다.** 원본보다 줄이면 hwpx가 의도한 여백이 사라진다.
 *   · **병합 폭으로 잰다.** `□ 비상연락팀`이 사는 칸은 8열 병합이고, 한 열만 보면 전부 넘친다.
 *   · **추정은 넉넉히.** 폰트 대체(LibreOffice)·자간 차이로 실측이 모델보다 넓을 수 있다.
 *     좁게 잡아 못 잡는 쪽(글자 잘림)이 넓게 잡아 행이 조금 커지는 쪽보다 나쁘다.
 *
 *  🚨 **눈으로 맞춘 상수다.** 아래 값은 서식 2.1을 LibreOffice로 실제 인쇄해 «어디서 줄이
 *    바뀌는가»를 보고 **부등식으로 가뒀다** — 넘친 칸과 안 넘친 칸을 양쪽에서 물렸다:
 *      · ` □ 주간`   5열(폭 44px)에서 **넘친다**      → 3.5em > 44   → em > 12.6
 *      · ` □ 비상연락팀` 8열(83px)에서 **넘친다**      → 6.5em > 83   → em > 12.8
 *      · ` □ 100명 ~ 500명` 10열(109px)에서 **안 넘친다** → 7.8em ≤ 109 → em ≤ 13.9
 *    `EM_PX`는 그 사이(13.6)다. 한쪽만 보고 정하면 못 잡거나 헛되이 행이 커진다.
 *    폰트나 `FINE_COL_W`를 바꾸면 이 상수도 **다시 재야 한다** — 추측으로 고치지 말 것.
 */

/** 전각 한 글자의 폭(px) — 맑은 고딕 10pt(96dpi 13.3px) + 대체 폰트 여유 */
const EM_PX = 13.6
/** 한 줄 높이(pt) — 10pt 글자의 엑셀 자동 맞춤 높이 */
export const LINE_PT = 13.5
/** 칸 위아래 여백(pt) */
const CELL_PAD_PT = 1.5
/** 왼쪽 정렬 칸의 `indent="1"`이 먹는 폭(px) + 좌우 안쪽 여백 */
const INDENT_PX = 21

/** A4 세로·위아래 여백 0.35in, `fitToWidth` 축소(60열×1.8)를 되돌린 **본문 높이 한도**(pt).
 *  시트 높이 합이 이걸 넘으면 그 시트는 두 쪽으로 나뉜다 — 자동 확장이 쪽을 깨지 않는지 보는 자. */
export const PAGE_BODY_PT = 838

/** 엑셀 열 폭(문자 단위) → 픽셀. 규격 환산식(MDW=7px) */
export function colWidthToPx(width: number): number {
  return Math.floor((Math.floor(256 * width + Math.floor(128 / 7)) / 256) * 7)
}

/** 글자 폭(px) — 한글·한자·전각은 1em, 숫자·영문은 그 절반쯤 */
export function textWidthPx(s: string): number {
  let w = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if (ch === ' ') w += EM_PX * 0.25
    else if (c < 0x0250) w += EM_PX * (/[0-9]/.test(ch) ? 0.55 : /[A-Z]/.test(ch) ? 0.62 : 0.5)
    else if (c >= 0x2000 && c < 0x2070) w += EM_PX * 0.5   // ‐ – · … 류
    else w += EM_PX                                        // 한글·한자·상자(□ ☐ ■)·전각
  }
  return w
}

/** 이 글자가 `cols`칸 병합 안에서 몇 줄을 차지하는가 — 원문의 `\n`도 줄로 센다 */
export function measureLines(text: string, cols: number, colWidth: number): number {
  const avail = cols * colWidthToPx(colWidth) - INDENT_PX
  if (avail <= 0) return 1
  let lines = 0
  for (const para of String(text).split('\n')) {
    lines += Math.max(1, Math.ceil(textWidthPx(para) / avail))
  }
  return Math.max(1, lines)
}

export interface WrapSheet {
  colWidths: number[]
  rowHeights: number[]
  /** `cols`·`rows`를 직접 들고 있으면 그것을, 없으면 `merges`에서 찾는다 */
  cells: Array<{ row: number; col: number; text: string; cols?: number; rows?: number }>
  /** 'A1:B2' — 병합 폭을 여기서 읽는다 */
  merges: string[]
}

/** 0-based (row,col) → 'A1' 의 역 — 'A1' → {row,col} */
function parseRef(ref: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)
  if (!m) return { row: 0, col: 0 }
  let col = 0
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { row: Number(m[2]) - 1, col: col - 1 }
}

/**
 * 줄바꿈이 들어갈 만큼 늘린 행 높이 배열(새 배열을 돌려준다 — 입력은 안 건드린다).
 *
 * ⚠ 세로 병합된 칸은 **여러 행이 높이를 나눠 진다** — 그 칸 하나 때문에 첫 행만 키우면
 *   표가 어긋난다. 그래서 세로로 2행 이상 걸친 칸은 세지 않는다(그 칸들은 이미 높이가 넉넉하다).
 */
export function neededRowHeights(sheet: WrapSheet): number[] {
  const span = new Map<string, { cols: number; rows: number }>()
  for (const m of sheet.merges) {
    const [a, b] = m.split(':')
    if (!b) continue
    const p = parseRef(a), q = parseRef(b)
    span.set(a, { cols: q.col - p.col + 1, rows: q.row - p.row + 1 })
  }
  const out = sheet.rowHeights.slice()
  for (const c of sheet.cells) {
    if (!c.text || !c.text.trim()) continue
    const hit = span.get(`${colLetters(c.col)}${c.row + 1}`)
    const cols = hit?.cols ?? c.cols ?? 1
    const rows = hit?.rows ?? c.rows ?? 1
    if (rows > 1) continue
    const lines = measureLines(c.text, cols, sheet.colWidths[c.col] ?? 1.8)
    if (lines < 2) continue
    const need = lines * LINE_PT + CELL_PAD_PT
    if (need > (out[c.row] ?? 0)) out[c.row] = Math.round(need * 10) / 10
  }
  return out
}

function colLetters(col: number): string {
  let s = ''
  let n = col + 1
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}
