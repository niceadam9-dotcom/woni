/** 소방계획서 엑셀 — **클릭 가능한 양식 컨트롤 체크박스**(legacy form control).
 *
 *  법정 서식의 `□`/`■`는 원래 **글자**라서 엑셀을 받은 사람이 체크하려면 칸을 더블클릭해
 *  법정 문구 속 한 글자를 찾아 바꿔 써야 했다. 여기서 그 상자 글자를 **컨트롤로 교체**한다
 *  — 문구는 그대로 두고 상자만 전각 공백으로 비운 뒤, 같은 자리에 컨트롤을 앉힌다.
 *
 *  ── 왜 이 모양인가 (전부 실측으로 정했다. 추측 0) ──────────────────────────────
 *
 *  · **단위**: VML `x:Anchor`의 오프셋은 **픽셀**, 시트 `<controls>`의 `xdr:*Off`는 **EMU**(px×9525).
 *    같은 기하를 두 단위로 두 곳에 적어야 한다. Excel 2019이 직접 저장한 파일에서
 *    `114300 EMU ↔ 12px`로 대조해 확정했다(문서마다 설명이 갈려 추측하면 전부 밀린다).
 *
 *  · **앵커를 칸 경계에만 건다** — `(col,0,row,0) → (col+2,0,mergeEndRow+1,0)`.
 *    양끝 오프셋이 0이므로 **픽셀 산술이 식에서 사라진다**. 상자 수백 개가 글꼴 계산 하나
 *    때문에 한꺼번에 밀리는 사고를 구성적으로 막는 것이 이 설계의 전부다.
 *
 *  · **가로 정렬은 규칙이 보장한다** — 적격 조건이 「상자가 문자열 맨 앞」인데, 생성기의
 *    `classifyAlign` ②가 「체크 글리프 선두 → 좌」다. 즉 **적격이면 왼쪽 정렬**이라 컨트롤을
 *    칸 왼쪽 끝에 앉히는 이 설계가 성립한다(582/582 `horizontal="left"` 실측 · 우연이 아니다).
 *    🚨 그 규칙이 바뀌면 여기가 조용히 깨진다 — 검사가 두 술어의 결합을 직접 단언한다.
 *
 *  · **세로 정렬은 공짜다** — 대상 칸이 전부 `vertical="center"`이고 컨트롤도 `TextVAlign=Center`라
 *    행 높이가 24pt든 40pt든 글자와 함께 가운데에 선다(**582/582 실측**, 확대 전엔 1.4 42/42).
 *
 *  · **컨트롤 폭 2열이 옆 칸을 안 덮는다** — 적격 칸의 병합 폭 최솟값이 **3열**이다(582칸 실측).
 *    🚨 단 **병합이 여러 행에 걸치면 끝 행까지 걸어야 한다** — 첫 행에만 걸었더니
 *      「피난기구」(J16:Q17)의 상자만 글자보다 위로 떠 보였다(렌더로 잡았다. 수치 검사는 통과했다).
 *
 *  · **대상 목록의 원천은 manifest다**(`boxes`). 주입이 끝난 XML에서 `■`를 세면 안 된다 —
 *    체크된 상자와 **법정 불릿**(`bulletCells`, 상자가 아니라 글머리표)이 같은 글자라 구별이 안 된다.
 *    manifest는 둘을 이미 갈라 두었다(겹침 0건 실측).
 *
 *  ⚠ 이 단계는 **사진 삽입보다 먼저** 돌아야 한다. CT_Worksheet 순서가 `drawing → legacyDrawing`
 *    이고, `fire-plan-xlsx-images.ts`의 `insertDrawingTag`가 `<legacyDrawing` **앞에** 끼워 넣도록
 *    이미 짜여 있다. 순서를 어기면 **LibreOffice는 통과하고 Excel만** 복구 대화상자를 띄운다.
 *
 *  ⚠ 한 칸에서 「상자 비우기」와 「컨트롤 달기」는 **함께 일어나거나 둘 다 일어나지 않는다**.
 *    상자만 지우고 컨트롤이 안 붙으면 그 칸은 체크할 자리 자체가 사라진다 — 오늘보다 나쁘다.
 */
