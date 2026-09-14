/* ⚠ 이 표식이 붙은 모듈은 **맨 tsx로 import 하면 즉사**한다("cannot be imported from a Client
 *   Component"). 검사는 형제 모듈(`defect-photo-embed.ts`)과 같은 규약으로 돌린다 —
 *   `npx tsx --conditions=react-server scripts/test-fire-plan-images.mts`. 표식을 떼는 쪽이
 *   아니라 검사 쪽을 맞춘다: sharp를 부르는 서버 전용 코드가 맞다. */
import 'server-only'
import JSZip from 'jszip'
import sharp from 'sharp'
import { escXml, sheetFileMap } from '@/lib/xlsx-inject'
import type { Anchor } from '@/lib/xlsx-anchors'
import { FIRE_PLAN_IMAGE_BOXES, imageBoxDescr } from '@/lib/fire-plan-anchors'
import { imageKindLabel, pickFirstKind } from '@/lib/fire-plan-image-kinds'

/** 소방계획서 엑셀 — **기존 시트의 빈 상자에 사진·도면을 앉힌다** (2026-09-14)
 *
 *  여태 소방계획서 엑셀은 그림을 **한 장도** 싣지 않았다. 라우트가 `assembleFirePlan()`의
 *  `images`·`assets`를 받지도 않았고(xlsx/route.ts는 `{ data, missing }`만 구조분해했다),
 *  주입 파이프라인(`xlsx-inject`)에는 media·drawing을 다루는 코드가 0줄이었다. 그래서
 *  법정 서식이 사진을 붙이라고 비워 둔 상자(1.3 건축물 위치·진입경로도·1.5.2 평면도)가
 *  **고객이 사진을 올렸든 말든 늘 백지로** 나갔다 — PDF에는 같은 그림이 인쇄되고 있었으므로
 *  두 표면이 갈라진 자리다(D-7).
 *
 *  ⚠ **이 저장소에서 엑셀에 그림을 넣는 두 번째 코드**다. 첫 번째는 `defect-photo-embed.ts`
 *  (갑지 「불량사진」 시트)인데 그쪽은 **새 시트를 통째로 만든다**. 여기는 **이미 있는 시트에
 *  덧붙인다** — drawing 파트·시트 rels·Content_Types를 새로 달아야 하고 워크시트 자식 태그
 *  순서를 지켜야 한다. 공통 규약은 그 파일 머리 주석에 있고, 여기서 다시 못박는 것만 적는다:
 *
 *   · 미디어 확장자는 반드시 `.jpeg` — `[Content_Types]`에 `jpg` Default가 없어 `.jpg`면
 *     파일은 열리는데 **그림만 안 보인다**. 이 템플릿에는 `jpeg` Default조차 없어 우리가 단다.
 *   · 치수는 sharp `toBuffer({resolveWithObject:true})`의 `info`(= **회전 후**)에서 얻는다.
 *     `metadata()`는 EXIF 회전 **전**이라 휴대폰 세로 사진이 가로 상자에 눌린다.
 *   · `<drawing>`은 CT_Worksheet 순서상 **거의 끝**이다(… pageSetup → headerFooter →
 *     rowBreaks → colBreaks → … → drawing → legacyDrawing → picture → oleObjects …).
 *     어기면 **LibreOffice는 통과하고 Excel만** 복구 대화상자를 띄운다.
 *   · 상자 크기는 **시트 XML에서 실측**한다 — 병합 범위를 찾아 열 폭·행 높이를 합산한다.
 *     좌표·치수를 코드에 베껴 적으면 서식 격자가 바뀔 때 한꺼번에 썩는다(42 gridTops 전례).
 */

