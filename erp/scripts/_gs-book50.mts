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
import { parseTables, parseBorderFills, columnEdges, rowHeights, hwpToPt, type HwpxTable } from '../src/lib/hwpx-table.ts'
import { readSectionStream, walkRecords, extractTables, calibrateCellOffset, type Hwp5Table } from './hwp5-read.mts'
import { scanCellColors } from './_gs-cellcolor.mts'

const HERE = dirname(fileURLToPath(import.meta.url))
/* ⚠ 엑셀이 열고 있는 파일은 **쓰기가 막힌다**(node:fs EBUSY) — 그런데 빌드 로그는 앞부분이 초록이라
 *   성공한 것처럼 보인다. 실패를 확실히 드러내고, 인자로 다른 이름을 줄 수 있게 한다. */
const OUT = process.argv[2] ?? 'F:\\AI\\sjfire\\_강순기_형식비교\\강순기_소방계획서.xlsx'
const N = 60                       // 미세 격자 열 수
/** 본문 글자 크기(pt). **원본 hwp는 10pt가 87.3%**다 — 1차에 9pt로 낮췄던 것은 미세 격자 열이
 *  좁아 넘칠까 봐였고, 원본보다 작게 만들 이유가 없었다. 인자로 바꿔 쪽수·모양을 잴 수 있다. */
const BODY_PT = Number(process.argv[3] ?? 10)
const BANNER_PT = Math.round(BODY_PT * 1.3)
/** 격자 한 열의 폭(엑셀 '글자 수' 단위).
 *
 *  🎯**인쇄물의 글자 크기를 정하는 것은 폰트가 아니라 이 값이다.** 시트가 가로 1쪽에 맞춰
 *  축소되므로  실제 글자 = 폰트pt × min(1, 쪽폭 ÷ 내용폭)  인데, 엑셀의 열 폭 단위가 **글자 수**라
 *  내용폭도 폰트에 비례한다 → 폰트가 약분되고 **실제 글자 = 쪽폭 ÷ (열 수 × 열 폭)** 만 남는다.
 *  실측으로도 14pt가 10pt보다 **작게** 인쇄됐다. 크게 하려면 이 값(또는 N)을 줄여야 한다.
 *
 *  실측 최적: **1.8** — 2.2는 내용이 쪽보다 넓어 축소되고(글자 작아짐), 1.1은 너무 좁아 표가
 *  쪽 폭의 60%만 쓰고 칸마다 줄바꿈이 난다. 1.8이 쪽을 꽉 채우면서 축소가 없어 글자가 가장 크다. */
const COL_W = Number(process.argv[4] ?? 1.8)