import JSZip from 'jszip'
import { escXml, sheetFileMap } from '@/lib/xlsx-inject'
import { FIRE_PLAN_MANIFEST, sheetManifest } from '@/lib/fire-plan-xlsx-manifest'
import { FIRE_PLAN_MARK_CHECKED_RE } from '@/lib/fire-plan-scrub'
import { CHECKBOX_BOX_OFFSETS } from '@/lib/fire-plan-checkbox-offsets'

/**
 * 컨트롤을 다는 시트 = **워크북 전체**(2026-09-14 확대. 종전엔 `['1.4 소방시설 현황']` 하나였다).
 *
 * 목록을 손으로 적지 않고 manifest에서 낸다 — 서식이 시트를 하나 얻으면 그 시트의 상자도 자동으로
 * 대상이 된다. 손목록이면 **새 시트만 조용히 빠지고** 아무도 모른다(적격 판정은 어차피
 * `firePlanCheckboxCells`가 하므로, 상자 없는 시트는 여기 있어도 0칸으로 지나간다).
 *
 * 🚨 이 상수를 「일부만」으로 되돌리려거든 **왜 빼는지**를 여기 적을 것. 종전의 「단계적으로
 *   넓힌다」는 넓히고 나면 근거가 사라지는 말이라, 남아 있으면 다음 사람이 축소를 정상으로 읽는다.
 */
export const CHECKBOX_SHEETS: readonly string[] = FIRE_PLAN_MANIFEST.sheets.map(s => s.name)

/** 빈 상자 글자(F-6 — 원본이 두 글자를 섞어 쓴다) */
const EMPTY_BOX_RE = /[□☐]/
/** 지금 칸에 있는 **상자 자리** 전부 — 꺼진 것(`□ ☐`)과 켜진 것을 함께 센다.
 *  ⚠ 켜짐 쪽 정본은 `FIRE_PLAN_MARK_CHECKED_RE`이고 여기 목록은 그 **한 글자 갈래**다. */
const BOX_ANY_RE = /[□☐■☑▣]/g
/** 칸 왼쪽 끝 → **글자가 시작하는 자리**(px). 적격 칸이 전부 `indent="1"`이라 상수다(실측).
 *
 *  🚨 이만큼 안 밀면 컨트롤이 원래 상자보다 왼쪽에 선다 — 43·44회차로 나간 582개가 그 상태였고,
 *    「적용본 vs 원본」 렌더를 나란히 놓고 **첫 잉크 덩어리의 왼쪽 끝**을 비교해 처음 드러났다
 *    (`_probe-cb-xshift.mts`, 14렌더px ≒ 15시트px). 눈이 아니라 렌더가 정한 값이다. */
const TEXT_INSET_PX = 15
/* 🚨 **상자 글자를 다른 글자로 바꾸지 않는다. 색만 배경색으로 칠한다.**
 *
 *  종전엔 전각 공백(`　`)으로 갈아 끼웠는데, 칸 안에서 `□`는 **SegoeUISymbol**(윈도 글꼴 대체)이고
 *  `　`는 맑은 고딕이라 **전진 폭이 다르다**. 그래서 상자 하나를 비울 때마다 **뒤 글자가 왼쪽으로
 *  밀렸고**, 다중상자 칸에서는 라벨이 컨트롤 밑으로 파고들었다(인쇄 렌더로 확인).
 *  글자를 그대로 두고 색만 바꾸면 **배치가 한 픽셀도 안 움직인다** — 그래서 측정한 오프셋이
 *  그대로 맞고, 덤으로 칸 값에 법정 문구가 **글자 그대로** 남는다. */
const HIDDEN_FILL_DEFAULT = 'FFFFFFFF'
/** 컨트롤 폭(미세 격자 열 수). 1열=13px이고 상자 글자가 13px이라 2열이면 딱 덮는다. */
const CTRL_COLS = 2
const PX_PER_COL = 13
const EMU_PER_PX = 9525