const EMU_PER_PX = 9525
/** 상자 테두리에 딱 붙지 않게 하는 안쪽 여백(px) */
const BOX_PAD = 4
/** 인쇄 해상도 여유 — 화면 표시 크기의 몇 배로 구워 넣을지. 1배면 확대 인쇄에서 뭉갠다 */
const RENDER_SCALE = 2
/** 한 장의 장변 상한(px)과 JPEG 품질 */
const LONG_EDGE = 1800
const JPEG_Q = 82
/** 그림 총 바이트 예산 — 넘치면 뒤엣것부터 버리고 **버렸다는 사실을 고지에 싣는다** */
const IMAGE_BUDGET = 12 * 1024 * 1024

const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
const REL_DRAWING = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing'
const CT_DRAWING = 'application/vnd.openxmlformats-officedocument.drawing+xml'

/** 시트의 한 상자 — `cell`은 병합 상자의 **왼쪽 위 칸**이다 */
export type BoxTarget = {
  sheet: string
  cell: string
  /** 원본 이미지 바이트(JPEG·PNG·WebP 아무거나 — 여기서 JPEG로 통일한다) */
  data: Uint8Array
  /** 그림 대체 텍스트 겸 실패 고지에 쓸 이름 */
  descr: string
}

export type EmbedResult = {
  bytes: Uint8Array
  /** 실제로 앉힌 그림 수 */
  placed: number
  /** 조용히 버리지 않기 위한 사유 목록 — 라우트가 고지 헤더에 싣는다 */
  notes: string[]
}

const colNum = (s: string) => s.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)

/** 엑셀 열 폭(문자 단위) → px. `defect-photo-embed`와 **같은 산식**이어야 두 시트의 그림이 다르게 놓이지 않는다 */
const colPx = (w: number) => Math.round(w * 7 + 5)
const rowPx = (pt: number) => Math.round(pt * 4 / 3)

type SheetGeom = {
  colW: (col: number) => number
  rowH: (row: number) => number
  /** `cell`을 품는 병합 범위. 없으면 그 칸 하나 */
  boxOf: (cell: string) => { c1: number; c2: number; r1: number; r2: number }
}

/**
 * 시트 XML에서 격자를 읽는다.
 *
 * ⚠ 속성 파서를 **한 줄 정규식으로 욕심내지 말 것.** `<row[^>]*r="(\d+)"[^>]*?(?:ht="…")?[^>]*>`
 *   처럼 쓰면 선택 그룹이 **언제나 빈 문자열에 매치**해 `ht`를 통째로 놓친다(이 파일을 짜며
 *   실제로 밟았다 — 전 행이 기본 높이 15pt로 읽혀 상자가 20px로 보였다). 태그를 먼저 통째로
 *   잡고 그 안에서 속성을 따로 찾는다.
 */
function readGeometry(xml: string): SheetGeom {
  const fmt = /<sheetFormatPr\b[^>]*>/.exec(xml)?.[0] ?? ''
  const defColW = Number(/defaultColWidth="([\d.]+)"/.exec(fmt)?.[1] ?? 8.43)
  const defRowH = Number(/defaultRowHeight="([\d.]+)"/.exec(fmt)?.[1] ?? 15)

  const widths = new Map<number, number>()
  for (const m of xml.matchAll(/<col\b[^>]*\/>/g)) {
    const tag = m[0]
    const min = Number(/\bmin="(\d+)"/.exec(tag)?.[1] ?? 0)
    const max = Number(/\bmax="(\d+)"/.exec(tag)?.[1] ?? 0)
    if (!min || !max) continue
    const w = Number(/\bwidth="([\d.]+)"/.exec(tag)?.[1] ?? defColW)
    // 상한을 둔다 — `max="16384"`(전 열 지정)가 실재하고, 그대로 루프를 돌면 시트마다 1.6만 회다
    for (let c = min; c <= Math.min(max, 1024); c++) widths.set(c, w)
  }

  const heights = new Map<number, number>()
  for (const m of xml.matchAll(/<row\b[^>]*?>/g)) {
    const tag = m[0]
    const r = Number(/\sr="(\d+)"/.exec(tag)?.[1] ?? 0)
    if (!r) continue
    heights.set(r, Number(/\sht="([\d.]+)"/.exec(tag)?.[1] ?? defRowH))
  }

  const merges: Array<{ c1: number; c2: number; r1: number; r2: number }> = []
  for (const m of xml.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g)) {
    merges.push({ c1: colNum(m[1]), r1: Number(m[2]), c2: colNum(m[3]), r2: Number(m[4]) })
  }

  return {
    colW: c => widths.get(c) ?? defColW,
    rowH: r => heights.get(r) ?? defRowH,
    boxOf: cell => {
      const mm = /^([A-Z]+)(\d+)$/.exec(cell)
      if (!mm) throw new Error(`fire-plan-xlsx-images: 셀 참조가 아니다 — '${cell}'`)
      const c = colNum(mm[1]), r = Number(mm[2])
      const hit = merges.find(g => g.c1 <= c && c <= g.c2 && g.r1 <= r && r <= g.r2)
      return hit ?? { c1: c, c2: c, r1: r, r2: r }
    },
  }
}