/* ── 원본 ── */
const zf = await JSZip.loadAsync(readFileSync(resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')))
const sectionXml = await zf.file('Contents/section0.xml')!.async('string')
const headerXml = await zf.file('Contents/header.xml')!.async('string')
const form = parseTables(sectionXml)
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
/** 표기 정규화 — **지금은 비어 있다**(2026-09-08 사용자 결정).
 *
 *  경위: 한때 여기서 「근생」을 「제2종근린생활시설」로 펴고 있었다. 그런데 ERP 생성 경로는
 *  같은 날 정반대로 — `fire-plan-xlsx-values.ts`의 `purposeShort`가 대장의 9자를 「근생」으로
 *  **줄이고** 있었다(서식 1.1 주용도 칸이 한글 약 8자라 두 줄로 접힌다). 한 값이 두 경로에서
 *  서로 반대로 가공되고 있었던 것이고, 사용자가 **「근생」으로 통일**하도록 정했다.
 *
 *  ⚠ 그래서 여기서 펴지 않는다. 이 생성기는 납품 문서의 **충실한 변환**이고, 원본이 「근생」이면
 *    「근생」으로 찍는 것이 맞다 — 약어를 지어내는 것이나 임의로 펴는 것이나 같은 종류의 개입이다.
 *  ⚠ 표기가 자리마다 다른 것은 원본이 그런 것이다. 표지는 「근린생활시설」, 서식 1.1은 「근생」.
 *  ⚠ 되살릴 일이 생기면 **값이 아니라 표기만** 바꿀 것. 뜻이 달라지는 치환은 여기 넣지 말 것.
 *  ⚠ 「근린생활시설」이다 — 「그린생활시설」이라는 말은 없다(近隣: 가까운 이웃). */
const TERM_MAP: Record<string, string> = {}
const normTerm = (v: string) => TERM_MAP[v] ?? v

/** 글자 다듬기.
 *
 *  ⚠ 공백을 지우지 않는다 — 대조용 정규화를 출력에 쓰면 건물명·주소의 띄어쓰기가 통째로 사라진다.
 *  ⚠⚠ **연속 공백도 접지 않는다.** 서식 1.10.1의 「      년      월」처럼 **공백이 곧 입력 칸**인
 *     자리가 있다. `\s+ → ' '`로 접었더니 「년 월」이 되어 적을 자리가 사라졌다(사용자 지적).
 *     줄바꿈·탭만 공백으로 바꾸고 연속 공백은 **그대로 둔다**. */
const tidy = (s: string) => s.replace(/[\t\r\n]+/g, ' ').replace(/ /g, ' ').replace(/^ +| +$/g, '')
const textOf = (t: Hwp5Table) => {
  const m = new Map<string, string>()
  for (const c of t.cells) if (c.row !== null && c.col !== null) m.set(`${c.row},${c.col}`, normTerm(tidy(c.text)))
  return m
}

/** 단위 칸인가 — 「kW」「kVA」「대」「명」이나 「  년   월」처럼 **값을 왼쪽에 적는** 자리.
 *  원본(서식 1.6)은 이런 칸을 **우측정렬**해 단위를 오른쪽 끝에 붙인다(사용자 지시). */
const UNIT = '(?:kW|kVA|kva|㎡|㎥|m|대|명|원|회|개|일|년|월|층|人)'
/** ⚠ **단위만 있는 빈 칸**이어야 한다. 「<숫자>㎡」처럼 **값이 이미 든 칸은 ERP 데이터**라
 *  좌측정렬 규칙(아래 TOKEN_CELLS)으로 넘긴다 — 두 지시가 겹치는 자리라 여기서 갈라 둔다.
 *  1차에 `\d[\d.,]*\s*단위`까지 우정렬로 잡아 연면적·건축면적이 오른쪽에 붙었다. */
const isUnitCell = (v: string) => new RegExp(`^\\s*${UNIT}(?:\\s+(?:이상|이하))?\\s*$`).test(v)
  || new RegExp(`^\\s{2,}${UNIT}`).test(v)            // 「   년   월」류 — 앞이 입력 공백
  || /^\s*(매월|매년)\s{2,}/.test(v)                   // 「매월    일」·「매월  회 이상」
/** 긴 문장은 가운데로 몰면 읽기 나쁘다 — 좌측정렬(사용자 지시: 「글자입력은 칸 안에서 좌측정렬」) */
const isProse = (v: string) => v.replace(/\s/g, '').length >= 12

/** ERP가 채우는 칸인가 — 양식 hwpx가 그 자리에 `{{토큰}}`을 둔 셀.
 *
 *  사용자 지시(2026-09-08): **「ERP에서 나온 데이터는 입력 시 좌측정렬」**.
 *  값 길이가 제각각이라 가운데로 몰면 줄마다 시작점이 달라져 읽기 나쁘다.
 *  ⚠ 강순기 문서의 **값**을 보고 판정하면 안 된다 — 값은 고객마다 달라진다.
 *    자리는 **양식**이 정하므로 form 쪽 셀에서 토큰을 찾는다. */
function tokenSlots(forms: HwpxTable[]): Set<string> {
  const s = new Set<string>()
  for (const [ti, t] of forms.entries()) {
    for (const c of t.cells) if (/\{\{[^}]+\}\}/.test(c.text)) s.add(`${ti},${c.row},${c.col}`)
  }
  return s
}
const TOKEN_CELLS = tokenSlots(form)
console.log(`ERP가 채우는 칸(토큰 자리) ${TOKEN_CELLS.size}개 → 좌측정렬`)

/* ── OOXML ── */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const colName = (i: number) => { let s = '', n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 } while (n >= 0); return s }
const addr = (r: number, c: number) => `${colName(c)}${r + 1}`