export type CheckboxCell = {
  cell: string
  /** 0-based */
  col: number
  /** 0-based */
  row0: number
  /** 이 칸에서 **몇 번째 상자**인가(0부터). 한 상자짜리 칸은 늘 0 */
  boxIndex: number
  /** 칸의 첫 상자로부터 이 상자까지의 가로 거리(px). 첫 상자는 0 */
  offsetPx: number
}

const colNum = (s: string) => [...s].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1

/** 시트 왼쪽부터의 px → `(열, 그 열 안 오프셋)`.
 *  큰 오프셋을 한 열에 몰아 주면 뷰어가 열 폭으로 **클램프**해 왼쪽에 붙는다(사진 상자 실사고).
 *  그래서 열을 옮기고 **나머지만** 오프셋으로 준다. 미세 격자라 열 폭이 균일해 나눗셈 한 번이다. */
function splitPx(px: number): { col: number; off: number } {
  const col = Math.floor(px / PX_PER_COL)
  return { col, off: Math.round(px - col * PX_PER_COL) }
}

/**
 * 컨트롤을 달 **상자** — **manifest의 `labels`만으로** 판정한다(템플릿 바이트 불필요).
 *
 * 반환 단위는 「칸」이 아니라 **「상자」**다(2026-09-14 다중상자 지원). `□ 유   □ 무` 한 칸은
 * 둘을 낸다 — 사용자가 「유」와 「무」를 **따로** 눌러야 하기 때문이다.
 *
 * 다는 조건: 「상자가 문자열 맨 앞 · 한 줄」. 그리고 상자가 여럿이면 **그 글자의 오프셋 표가
 * 있어야** 한다. 나머지는 일부러 뺀다:
 *  · 상자가 글 중간인 칸(`※ □에는 …`) — 애초에 체크박스가 아니라 **산문**이다.
 *  · 여러 줄인 칸 — 상자는 첫 줄에 있는데 글 덩어리는 가운데 정렬이라 세로로 어긋난다.
 * 뺀 칸은 오늘처럼 `□` 글자로 남는다. **퇴행이 아니라 미적용**이다.
 *
 * 🚨 둘째 상자부터의 가로 자리는 **계산하지 않는다.** 한 칸 안에서 글꼴이 섞이고(상자는
 *   SegoeUISymbol) 공백이 자간 보정으로 벌어져, 글자 폭 모델은 9%까지 어긋났다(실패 기록).
 *   값은 `fire-plan-checkbox-offsets.ts` — **Excel이 인쇄한 것을 렌더 차이로 잰** 표다.
 * ⚠ 표에 없는 다중상자 칸은 **통째로 뺀다**(반만 달면 오늘보다 나쁘다). 검사가 그 수를 못 박는다.
 */
export function firePlanCheckboxCells(sheet: string): CheckboxCell[] {
  const man = sheetManifest(sheet)
  const out: CheckboxCell[] = []
  for (const cell of Object.keys(man.boxes)) {
    const label = man.labels[cell]
    if (label === undefined) continue
    const at = [...label.matchAll(/[□☐]/g)].map(m => m.index!)
    if (!at.length) continue
    if (!EMPTY_BOX_RE.test(label.trim()[0] ?? '')) continue
    if (label.includes('\n')) continue
    const m = /^([A-Z]+)(\d+)$/.exec(cell)
    if (!m) continue
    const col = colNum(m[1]), row0 = Number(m[2]) - 1
    if (at.length === 1) { out.push({ cell, col, row0, boxIndex: 0, offsetPx: 0 }); continue }
    const offs = CHECKBOX_BOX_OFFSETS[label]
    if (!offs || offs.length !== at.length) continue        // 표 없는 칸은 통째로 미적용
    for (let i = 0; i < at.length; i++) out.push({ cell, col, row0, boxIndex: i, offsetPx: offs[i] })
  }
  // 좌표 순 — VML의 z-index와 컨트롤 이름이 매 생성마다 같은 순서로 나오게 한다(산출물 재현성)
  return out.sort((a, b) => a.row0 - b.row0 || a.col - b.col || a.boxIndex - b.boxIndex)
}