type Prepared = { jpeg: Uint8Array; w: number; h: number }

/** EXIF 회전 굽기 → 상자에 맞춰 축소 → JPEG 통일.
 *  ⚠ 버킷에는 JPEG만 있지 않다(`image-prep.ts`가 작은 PNG/WebP는 원본 그대로 통과시킨다).
 *    webp Default가 없으므로 재인코딩은 선택이 아니라 필수다. */
async function prepare(data: Uint8Array, boxW: number, boxH: number): Promise<Prepared> {
  if (data.byteLength === 0) throw new Error('0바이트')
  const target = Math.min(LONG_EDGE, Math.max(boxW, boxH) * RENDER_SCALE)
  const { data: jpeg, info } = await sharp(Buffer.from(data), { failOn: 'none' })
    .rotate()
    .resize({ width: Math.round(target), height: Math.round(target), fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_Q })
    .toBuffer({ resolveWithObject: true })
  return { jpeg: new Uint8Array(jpeg), w: info.width, h: info.height }
}

/** 상자 안에 **가로세로비를 지켜** 놓을 때의 EMU — 늘리면 도면이 왜곡된다 */
function fit(img: Prepared, boxW: number, boxH: number) {
  const innerW = Math.max(1, boxW - BOX_PAD * 2)
  const innerH = Math.max(1, boxH - BOX_PAD * 2)
  const scale = Math.min(innerW / img.w, innerH / img.h)
  const w = Math.max(1, Math.round(img.w * scale))
  const h = Math.max(1, Math.round(img.h * scale))
  return {
    w, h,
    cx: w * EMU_PER_PX, cy: h * EMU_PER_PX,
    padX: Math.max(0, Math.floor((boxW - w) / 2)),
    padY: Math.max(0, Math.floor((boxH - h) / 2)),
  }
}

/**
 * 상자 안 오프셋(px)을 `{칸 번호, 그 칸 안의 나머지}`로 쪼갠다.
 *
 * 🚨 **`colOff`는 「상자 안 오프셋」이 아니라 「그 **열 안**의 오프셋」이다.** 이 서식은 열 폭이
 *   1.8자(≈18px)인 미세 격자라, 가운데 정렬 값 266px을 A열의 `colOff`로 주면 열 폭을 한참
 *   넘어선다 — 뷰어가 클램프해 **그림이 왼쪽에 붙는다**. LibreOffice 렌더로 실제로 그렇게
 *   나왔고(2026-09-14 육안), 앵커·rels·좌표를 보는 구조 검사는 그걸 **한 건도 못 잡았다**.
 *   그래서 오프셋을 칸 단위로 걸어 들어가 `from.col`을 옮기고 나머지만 `colOff`로 준다.
 */
