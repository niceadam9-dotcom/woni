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
 *  · **세로 정렬은 공짜다** — 대상 칸이 전부 `vertical="center"`이고 컨트롤도 `TextVAlign=Center`라
 *    행 높이가 24pt든 40pt든 글자와 함께 가운데에 선다(1.4 시트 42/42 실측).
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
import { sheetManifest } from '@/lib/fire-plan-xlsx-manifest'
import { FIRE_PLAN_MARK_CHECKED_RE } from '@/lib/fire-plan-scrub'

/** 컨트롤을 다는 시트. 단계적으로 넓힌다 — 늘릴 때 이 배열만 고치면 된다. */
export const CHECKBOX_SHEETS: readonly string[] = ['1.4 소방시설 현황']

/** 빈 상자 글자(F-6 — 원본이 두 글자를 섞어 쓴다) */
const EMPTY_BOX_RE = /[□☐]/
/** 상자를 비울 때 쓰는 글자. **전각** 공백이라야 폭이 보존된다 —
 *  반각으로 바꾸면 뒤 문구가 7.5pt 왼쪽으로 밀려 컨트롤 밑으로 들어간다. */
const BLANK = '　'
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
}

const colNum = (s: string) => [...s].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1

/**
 * 컨트롤을 달 칸 — **manifest의 `labels`만으로** 판정한다(템플릿 바이트 불필요).
 *
 * 지금 다는 것은 「상자 1개 · 문자열 맨 앞 · 한 줄」인 칸뿐이다. 나머지는 일부러 뺀다:
 *  · 상자가 여럿인 칸(`□ 유 □ 무`) — 둘째 상자부터는 **앞 글의 폭**이 위치를 정한다(글꼴 계산).
 *  · 상자가 글 중간인 칸(`※ □에는 …`) — 애초에 체크박스가 아니라 **산문**이다.
 *  · 여러 줄인 칸 — 상자는 첫 줄에 있는데 글 덩어리는 가운데 정렬이라 세로로 어긋난다.
 * 뺀 칸은 오늘처럼 `□` 글자로 남는다. **퇴행이 아니라 미적용**이다.
 */
export function firePlanCheckboxCells(sheet: string): CheckboxCell[] {
  const man = sheetManifest(sheet)
  const out: CheckboxCell[] = []
  for (const cell of Object.keys(man.boxes)) {
    const label = man.labels[cell]
    if (label === undefined) continue
    if ((label.match(/[□☐]/g) ?? []).length !== 1) continue
    if (!EMPTY_BOX_RE.test(label.trim()[0] ?? '')) continue
    if (label.includes('\n')) continue
    const m = /^([A-Z]+)(\d+)$/.exec(cell)
    if (!m) continue
    out.push({ cell, col: colNum(m[1]), row0: Number(m[2]) - 1 })
  }
  // 좌표 순 — VML의 z-index와 컨트롤 이름이 매 생성마다 같은 순서로 나오게 한다(산출물 재현성)
  return out.sort((a, b) => a.row0 - b.row0 || a.col - b.col)
}