export type CheckboxApplyResult = {
  bytes: Uint8Array
  /** 실제로 달린 컨트롤 수 */
  applied: number
  /** 달지 못한 칸 — 조용히 버리지 않는다. 그 칸은 상자 글자를 **그대로 둔다**(오늘과 동일) */
  skipped: string[]
}

/** 칸 스타일 → 배경색(ARGB). 상자를 **그 칸의 바탕색**으로 칠해 안 보이게 한다 —
 *  흰색으로 고정하면 색 깔린 칸(실측 17칸)에서 흰 네모가 드러난다. */
function fillColorTable(styles: string): (styleIdx: number) => string {
  const xfs = [...(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '')
    .matchAll(/<xf\b[\s\S]*?(?:\/>|<\/xf>)/g)].map(m => m[0])
  const fills = [...(/<fills[^>]*>([\s\S]*?)<\/fills>/.exec(styles)?.[1] ?? '')
    .matchAll(/<fill>[\s\S]*?<\/fill>/g)].map(m => m[0])
  return (styleIdx: number) => {
    const fid = Number(/fillId="(\d+)"/.exec(xfs[styleIdx] ?? '')?.[1] ?? 0)
    const f = fills[fid] ?? ''
    if (!f || f.includes('patternType="none"')) return HIDDEN_FILL_DEFAULT
    return /<fgColor rgb="([0-9A-Fa-f]{8})"/.exec(f)?.[1] ?? HIDDEN_FILL_DEFAULT
  }
}

/** 시트 XML에서 `시작칸 → 끝 행(1-based)` 병합 표 */
function mergeEndRows(xml: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const m of xml.matchAll(/<mergeCell ref="([A-Z]+\d+):[A-Z]+(\d+)"\/>/g)) out.set(m[1], Number(m[2]))
  return out
}

/** 행 높이(pt) 표와 기본 행 높이 — VML `style`의 margin-top·height용.
 *  ⚠ 엑셀은 행 높이를 **정수 픽셀로 내림**한다(floor). 반올림으로 쓰면 누적 오차가 생긴다:
 *    1.4 시트 행1~20 누적이 floor로는 640px=480pt로 Excel 실측 `J21.Top`과 정확히 맞았다. */
function rowPixels(xml: string): { px: Map<number, number>; defaultPx: number } {
  const defHt = Number(/<sheetFormatPr[^>]*defaultRowHeight="([\d.]+)"/.exec(xml)?.[1] ?? 15)
  const px = new Map<number, number>()
  for (const m of xml.matchAll(/<row r="(\d+)"([^>]*)>/g)) {
    const ht = /ht="([\d.]+)"/.exec(m[2])?.[1]
    if (ht) px.set(Number(m[1]), Math.floor(Number(ht) * 4 / 3))
  }
  return { px, defaultPx: Math.floor(defHt * 4 / 3) }
}

const VML_SHAPETYPE =
  '<v:shapetype id="_x0000_t201" coordsize="21600,21600" o:spt="201" path="m,l,21600r21600,l21600,xe">'
  + '<v:stroke joinstyle="miter"/>'
  + '<v:path shadowok="f" o:extrusionok="f" strokeok="f" fillok="f" o:connecttype="rect"/>'
  + '<o:lock v:ext="edit" shapetype="t"/></v:shapetype>'

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006'

/**
 * 주입이 끝난 워크북에 체크박스 컨트롤을 심는다. 원본 bytes는 변형하지 않는다.
 *
 * 체크 여부는 **그 칸에 지금 적힌 글**이 정한다(`■`면 켜짐). 값 계층을 건드리지 않아도 되는 이유이고,
 * 주입이 안 닿은 칸은 템플릿의 `□` 그대로라 자연히 꺼짐이 된다.
 */