function splitOffset(sizes: number[], pad: number): { i: number; off: number } {
  let i = 0, rest = pad
  while (i < sizes.length - 1 && rest >= sizes[i]) { rest -= sizes[i]; i++ }
  return { i, off: Math.max(0, Math.round(rest)) }
}

const relsXml = (items: Array<{ id: string; type: string; target: string }>) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + items.map(i => `<Relationship Id="${i.id}" Type="${i.type}" Target="${i.target}"/>`).join('')
  + '</Relationships>'

/**
 * `<drawing>`을 워크시트에 끼워 넣는다 — CT_Worksheet 순서를 지킨다.
 *
 * drawing **뒤에** 올 수 있는 형제가 하나라도 있으면 그 앞에, 없으면 `</worksheet>` 앞에 둔다.
 * 순서를 어기면 LibreOffice는 조용히 통과하고 **Excel만** 복구 대화상자를 띄운다 — 즉
 * 우리 검사(LO 렌더)로는 안 잡히는 부류다.
 */
function insertDrawingTag(xml: string, rid: string): string {
  const tag = `<drawing r:id="${rid}"/>`
  for (const after of ['<legacyDrawing', '<legacyDrawingHF', '<drawingHF', '<picture', '<oleObjects', '<controls', '<webPublishItems', '<tableParts', '<extLst']) {
    const at = xml.indexOf(after)
    if (at >= 0) return xml.slice(0, at) + tag + xml.slice(at)
  }
  const end = xml.lastIndexOf('</worksheet>')
  if (end < 0) throw new Error('fire-plan-xlsx-images: </worksheet>가 없다')
  return xml.slice(0, end) + tag + xml.slice(end)
}

/** `[Content_Types].xml`에 jpeg Default와 drawing Override를 단다(이미 있으면 그대로) */
function patchContentTypes(xml: string, drawingParts: string[]): string {
  let out = xml
  if (!/<Default\s+Extension="jpeg"/.test(out)) {
    out = out.replace(/<Types\b[^>]*>/, m => `${m}<Default Extension="jpeg" ContentType="image/jpeg"/>`)
  }
  const add = drawingParts
    .filter(p => !out.includes(`PartName="/${p}"`))
    .map(p => `<Override PartName="/${p}" ContentType="${CT_DRAWING}"/>`)
    .join('')
  if (add) out = out.replace('</Types>', `${add}</Types>`)
  return out
}

export type ImagePlan = {
  targets: BoxTarget[]
  /** 그림이 앉은 상자의 안내 글자를 지울 자리 — **값 주입 단계**에서 함께 비운다.
   *  그림을 얹은 뒤 따로 지우려면 워크시트를 두 번 고쳐야 하고, 그 사이 상태가 어긋난다. */
  blankCells: Array<{ sheet: string; cell: string }>
  notes: string[]
}

/**
 * 모아 온 그림(`assembleFirePlan().images/assets`)을 서식의 상자에 배정한다 — **순수 함수**.
 *
 * 좌표는 `validateAnchors`가 돌려준 것(= 라벨 대조·자가치유를 통과한 것)만 받는다.
 * 상자보다 그림이 많으면 **버렸다는 사실을 고지에 싣는다** — 조용한 절단도 조용한 누락이다.
 *
 * ⚠ 상자가 아예 없는 종류(피난경로도 등)는 여기서 **소리 내어 건너뛴다**.
 *   법정 엑셀 서식에 그 칸이 없는 것이지 우리가 잃은 게 아니고, PDF에는 그대로 인쇄된다.
 *
 * ⚠ 한 상자가 **여러 종류를 우선순위로** 받을 수 있다(1.3 「건축물 위치」 = 표지 사진 > 위치도).
 *   밀린 쪽도 조용히 사라지지 않는다 — 「그 상자는 …이 우선입니다」로 고지에 싣는다.
 */