export type CheckboxApplyResult = {
  bytes: Uint8Array
  /** 실제로 달린 컨트롤 수 */
  applied: number
  /** 달지 못한 칸 — 조용히 버리지 않는다. 그 칸은 상자 글자를 **그대로 둔다**(오늘과 동일) */
  skipped: string[]
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

    for (const c of cells) {
      // ── 이 칸이 지금 어떤 글을 들고 있나. 자기닫힘 `<c …/>`를 함께 받지 않으면
      //    `[^>]*`가 `/`까지 삼키고 다음 `</c>`까지 먹어 **엉뚱한 칸**을 고친다(xlsx-inject와 같은 함정).
      const re = new RegExp(`<c r="${c.cell}"((?:[^>/]|/(?!>))*)>([\\s\\S]*?)</c>`)
      const m = re.exec(xml)
      if (!m) { skipped.push(`${sheet}!${c.cell}`); continue }
      const inner = m[2]
      const tm = /(<t[^>]*>)([\s\S]*?)(<\/t>)/.exec(inner)
      if (!tm) { skipped.push(`${sheet}!${c.cell}`); continue }
      const text = tm[2]
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      const checked = FIRE_PLAN_MARK_CHECKED_RE.test(text)
      // 켜진 칸은 `■`, 꺼진 칸은 `□`/`☐`. 둘 다 없으면 이 칸은 우리가 아는 상자 칸이 아니다
      //  — 주입이 값을 통째로 비웠거나 서식이 바뀐 것이다. **글자를 건드리지 않고** 물러난다.
      const boxAt = text.search(checked ? FIRE_PLAN_MARK_CHECKED_RE : EMPTY_BOX_RE)
      if (boxAt < 0) { skipped.push(`${sheet}!${c.cell}`); continue }

      const blanked = text.slice(0, boxAt) + BLANK + text.slice(boxAt + 1)
      const endRow1 = merges.get(c.cell) ?? c.row0 + 1     // 병합이 없으면 자기 행 하나
      const shapeId = 1025 + applied
      const propNo = ++ctrlPropNo
      const rid = `rIdCb${propNo}`

      const leftPt = (c.col * PX_PER_COL * 0.75).toFixed(2)
      const topPt = (topPxOf(c.row0 + 1) * 0.75).toFixed(2)
      const wPt = (CTRL_COLS * PX_PER_COL * 0.75).toFixed(2)
      let hPx = 0
      for (let r = c.row0 + 1; r <= endRow1; r++) hPx += rowPx.get(r) ?? defaultPx
      const hPt = (hPx * 0.75).toFixed(2)

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
        + `<x:Anchor>${c.col}, 0, ${c.row0}, 0, ${c.col + CTRL_COLS}, 0, ${endRow1}, 0</x:Anchor>`
        + '<x:AutoFill>False</x:AutoFill><x:AutoLine>False</x:AutoLine><x:TextVAlign>Center</x:TextVAlign>'
        + (checked ? '<x:Checked>1</x:Checked>' : '')
        + '<x:NoThreeD/></x:ClientData></v:shape>')

      controls.push(
        `<mc:AlternateContent xmlns:mc="${MC_NS}"><mc:Choice Requires="x14">`
        + `<control shapeId="${shapeId}" r:id="${rid}" name="Check Box ${propNo}">`
        + '<controlPr defaultSize="0" autoFill="0" autoLine="0" autoPict="0">'
        + '<anchor moveWithCells="1">'
        + `<from><xdr:col>${c.col}</xdr:col><xdr:colOff>0</xdr:colOff>`
        + `<xdr:row>${c.row0}</xdr:row><xdr:rowOff>0</xdr:rowOff></from>`
        + `<to><xdr:col>${c.col + CTRL_COLS}</xdr:col><xdr:colOff>${0 * EMU_PER_PX}</xdr:colOff>`
        + `<xdr:row>${endRow1}</xdr:row><xdr:rowOff>0</xdr:rowOff></to>`
        + '</anchor></controlPr></control></mc:Choice></mc:AlternateContent>')

      rels.push(`<Relationship Id="${rid}" Type="${REL_NS}/ctrlProp" Target="../ctrlProps/ctrlProp${propNo}.xml"/>`)
      zip.file(`xl/ctrlProps/ctrlProp${propNo}.xml`,
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
        + '<formControlPr xmlns="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"'
        + ` objectType="CheckBox"${checked ? ' checked="Checked"' : ''} lockText="1" noThreeD="1"/>`)

      // 글자 교체는 **컨트롤 조립이 다 끝난 뒤**에 한다 — 위에서 중간에 물러나면 글자가 안 바뀐다
      const patched = m[0].replace(/(<t[^>]*>)([\s\S]*?)(<\/t>)/, () => `${tm[1]}${escXml(blanked)}${tm[3]}`)
      xml = xml.replace(m[0], () => patched)
      applied++
    }

    if (!shapes.length) { vmlNo--; continue }

    zip.file(vmlPart,
      '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"'
      + ' xmlns:x="urn:schemas-microsoft-com:office:excel">'
      + '<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>'
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