/* ── 글자색 (소방계획서_47 S6) ─────────────────────────────────────────────
 *  「hwp에서 빨강 글씨는 엑셀에서도 빨강」(사용자 지시). 색은 양식 hwpx가 원천이다.
 *  ⚠ **흰색(#FFFFFF)은 쓰지 않는다.** 원본에선 어두운 바탕 위 글자인데 우리는 그 바탕을
 *    재현하지 않으므로, 그대로 넣으면 흰 종이에 흰 글씨가 되어 **사라진다**(40칸). */
const cellColor = scanCellColors(headerXml, sectionXml).colors
const DROP_COLORS = new Set(['FFFFFF'])
const usedColors = [...new Set([...cellColor.values()])].filter(c => !DROP_COLORS.has(c))
const PALETTE = ['000000', ...usedColors]                 // 0번은 기본 검정
const colorIdxOf = new Map(PALETTE.map((c, i) => [c, i]))
console.log(`글자색 ${usedColors.length}종 적용 (${usedColors.map(c => '#' + c).join(' ')}) · 흰색 ${[...cellColor.values()].filter(c => DROP_COLORS.has(c)).length}칸은 제외`)

/* ── 테두리 (소방계획서_47 S10) ──
 *  🚨종전에는 **전 칸에 일률적으로 실선**을 그었다 — 원본 hwp에 선이 없는 자리에도 선이 생겨
 *  「엑셀엔 선이 있고 hwp엔 없다」는 지적을 받았다. 양식이 셀마다 `borderFillIDRef`를 갖고 있으므로
 *  그대로 옮긴다. 없는 선은 **긋지 않는다**. */
/* ⚠ `fills`는 배열이 아니라 **Map<id, fill>**이다 — 반환 모양을 추측했다가 `BF.map is not a function`으로
 *   섰다(오늘 스키마 추측으로 세 번째다). 타입을 읽고 쓸 것. */
const BFR = parseBorderFills(headerXml)
const bfById = BFR.fills
if (BFR.unknownBorderTypes.length) console.log(`⚠ 매핑 못 한 테두리 종류 ${BFR.unknownBorderTypes.length}종: ${BFR.unknownBorderTypes.slice(0, 5).join(', ')}`)
const XL_BORDER: Record<string, string> = {
  none: '', thin: 'thin', medium: 'medium', thick: 'thick', double: 'double', dashed: 'dashed',
}
/** 셀의 테두리 조합 키 — 같은 조합은 한 스타일을 나눠 쓴다 */
function borderKeyOf(bfId: number): string {
  const f = bfById.get(bfId)
  if (!f) return 'thin|thin|thin|thin'          // 모르면 종전대로(선을 잃는 쪽보다 안전)
  return [f.left, f.right, f.top, f.bottom].map(k => XL_BORDER[k] ?? 'thin').join('|')
}
const borderKeys: string[] = []
const borderIdxOf = new Map<string, number>()
for (const t of form) for (const c of t.cells) {
  const k = borderKeyOf(c.borderFillId)
  if (!borderIdxOf.has(k)) { borderIdxOf.set(k, borderKeys.length); borderKeys.push(k) }
}
console.log(`테두리 조합 ${borderKeys.length}종 (borderFill ${bfById.size}개) — 원본에 선이 없는 자리는 긋지 않는다`)

/* 정렬 5종 × 색 N종 × 테두리 M종 → cellXfs */
const A_CENTER = 0, A_BANNER = 1, A_CHECK = 2, A_RIGHT = 3, A_LEFT = 4
const NA = 5
const styleAt = (align: number, color: string | undefined, borderKey = 'thin|thin|thin|thin') =>
  1 + ((borderIdxOf.get(borderKey) ?? 0) * PALETTE.length + (colorIdxOf.get(color ?? '000000') ?? 0)) * NA + align
const STYLE_BODY = styleAt(A_CENTER, undefined), STYLE_BANNER = styleAt(A_BANNER, undefined)
const STYLE_CHECK = styleAt(A_CHECK, undefined), STYLE_RIGHT = styleAt(A_RIGHT, undefined)
const STYLE_LEFT = styleAt(A_LEFT, undefined)