export function planFirePlanImages(
  images: Array<{ file: string; kind: string; caption: string }>,
  assets: Array<{ name: string; data: Uint8Array }>,
  anchors: Anchor[],
): ImagePlan {
  const notes: string[] = []
  const targets: BoxTarget[] = []
  const blankCells: Array<{ sheet: string; cell: string }> = []
  const byName = new Map(assets.map(a => [a.name, a.data]))
  const anchorOf = new Map(anchors.map(a => [a.field, a]))

  const byKind = new Map<string, Array<{ file: string; caption: string }>>()
  for (const im of images) {
    const arr = byKind.get(im.kind) ?? []
    arr.push({ file: im.file, caption: im.caption })
    byKind.set(im.kind, arr)
  }

  const boxedKinds = new Set(FIRE_PLAN_IMAGE_BOXES.flatMap(b => b.kinds as readonly string[]))
  /** 실제로 상자를 얻은 장수 — 넘침 판정의 분모다(상자 **수**가 아니다: 바이트가 깨지면 못 앉는다) */
  const placed = new Map<string, number>()
  /** 우선순위에 밀려 상자를 못 얻은 종류 → 그 상자를 가져간 종류 */
  const preemptedBy = new Map<string, string>()
  for (const b of FIRE_PLAN_IMAGE_BOXES) {
    // 상자가 받는 종류 중 **그림이 실제로 있는 첫째**. 규칙은 PDF와 공유한다(`pickFirstKind`).
    const kind = pickFirstKind(b.kinds, k => !!byKind.get(k)?.[b.index])
    if (!kind) continue
    const im = byKind.get(kind)![b.index]
    const data = byName.get(im.file)
    // 🚨 `images[i].file`은 `assets[i].name`과 짝이다(collectImages가 한 번에 만든다).
    //   짝이 깨졌다면 조립이 어긋난 것이라 조용히 넘기지 않는다.
    if (!data) { notes.push(`${imageBoxDescr(b)} 미표기(이미지 바이트 없음: ${im.file})`); continue }
    const a = anchorOf.get(b.field)
    if (!a) throw new Error(`fire-plan-xlsx-images: 상자 '${b.field}' 의 검증된 좌표가 없다`)
    targets.push({ sheet: a.sheet, cell: a.cell, data, descr: im.caption?.trim() || imageBoxDescr(b) })
    if (b.clearPlaceholder) blankCells.push({ sheet: a.sheet, cell: a.cell })
    placed.set(kind, (placed.get(kind) ?? 0) + 1)
    // 뒤로 밀린 종류를 여기서 기억해 둔다 — 아래에서 **고지**로 낸다(이 갈래가 없으면
    // 표지 사진이 있는 고객의 위치도가 아무 말 없이 사라진다)
    for (const lost of b.kinds.slice(b.kinds.indexOf(kind) + 1)) {
      if (byKind.has(lost)) preemptedBy.set(lost, kind)
    }
  }

  // 인쇄되지 못한 장수 — 사유를 갈라 적는다(셋 다 '미표기'지만 사람이 할 일이 다르다)
  for (const [kind, list] of byKind) {
    const n = placed.get(kind) ?? 0
    if (list.length <= n) continue
    const winner = preemptedBy.get(kind)
    if (winner) {
      // ① 상자는 있는데 우선순위에 밀렸다 — PDF도 같은 규칙이라 그쪽에도 안 나간다
      // ⚠ 조사를 붙이지 않는다 — 이름이 무엇으로 바뀌어도(받침 유무) 문장이 성립해야 한다
      notes.push(`${imageKindLabel(kind)} ${list.length - n}장 미표기 — 그 상자의 우선순위는 ${imageKindLabel(winner)}입니다(PDF도 같습니다)`)
    } else if (boxedKinds.has(kind)) {
      // ② 상자보다 그림이 많다
      const slots = FIRE_PLAN_IMAGE_BOXES.filter(b => (b.kinds as readonly string[]).includes(kind)).length
      notes.push(`${imageKindLabel(kind)} ${list.length - n}장 미표기(양식 상자 ${slots}칸)`)
    } else {
      // ③ 엑셀 서식에 그 칸 자체가 없다
      notes.push(`${imageKindLabel(kind)} ${list.length}장은 엑셀 서식에 상자가 없어 미표기(PDF에는 인쇄됩니다)`)
    }
  }

  return { targets, blankCells, notes }
}