export async function applyFirePlanCheckboxes(
  bytes: Uint8Array, sheets: readonly string[] = CHECKBOX_SHEETS,
): Promise<CheckboxApplyResult> {
  const zip = await JSZip.loadAsync(bytes)
  const files = await sheetFileMap(zip)
  const fillOf = fillColorTable(await zip.file('xl/styles.xml')!.async('string'))
  const skipped: string[] = []
  let applied = 0
  let ctrlPropNo = 0          // 워크북 전역 번호 — 시트마다 1부터 세면 파트가 서로 덮어쓴다
  let vmlNo = 0

  for (const sheet of sheets) {
    const path = files.get(sheet)
    const file = path ? zip.file(path) : null
    if (!file) { skipped.push(`${sheet}!(시트 없음)`); continue }
    let xml = await file.async('string')

    const cells = firePlanCheckboxCells(sheet)
    const merges = mergeEndRows(xml)
    const { px: rowPx, defaultPx } = rowPixels(xml)
    const topPxOf = (row1: number) => {
      let t = 0
      for (let r = 1; r < row1; r++) t += rowPx.get(r) ?? defaultPx
      return t
    }

    const shapes: string[] = []
    const controls: string[] = []
    const rels: string[] = []
    const vmlPart = `xl/drawings/vmlDrawing${++vmlNo}.vml`
    const vmlRid = 'rIdCbVml'
    /** 🚨 **VML shape id 블록**. `<o:idmap data="N">`은 「이 그림이 id 블록 N을 소유한다」는 선언이고,
     *  그 블록의 shape id는 `N*1024 … N*1024+1023`이다. 파트마다 **다른 N**이어야 한다.
     *
     *  ⚠ 이걸 몰라 28개 파트가 전부 `data="1"`을 주장한 판을 만들었더니, 노드 검사 52/0·변이 15/15가
     *    전부 초록인데 **실제 Excel이 컨트롤을 두 배로 셌다**(582 → 1163). 시트마다 shape id가
     *    모호해져 `<control shapeId>`가 VML shape와 짝을 못 짓고 각각 별개 객체가 된 것이다.
     *    한 시트만 달 때는 블록이 하나뿐이라 **존재할 수 없던 결함**이다 — 확대가 만든 결함이고,
     *    LibreOffice도 노드도 통과시켰다. 잡은 것은 Excel COM 검증뿐이다. */
    const idBlock = vmlNo

    // 🚨 상자가 아니라 **칸 단위로 묶어** 돈다. 한 칸에 상자가 여럿이면 글자 교체가 서로를
    //   밀어내기 때문이다 — 첫 상자를 비운 뒤 「두 번째 상자」를 다시 찾으면 이미 하나가 사라져
    //   순번이 어긋난다. 한 칸의 상자를 **한 번에** 처리하고 글자도 한 번에 갈아 끼운다.
    const byCell = new Map<string, CheckboxCell[]>()
    for (const c of cells) {
      const list = byCell.get(c.cell)
      if (list) list.push(c); else byCell.set(c.cell, [c])
    }

    for (const [cellRef, boxes] of byCell) {
      const c = boxes[0]
      // ── 이 칸이 지금 어떤 글을 들고 있나. 자기닫힘 `<c …/>`를 함께 받지 않으면
      //    `[^>]*`가 `/`까지 삼키고 다음 `</c>`까지 먹어 **엉뚱한 칸**을 고친다(xlsx-inject와 같은 함정).
      const re = new RegExp(`<c r="${cellRef}"((?:[^>/]|/(?!>))*)>([\\s\\S]*?)</c>`)
      const m = re.exec(xml)
      const tm = m ? /(<t[^>]*>)([\s\S]*?)(<\/t>)/.exec(m[2]) : null
      if (!m || !tm) { for (const b of boxes) skipped.push(`${sheet}!${cellRef}#${b.boxIndex}`); continue }
      const text = tm[2]
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

      // 지금 이 칸에 실제로 있는 상자 글자들(켜짐·꺼짐 함께).
      // ⚠ 개수가 manifest와 다르면 주입이 값을 통째로 갈았거나 서식이 바뀐 것이다 —
      //   그 칸은 **글자를 건드리지 않고** 통째로 물러난다(반만 달면 오늘보다 나쁘다).
      const hits = [...text.matchAll(BOX_ANY_RE)]
      if (hits.length !== boxes.length) { for (const b of boxes) skipped.push(`${sheet}!${cellRef}#${b.boxIndex}`); continue }

      // 상자 글자를 **그 칸의 바탕색으로 칠한다**(글자는 그대로 → 배치가 안 움직인다).
      const fill = fillOf(Number(/ s="(\d+)"/.exec(m[1])?.[1] ?? 0))
      const hidden = new Set(hits.map(h => h.index!))
      const runs: string[] = []
      let buf = ''
      const flush = () => { if (buf) { runs.push(`<r><t xml:space="preserve">${escXml(buf)}</t></r>`); buf = '' } }
      { let s = 0
        for (const ch of text) {
          if (hidden.has(s)) { flush(); runs.push(`<r><rPr><color rgb="${fill}"/></rPr><t xml:space="preserve">${escXml(ch)}</t></r>`) }
          else buf += ch
          s += ch.length
        } }
      flush()
      const isBody = runs.join('')

      const endRow1 = merges.get(cellRef) ?? c.row0 + 1     // 병합이 없으면 자기 행 하나
      const topPt = (topPxOf(c.row0 + 1) * 0.75).toFixed(2)
      const wPt = (CTRL_COLS * PX_PER_COL * 0.75).toFixed(2)
      let hPx = 0
      for (let r = c.row0 + 1; r <= endRow1; r++) hPx += rowPx.get(r) ?? defaultPx
      const hPt = (hPx * 0.75).toFixed(2)

      for (let bi = 0; bi < boxes.length; bi++) {
      const b = boxes[bi]
      const checked = FIRE_PLAN_MARK_CHECKED_RE.test(hits[bi][0])
      // 이 시트(=이 VML 파트)가 소유한 블록 안에서 1부터. 블록당 1023개가 상한인데 한 시트
      // 최대가 124칸이라 여유가 크다 — 그래도 넘으면 조용히 밀리므로 아래에서 막는다.
      const shapeId = idBlock * 1024 + shapes.length + 1
      const propNo = ++ctrlPropNo
      const rid = `rIdCb${propNo}`

      /* 가로 자리 = 칸 왼쪽 + **글자 들여쓰기** + 이 상자의 오프셋.
       * 오프셋이 칸 경계를 넘으면 열을 옮기고 나머지만 준다(`splitPx`) — 미세 격자에서 큰
       * 오프셋을 한 열에 몰아 주면 뷰어가 클램프해 왼쪽에 붙는다(사진 상자 실사고). */
      const leftPx = c.col * PX_PER_COL + TEXT_INSET_PX + b.offsetPx
      const from = splitPx(leftPx)
      const to = splitPx(leftPx + CTRL_COLS * PX_PER_COL)
      const leftPt = (leftPx * 0.75).toFixed(2)

      // 🚨 아래 모서리는 **「다음 행의 꼭대기」가 아니라 「마지막 덮는 행 + 그 행 높이」**로 적는다.
      //   같은 자리를 가리키지만 **끝 행 번호가 한 칸 작아진다**. 앞의 표기는 시트의 마지막 행에
      //   붙은 컨트롤에서 `to row`가 dimension을 **넘어서고**, 그러면 엑셀이 그 다음 빈 행까지
      //   인쇄 범위에 넣어 **표 아래에 점선 테두리가 띠처럼 찍힌다**(28장 중 3장: 1.11.1·1.14.1·2.5).
      //   ⚠ 수치 검사·변이·LibreOffice는 전부 통과했고, **인쇄 렌더를 대조군과 나란히 놓았을 때만**
      //     드러났다. 1.4 한 장만 달던 시절엔 그 시트가 넘치지 않아 존재할 수 없던 결함이다.
      //   ⚠ 오프셋이 0이 아닌 곳은 여기 하나뿐이고, 값은 글꼴이 아니라 **행 높이 실측**이다.
      //     틀리면 Excel COM 위치 검사(칸 좌상단 ≤1pt)가 전 워크북에서 문다.
      const toRow0 = endRow1 - 1
      const toRowOffPx = rowPx.get(endRow1) ?? defaultPx

      shapes.push(
        `<v:shape id="_x0000_s${shapeId}" type="#_x0000_t201" style='position:absolute;`
        + `margin-left:${leftPt}pt;margin-top:${topPt}pt;width:${wPt}pt;height:${hPt}pt;`
        + `z-index:${applied + 1};mso-wrap-style:tight' filled="f" fillcolor="windowText [64]"`
        + ` stroked="f" strokecolor="window [65]" strokeweight="3e-5mm" o:insetmode="auto">`
        + '<v:fill color2="window [65]"/><v:path shadowok="t" strokeok="t" fillok="t"/>'
        + '<o:lock v:ext="edit" rotation="t"/>'
        + `<v:textbox style='mso-direction-alt:auto' o:singleclick="f"><div style='text-align:left'></div></v:textbox>`
        // ⚠ ClientData의 자식 **순서는 스키마 sequence다**. Excel이 저장한 순서를 그대로 따른다.
        + '<x:ClientData ObjectType="Checkbox"><x:SizeWithCells/>'
        + `<x:Anchor>${from.col}, ${from.off}, ${c.row0}, 0, ${to.col}, ${to.off}, ${toRow0}, ${toRowOffPx}</x:Anchor>`
        + '<x:AutoFill>False</x:AutoFill><x:AutoLine>False</x:AutoLine><x:TextVAlign>Center</x:TextVAlign>'
        + (checked ? '<x:Checked>1</x:Checked>' : '')
        + '<x:NoThreeD/></x:ClientData></v:shape>')

      controls.push(
        `<mc:AlternateContent xmlns:mc="${MC_NS}"><mc:Choice Requires="x14">`
        + `<control shapeId="${shapeId}" r:id="${rid}" name="Check Box ${propNo}">`
        + '<controlPr defaultSize="0" autoFill="0" autoLine="0" autoPict="0">'
        + '<anchor moveWithCells="1">'
        + `<from><xdr:col>${from.col}</xdr:col><xdr:colOff>${from.off * EMU_PER_PX}</xdr:colOff>`
        + `<xdr:row>${c.row0}</xdr:row><xdr:rowOff>0</xdr:rowOff></from>`
        + `<to><xdr:col>${to.col}</xdr:col><xdr:colOff>${to.off * EMU_PER_PX}</xdr:colOff>`
        + `<xdr:row>${toRow0}</xdr:row><xdr:rowOff>${toRowOffPx * EMU_PER_PX}</xdr:rowOff></to>`
        + '</anchor></controlPr></control></mc:Choice></mc:AlternateContent>')

      rels.push(`<Relationship Id="${rid}" Type="${REL_NS}/ctrlProp" Target="../ctrlProps/ctrlProp${propNo}.xml"/>`)
      zip.file(`xl/ctrlProps/ctrlProp${propNo}.xml`,
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
        + '<formControlPr xmlns="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"'
        + ` objectType="CheckBox"${checked ? ' checked="Checked"' : ''} lockText="1" noThreeD="1"/>`)

      applied++
      }

      // 색칠은 **이 칸의 컨트롤 조립이 다 끝난 뒤 한 번**에 한다 — 중간에 물러나면 글자가 안 바뀐다.
      const patched = m[0].replace(/<is>[\s\S]*?<\/is>/, () => `<is>${isBody}</is>`)
      xml = xml.replace(m[0], () => patched)
    }

    if (!shapes.length) { vmlNo--; continue }
    // 블록 하나는 1023개까지다. 넘으면 다음 블록을 침범해 **다른 시트의 컨트롤과 섞인다** —
    // 조용히 틀리느니 끊는다(현재 최대 시트가 124칸이라 실제로 걸릴 일은 없다).
    if (shapes.length > 1023) throw new Error(`체크박스 ${shapes.length}개 > 블록 상한 1023 — ${sheet}`)

    zip.file(vmlPart,
      '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"'
      + ' xmlns:x="urn:schemas-microsoft-com:office:excel">'
      + `<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${idBlock}"/></o:shapelayout>`
      + VML_SHAPETYPE + shapes.join('') + '</xml>')

    // ── 시트 rels. 이 템플릿엔 없지만 **있으면 이어 붙인다**(사진 단계가 뒤에 또 붙인다)
    const relsPath = path!.replace(/worksheets\/([^/]+)$/, 'worksheets/_rels/$1.rels')
    const existing = zip.file(relsPath) ? await zip.file(relsPath)!.async('string') : null
    const vmlRel = `<Relationship Id="${vmlRid}" Type="${REL_NS}/vmlDrawing" Target="../drawings/vmlDrawing${vmlNo}.vml"/>`
    zip.file(relsPath, existing
      ? existing.replace('</Relationships>', vmlRel + rels.join('') + '</Relationships>')
      : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + vmlRel + rels.join('') + '</Relationships>')

    // ── 루트 namespace. xdr·x14·mc가 없으면 `<controls>` 블록이 통째로 미정의 접두사가 된다
    const rootTag = /<worksheet[^>]*>/.exec(xml)![0]
    let root = rootTag
    if (!/xmlns:xdr=/.test(root)) root = root.replace(/>$/, ' xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">')
    if (!/xmlns:x14=/.test(root)) root = root.replace(/>$/, ' xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">')
    if (!/xmlns:mc=/.test(root)) root = root.replace(/>$/, ` xmlns:mc="${MC_NS}">`)
    if (root !== rootTag) xml = xml.replace(rootTag, () => root)

    // ── 꼬리. CT_Worksheet 순서상 `legacyDrawing`·`controls` 뒤에 올 수 있는 형제 앞에 둔다.
    //    이 템플릿의 꼬리는 `…pageSetup`으로 끝나므로 실제로는 `</worksheet>` 직전이다.
    const tail = `<legacyDrawing r:id="${vmlRid}"/>`
      + `<mc:AlternateContent xmlns:mc="${MC_NS}"><mc:Choice Requires="x14"><controls>`
      + controls.join('') + '</controls></mc:Choice></mc:AlternateContent>'
    let at = -1
    for (const after of ['<picture', '<oleObjects', '<webPublishItems', '<tableParts', '<extLst']) {
      const i = xml.indexOf(after)
      if (i >= 0) { at = i; break }
    }
    xml = at >= 0 ? xml.slice(0, at) + tail + xml.slice(at)
      : xml.slice(0, xml.lastIndexOf('</worksheet>')) + tail + '</worksheet>'
    zip.file(path!, xml)
  }

  if (applied) {
    let ct = await zip.file('[Content_Types].xml')!.async('string')
    if (!/Extension="vml"/.test(ct)) {
      ct = ct.replace('<Default Extension="xml"',
        '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/><Default Extension="xml"')
    }
    // ctrlProp은 확장자가 .xml이라 Default("application/xml")에 잡힌다 — 칸마다 Override가 **필수**다
    const overrides: string[] = []
    for (let i = 1; i <= ctrlPropNo; i++) {
      const p = `/xl/ctrlProps/ctrlProp${i}.xml`
      if (!ct.includes(p)) overrides.push(`<Override PartName="${p}" ContentType="application/vnd.ms-excel.controlproperties+xml"/>`)
    }
    ct = ct.replace('</Types>', overrides.join('') + '</Types>')
    zip.file('[Content_Types].xml', ct)
  }

  return { bytes: new Uint8Array(await zip.generateAsync({ type: 'uint8array' })), applied, skipped }
}