/** 체크 칸인가 — 원본 서식(서식 1.4)은 이런 칸을 **좌정렬**한다. 가운데 정렬하면 상자가 글자
 *  덩어리와 함께 떠서 목록을 눈으로 훑기 어렵다.
 *
 *  ⚠ 글리프가 **세 종류**다(실측): `□` U+25A1 406개 · `☐` U+2610 174개 · `■` U+25A0 66개.
 *  눈으로는 구별되지 않아서, `[☐■]`만 쓴 1차 정규식이 646개 중 **240개만** 잡았다 —
 *  좌정렬이 절반만 걸려 있었고 화면으로는 "왜 얘만 안 움직이지"로 보였다.
 *  글리프 목록을 손으로 적을 땐 **실측으로 세고 적을 것**. */
const CHECK_GLYPHS = '□☐■▣☑☒✓✔'   // □ ☐ ■ ▣ ☑ ☒ ✓ ✔
const isCheckText = (v: string) => new RegExp(`^\\s*[${CHECK_GLYPHS}]`).test(v)

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
      /* 정렬 판정 순서가 중요하다.
       *  ① 머리띠 ② 체크(「□ 1대」처럼 단위로도 읽히는 글자가 있어 단위보다 먼저)
       *  ③ 단위 칸(「  년   월」 — 값을 왼쪽에 적으므로 우정렬, 사용자 지시)
       *  ④ **ERP가 채우는 칸 → 좌정렬**(사용자 지시) ⑤ 긴 문장 → 좌 ⑥ 나머지 라벨 → 가운데 */
      const align = isBanner ? A_BANNER
        : isCheckText(v) ? A_CHECK
          : isUnitCell(v) ? A_RIGHT
            : TOKEN_CELLS.has(`${ti},${c.row},${c.col}`) ? A_LEFT
              : isProse(v) ? A_LEFT
                : A_CENTER
      /* 색·테두리는 **양식**이 정한다(고객 값과 무관) — 흰색은 위에서 걸러 기본 검정으로 떨어진다 */
      const col = cellColor.get(`${ti},${c.row},${c.col}`)
      const bk = borderKeyOf(c.borderFillId)
      const st = styleAt(align, col && !DROP_COLORS.has(col) ? col : undefined, bk)
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
  /* ⭐ 세로 압축은 **행이 많을 때만** 푼다 (2026-09-08 사용자 확정: "글자가 깨지면 50쪽을 넘어도
   *  된다 · 1~5장 넘겨도 된다"). 가로 폭은 언제나 1쪽에 맞추되(fitToWidth=1), 긴 시트는
   *  fitToHeight=0으로 **자연 크기로 흘려보낸다** — 억지로 한 쪽에 넣으면 글자가 뭉갠다.
   *  임계는 세로 A4에 무리 없이 들어가는 행 수에서 잡았다(가로는 더 낮다). */
  /* ⭐ 「글자가 뭉개지면 안 된다」(2026-09-08 사용자 확정)가 쪽수보다 앞선다.
   *  행 수로 어림잡지 않고 **실제 축소율을 계산**한다 — 행 높이 합과 A4 인쇄 영역을 비교해,
   *  MIN_SCALE 아래로 줄어들어야만 1쪽 강제를 풀고 자연 크기로 흘린다.
   *  이렇게 하면 '조금만 줄이면 되는' 시트는 한 쪽에 남아 쪽수가 덜 늘어난다. */
  const rowCount = maxRow + 1
  const contentPt = [...heightAt.entries()].reduce((a, [, h]) => a + h, 0)
    + Math.max(0, rowCount - heightAt.size) * 13.5      // 높이 미지정 행은 기본값
  const A4_LONG = 842, A4_SHORT = 595, MARGIN_PT = 0.45 * 72 * 2
  const pagePt = (wide ? A4_SHORT : A4_LONG) - MARGIN_PT
  const scaleNeeded = contentPt > 0 ? pagePt / contentPt : 1
  const MIN_SCALE = 0.78                                // 이보다 더 줄면 9pt 글자가 7pt 밑으로 간다
  const fitHeight = scaleNeeded < MIN_SCALE ? 0 : 1
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${addr(maxRow, N - 1)}"/>
<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="13.5"/>
<cols><col min="1" max="${N}" width="${COL_W}" customWidth="1"/></cols>
<sheetData>${rowsXml}</sheetData>
${merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : ''}
<printOptions horizontalCentered="1"/>
<pageMargins left="0.35" right="0.35" top="0.45" bottom="0.45" header="0.2" footer="0.2"/>
<pageSetup paperSize="9" orientation="${wide ? 'landscape' : 'portrait'}" scale="100" fitToWidth="1" fitToHeight="${fitHeight}"/>
</worksheet>`
  return { name: ms.name, xml, wide, rowCount, fitHeight }
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

const built: { name: string; xml: string; wide: boolean; rowCount: number; fitHeight: number }[] = []
const failed: string[] = []
for (const ms of manifest.sheets) {
  try {
    const s = buildSheet(ms)
    built.push({ ...s, name: safeName(s.name) })
  } catch (e) { failed.push((e as Error).message.split('\n')[0]) }
}
console.log(`\n시트 ${built.length}/${manifest.sheets.length} · 실패 ${failed.length}${failed.length ? '\n  ' + failed.join('\n  ') : ''}`)
console.log(`가로 방향 ${built.filter(b => b.wide).length}장 · 세로 ${built.filter(b => !b.wide).length}장`)
const flow = built.filter(b => b.fitHeight === 0)
console.log(`세로 압축을 푼 시트 ${flow.length}장 (글자 안 뭉개게 자연 크기로 흘린다) — ${flow.map(b => `${b.name}(${b.rowCount}행)`).join(', ') || '없음'}`)
if (built.length !== manifest.sheets.length) { console.log('전건이 아니면 쓰지 않는다'); process.exit(1) }

/* ── 조립 ── */
/* ── styles.xml 생성 — 색 × 정렬 조합만큼 ──
 *  폰트: 색마다 (본문, 머리띠 굵게) 두 벌. 정렬: 가운데·머리띠·체크(좌)·단위(우)·좌 다섯.
 *  색 0(검정)의 xf 인덱스가 1~5로 종전과 같아 점검 스크립트(`_47-inspect.mts` s="3")가 그대로 산다. */
const ALIGN_XML = [
  '<alignment horizontal="center" vertical="center" wrapText="1"/>',           // A_CENTER
  /* 머리띠도 **좌정렬** — 원본은 「서식 1.6」 배지 바로 뒤에서 왼쪽으로 흐른다(image-7/12 지적).
     가운데로 몰면 배지와 제목 사이가 벌어져 원본과 다른 인상이 된다. */
  '<alignment horizontal="left" vertical="center" wrapText="1" indent="1"/>',  // A_BANNER
  '<alignment horizontal="left" vertical="center" wrapText="1" indent="1"/>',  // A_CHECK
  '<alignment horizontal="right" vertical="center" wrapText="1" indent="1"/>', // A_RIGHT
  '<alignment horizontal="left" vertical="center" wrapText="1" indent="1"/>',  // A_LEFT
]
const fontsXml = PALETTE.flatMap(c => [
  `<font><sz val="${BODY_PT}"/><color rgb="FF${c}"/><name val="맑은 고딕"/></font>`,
  `<font><sz val="${BANNER_PT}"/><b/><color rgb="FF${c}"/><name val="맑은 고딕"/></font>`,
]).join('')
/* 테두리 — 조합마다 하나. 「none」은 요소를 비워 **선을 긋지 않는다** */
const side = (k: string, tag: string) => (k ? `<${tag} style="${k}"><color rgb="FF000000"/></${tag}>` : `<${tag}/>`)
const bordersXml = borderKeys.map(key => {
  const [l, r, t, b] = key.split('|')
  return `<border>${side(l, 'left')}${side(r, 'right')}${side(t, 'top')}${side(b, 'bottom')}<diagonal/></border>`
}).join('')
const xfsXml = borderKeys.flatMap((_, bi) => PALETTE.flatMap((_, ci) => ALIGN_XML.map((al, ai) => {
  const fontId = ci * 2 + (ai === A_BANNER ? 1 : 0)
  const fill = ai === A_BANNER ? ' fillId="2" applyFill="1"' : ' fillId="0"'
  return `<xf numFmtId="0" fontId="${fontId}"${fill} borderId="${bi}" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">${al}</xf>`
}))).join('')

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="${PALETTE.length * 2}">${fontsXml}</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="${borderKeys.length}">${bordersXml}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${1 + borderKeys.length * PALETTE.length * NA}">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
${xfsXml}
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