/**
 * 워크북 바이트에 그림을 앉힌다. 원본 바이트는 변형하지 않는다.
 *
 * 🚨 **fail-soft의 경계** — 한 장이 깨져도 문서 생성은 막지 않는다(`notes`에 남긴다). 그러나
 *   **상자를 못 찾는 것은 fail-loud**다: 좌표가 밀렸다는 뜻이고, 조용히 넘기면 그림이 엉뚱한
 *   자리에 붙거나 사라진 채로 '거의 맞는 문서'가 나간다. 호출부는 라벨 검증(`validateAnchors`)을
 *   **먼저** 통과시킨 좌표만 넘겨야 한다.
 */
export async function embedFirePlanImages(
  workbookBytes: Uint8Array, targets: BoxTarget[],
): Promise<EmbedResult> {
  const notes: string[] = []
  if (targets.length === 0) return { bytes: workbookBytes, placed: 0, notes }

  const zip = await JSZip.loadAsync(workbookBytes)
  const files = await sheetFileMap(zip)

  // 파트 이름은 **비어 있는 번호**로 — 자산이 갱신돼 drawing이 이미 있어도 덮지 않는다
  const usedDrawings = Object.keys(zip.files)
    .map(n => /^xl\/drawings\/drawing(\d+)\.xml$/.exec(n)?.[1]).filter(Boolean).map(Number)
  let nextDrawing = Math.max(0, ...usedDrawings) + 1
  let mediaSeq = Object.keys(zip.files).filter(n => n.startsWith('xl/media/')).length
  let budget = IMAGE_BUDGET

  const bySheet = new Map<string, BoxTarget[]>()
  for (const t of targets) {
    const arr = bySheet.get(t.sheet) ?? []
    arr.push(t)
    bySheet.set(t.sheet, arr)
  }

  const drawingParts: string[] = []
  let placed = 0

  for (const [sheet, items] of bySheet) {
    const path = files.get(sheet)
    if (!path || !zip.file(path)) throw new Error(`fire-plan-xlsx-images: 시트 '${sheet}' 없음`)
    let xml = await zip.file(path)!.async('string')

    // 이미 그림이 달린 시트는 **멈춘다**. 덧붙이려면 기존 drawing 파트를 병합해야 하는데,
    // 지금 자산에는 drawing이 한 장도 없다(실측). 자산이 바뀌면 여기서 붉어지는 편이
    // 남의 그림을 조용히 떼어내는 것보다 낫다.
    if (/<drawing\s+r:id=/.test(xml)) {
      throw new Error(`fire-plan-xlsx-images: '${sheet}'에 이미 drawing이 있다 — 병합 구현이 필요하다`)
    }

    const geom = readGeometry(xml)
    const anchors: string[] = []
    const media: Array<{ rid: string; file: string; data: Uint8Array }> = []

    for (const t of items) {
      const box = geom.boxOf(t.cell)
      // 칸별 크기를 **배열로** 들고 간다 — 가운데 정렬 오프셋을 칸 단위로 쪼개야 하기 때문이다
      const colSizes: number[] = []
      for (let c = box.c1; c <= box.c2; c++) colSizes.push(colPx(geom.colW(c)))
      const rowSizes: number[] = []
      for (let r = box.r1; r <= box.r2; r++) rowSizes.push(rowPx(geom.rowH(r)))
      const boxW = colSizes.reduce((a, b) => a + b, 0)
      const boxH = rowSizes.reduce((a, b) => a + b, 0)
      if (boxW < 40 || boxH < 40) {
        notes.push(`${t.descr} 미표기(상자가 ${boxW}×${boxH}px로 너무 작다)`)
        continue
      }
      let img: Prepared
      try {
        img = await prepare(t.data, boxW, boxH)
      } catch (e) {
        notes.push(`${t.descr} 미표기(${e instanceof Error ? e.message : String(e)})`)
        continue
      }
      if (img.jpeg.byteLength > budget) {
        notes.push(`${t.descr} 미표기(용량 초과)`)
        continue
      }
      budget -= img.jpeg.byteLength

      const g = fit(img, boxW, boxH)
      const cx0 = splitOffset(colSizes, g.padX)
      const ry0 = splitOffset(rowSizes, g.padY)
      const rid = `rId${media.length + 1}`
      const file = `fireplan-${nextDrawing}-${++mediaSeq}.jpeg`
      media.push({ rid, file, data: img.jpeg })
      const id = media.length
      anchors.push(
        '<xdr:oneCellAnchor>'
        + `<xdr:from><xdr:col>${box.c1 - 1 + cx0.i}</xdr:col><xdr:colOff>${cx0.off * EMU_PER_PX}</xdr:colOff>`
        + `<xdr:row>${box.r1 - 1 + ry0.i}</xdr:row><xdr:rowOff>${ry0.off * EMU_PER_PX}</xdr:rowOff></xdr:from>`
        + `<xdr:ext cx="${g.cx}" cy="${g.cy}"/>`
        + '<xdr:pic><xdr:nvPicPr>'
        + `<xdr:cNvPr id="${id}" name="img${id}" descr="${escXml(t.descr)}"/>`
        + '<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>'
        + `<xdr:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>`
        + `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${g.cx}" cy="${g.cy}"/></a:xfrm>`
        + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>'
        + '</xdr:pic><xdr:clientData/></xdr:oneCellAnchor>')
      placed++
    }

    if (!anchors.length) continue

    const drawingName = `drawing${nextDrawing++}.xml`
    const drawingPath = `xl/drawings/${drawingName}`
    drawingParts.push(drawingPath)
    zip.file(drawingPath,
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"'
      + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
      + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + anchors.join('') + '</xdr:wsDr>')
    zip.file(`xl/drawings/_rels/${drawingName}.rels`,
      relsXml(media.map(m => ({ id: m.rid, type: REL_IMAGE, target: `../media/${m.file}` }))))
    for (const m of media) zip.file(`xl/media/${m.file}`, m.data)

    // 시트 rels — 이 템플릿의 시트에는 rels 파일 자체가 없다(실측). 있으면 빈 rId에 이어 붙인다.
    const relsPath = path.replace(/worksheets\/([^/]+)$/, 'worksheets/_rels/$1.rels')
    const existing = zip.file(relsPath) ? await zip.file(relsPath)!.async('string') : null
    const usedIds = existing ? [...existing.matchAll(/Id="rId(\d+)"/g)].map(m => Number(m[1])) : []
    const sheetRid = `rId${Math.max(0, ...usedIds) + 1}`
    if (existing) {
      zip.file(relsPath, existing.replace('</Relationships>',
        `<Relationship Id="${sheetRid}" Type="${REL_DRAWING}" Target="../drawings/${drawingName}"/></Relationships>`))
    } else {
      zip.file(relsPath, relsXml([{ id: sheetRid, type: REL_DRAWING, target: `../drawings/${drawingName}` }]))
    }

    xml = insertDrawingTag(xml, sheetRid)
    zip.file(path, xml)
  }

  if (drawingParts.length) {
    const ctPath = '[Content_Types].xml'
    const ct = await zip.file(ctPath)!.async('string')
    zip.file(ctPath, patchContentTypes(ct, drawingParts))
  }

  const bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
  return { bytes, placed, notes }
}
