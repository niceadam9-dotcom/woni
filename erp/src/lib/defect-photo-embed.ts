import 'server-only'
import JSZip from 'jszip'
import sharp from 'sharp'
import { escXml } from '@/lib/xlsx-inject'
import { extractStoragePath } from '@/lib/defect-photos'
import type { SheetPart } from '@/lib/xlsx-sheet-surgery'

/** 갑지 워크북 「불량사진」 시트 (소방계획서_46)
 *
 *  불량 사진은 `inspection_defects.photo_url`(조치 전)·`after_photo_url`(조치 후)에 쌓이는데
 *  여태 **어떤 산출물에도 실리지 않았다** — 화면 미리보기가 유일한 소비처였다. 이 모듈이
 *  「현5」(별지 9호 8쪽 '4. 소방시설등 불량 세부 사항') 바로 뒤에 붙일 사진 대지를 만든다.
 *
 *  인쇄 규격(사용자 요구, 2026-09-07): **불량 1건 = 세로 3행**(캡션 · 조치 전 · 조치 후),
 *  **A4 세로 1장 = 2건 = 6행** → 6건이면 정확히 3페이지.
 *
 *  ⚠ 이 파일은 이 저장소에서 **엑셀에 이미지를 넣는 유일한 코드**다. 조용히 깨지는 지점이
 *  많아 규약을 여기 못박는다:
 *   · 미디어 확장자는 반드시 `.jpeg` — `[Content_Types]`에 `jpg` Default가 없어 `.jpg`면
 *     파일은 열리는데 **그림만 안 보인다**.
 *   · 치수는 sharp `toBuffer({resolveWithObject:true})`의 `info`(= **회전 후**)에서 얻는다.
 *     `metadata()`는 EXIF 회전 **전**이라 휴대폰 세로 사진이 가로 상자에 눌린다.
 *   · 텍스트는 inlineStr — 공유문자열에 넣으면 `t="s"` 인덱스가 밀려 **전 문서가 뒤섞인다**.
 *   · 워크시트 자식 태그는 CT_Worksheet 순서(… printOptions → pageMargins → pageSetup →
 *     headerFooter → rowBreaks → drawing). 어기면 **LibreOffice는 통과하고 Excel만** 복구한다.
 *   · 스타일은 fonts·borders·cellXfs **끝에 덧붙인다** — 기존 인덱스가 한 개도 안 밀린다. */

/** 불량 1건이 쓰는 행 수 — 캡션 + 조치 전 + 조치 후 */
const ROWS_PER_DEFECT = 3
/** A4 세로 한 장에 들어가는 불량 건수 */
const DEFECTS_PER_PAGE = 2
const ROWS_PER_PAGE = ROWS_PER_DEFECT * DEFECTS_PER_PAGE

/** 행 높이(pt) — 캡션 21 + 사진 180×2 = 381pt/건, 2건 = 762pt.
 *  A4 세로에서 쓸 수 있는 높이는 (11.6929in − 상하 0.35×2) × 72 = 791.5pt라 여유 29.5pt(3.7%) */
const CAPTION_PT = 21
const PHOTO_PT = 180
/** 열 너비(엑셀 width) — A 라벨 · B 사진 · C 내용. px = width×7 + 5 → 68 + 327 + 320 = 715px,
 *  A4 세로 가용 폭 (8.2677 − 0.30×2) × 96 = 736px 안 */
const COL_W = { a: 9, b: 46, c: 45 } as const
/** 사진 상자 안쪽 여백(px) — 테두리에 딱 붙지 않게 */
const BOX_PAD = 3
const EMU_PER_PX = 9525

/** 사진 장변 상한(px)과 JPEG 품질 — 1200px q80이면 장당 대략 150~250KB */
const LONG_EDGE = 1200
const JPEG_Q = 80
/** 시트가 감당하는 불량 건수 상한(= 30페이지)과 사진 총 바이트 예산 */
const MAX_DEFECTS = 60
const PHOTO_BUDGET = 12 * 1024 * 1024
/** 다운로드 동시 실행 수 — 무제한 Promise.all은 sharp 네이티브 디코드가 RSS를 튀긴다 */
const CONCURRENCY = 4

const BUCKET = 'inspection-defects'
const SHEET_NAME = '불량사진'
const SHEET_PATH = 'xl/worksheets/sheetPhoto.xml'

/** Storage에서 바이트만 받으면 되므로 SupabaseClient 전체를 요구하지 않는다 —
 *  프로브가 스텁을 넘길 수 있어야 검사가 DB·네트워크에서 독립한다 */
export type PhotoStorage = {
  storage: {
    from: (bucket: string) => {
      download: (path: string) => Promise<{ data: Blob | null; error: unknown }>
    }
  }
}

export type DefectPhotoRow = {
  defect_code: string | null
  defect_name: string | null
  defect_detail: string | null
  action_taken: string | null
  photo_url: string | null
  after_photo_url: string | null
}

type Prepared = { jpeg: Uint8Array; w: number; h: number }
type Slot = { kind: 'before' | 'after'; img: Prepared | null }
type Block = { no: number; caption: string; slots: [Slot, Slot]; texts: [string, string] }

const px = { colW: (w: number) => Math.round(w * 7 + 5), rowH: (pt: number) => Math.round(pt * 4 / 3) }

/** 한 사진을 상자에 맞춰 놓을 때의 EMU — **가로세로비를 바꾸지 않는다**(늘리면 증빙이 왜곡된다) */
function fitBox(img: Prepared): { cx: number; cy: number; colOff: number; rowOff: number } {
  const boxW = px.colW(COL_W.b) - BOX_PAD * 2
  const boxH = px.rowH(PHOTO_PT) - BOX_PAD * 2
  const scale = Math.min(boxW / img.w, boxH / img.h)
  const w = Math.max(1, Math.round(img.w * scale))
  const h = Math.max(1, Math.round(img.h * scale))
  return {
    cx: w * EMU_PER_PX, cy: h * EMU_PER_PX,
    colOff: Math.floor((px.colW(COL_W.b) - w) / 2) * EMU_PER_PX,
    rowOff: Math.floor((px.rowH(PHOTO_PT) - h) / 2) * EMU_PER_PX,
  }
}

/** 다운로드 → EXIF 회전 굽기 → 축소 → JPEG 통일.
 *  ⚠ 버킷에는 JPEG만 있지 않다 — `image-prep.ts`가 작은 PNG/WebP는 원본 그대로 통과시킨다.
 *  webp Default가 [Content_Types]에 없으므로 재인코딩은 선택이 아니라 필수다. */
async function prepPhoto(store: PhotoStorage, stored: string | null): Promise<Prepared> {
  const path = extractStoragePath(stored)
  if (!path) throw new Error('경로없음')
  const { data, error } = await store.storage.from(BUCKET).download(path)
  if (error || !data) throw new Error('다운로드실패')
  const raw = new Uint8Array(await data.arrayBuffer())
  if (raw.byteLength === 0) throw new Error('0바이트')
  try {
    const { data: jpeg, info } = await sharp(Buffer.from(raw), { failOn: 'none' })
      .rotate()
      .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_Q })
      .toBuffer({ resolveWithObject: true })
    return { jpeg: new Uint8Array(jpeg), w: info.width, h: info.height }
  } catch {
    throw new Error('디코드실패')
  }
}

/** fonts·borders·cellXfs 끝에 덧붙인다 — 기존 인덱스 무손상이 구성적으로 보장된다.
 *  ⚠ count 속성은 **실제 원소를 세어** 다시 쓴다(+N 하드코딩은 자산이 바뀌면 어긋난다).
 *  count가 어긋나면 LibreOffice는 통과하고 Excel만 복구 대화상자를 띄운다 */
function patchStyles(xml: string): { xml: string; xfCaption: number; xfBox: number; xfText: number } {
  const block = (tag: string) => {
    const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml)
    if (!m) throw new Error(`styles.xml ${tag} 블록 없음`)
    return m
  }
  const countEls = (inner: string, tag: string) =>
    [...inner.matchAll(new RegExp(`<${tag}\\b[^>]*(?:/>|>[\\s\\S]*?</${tag}>)`, 'g'))].length

  const fonts = block('fonts')
  const fontBase = countEls(fonts[1], 'font')
  const newFonts =
    '<font><b val="true"/><sz val="11"/><color rgb="FF000000"/><name val="돋움"/><family val="3"/><charset val="129"/></font>'
    + '<font><sz val="10"/><color rgb="FF000000"/><name val="돋움"/><family val="3"/><charset val="129"/></font>'
  let out = xml.slice(0, fonts.index) + `<fonts count="${fontBase + 2}">${fonts[1]}${newFonts}</fonts>`
    + xml.slice(fonts.index + fonts[0].length)

  const bordersM = new RegExp('<borders(?:\\s[^>]*)?>([\\s\\S]*?)</borders>').exec(out)!
  const borderBase = countEls(bordersM[1], 'border')
  const newBorder = '<border diagonalUp="false" diagonalDown="false">'
    + '<left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>'
  out = out.slice(0, bordersM.index) + `<borders count="${borderBase + 1}">${bordersM[1]}${newBorder}</borders>`
    + out.slice(bordersM.index + bordersM[0].length)

  const xfsM = new RegExp('<cellXfs(?:\\s[^>]*)?>([\\s\\S]*?)</cellXfs>').exec(out)!
  const xfBase = countEls(xfsM[1], 'xf')
  const xf = (fontId: number, h: string, v: string) =>
    `<xf numFmtId="164" fontId="${fontId}" fillId="0" borderId="${borderBase}" xfId="0"`
    + ' applyFont="true" applyBorder="true" applyAlignment="true" applyProtection="false">'
    + `<alignment horizontal="${h}" vertical="${v}" textRotation="0" wrapText="true" indent="0" shrinkToFit="false"/>`
    + '<protection locked="true" hidden="false"/></xf>'
  const newXfs = xf(fontBase, 'center', 'center') + xf(fontBase + 1, 'center', 'center') + xf(fontBase + 1, 'left', 'top')
  out = out.slice(0, xfsM.index) + `<cellXfs count="${xfBase + 3}">${xfsM[1]}${newXfs}</cellXfs>`
    + out.slice(xfsM.index + xfsM[0].length)

  return { xml: out, xfCaption: xfBase, xfBox: xfBase + 1, xfText: xfBase + 2 }
}

const cell = (ref: string, s: number, text?: string | null) =>
  text ? `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escXml(text)}</t></is></c>`
    : `<c r="${ref}" s="${s}"/>`

function sheetXml(blocks: Block[], xf: { xfCaption: number; xfBox: number; xfText: number }, drawingRid: string): string {
  const last = blocks.length * ROWS_PER_DEFECT
  const rows: string[] = []
  for (const [i, b] of blocks.entries()) {
    const r0 = i * ROWS_PER_DEFECT
    rows.push(
      `<row r="${r0 + 1}" ht="${CAPTION_PT}" customHeight="true">`
      + cell(`A${r0 + 1}`, xf.xfCaption, String(b.no))
      + cell(`B${r0 + 1}`, xf.xfCaption, b.caption)
      + cell(`C${r0 + 1}`, xf.xfCaption)
      + '</row>')
    for (const [k, slot] of b.slots.entries()) {
      const r = r0 + 2 + k
      rows.push(
        `<row r="${r}" ht="${PHOTO_PT}" customHeight="true">`
        + cell(`A${r}`, xf.xfBox, slot.kind === 'before' ? '조치 전' : '조치 후')
        + cell(`B${r}`, xf.xfBox, slot.img ? null : '사진 없음')
        + cell(`C${r}`, xf.xfText, b.texts[k])
        + '</row>')
    }
  }
  const merges = blocks.map((_, i) => `<mergeCell ref="B${i * ROWS_PER_DEFECT + 1}:C${i * ROWS_PER_DEFECT + 1}"/>`)
  // 페이지 끝마다 강제 개행 — ⚠ 마지막 행 뒤에는 넣지 않는다(꼬리 빈 페이지가 1장 더 인쇄된다)
  const brks: string[] = []
  for (let r = ROWS_PER_PAGE; r < last; r += ROWS_PER_PAGE) brks.push(`<brk id="${r}" max="16383" man="true"/>`)

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheetPr><pageSetUpPr fitToPage="true"/></sheetPr>'
    + `<dimension ref="A1:C${last}"/>`
    + '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + '<cols>'
    + `<col min="1" max="1" width="${COL_W.a}" customWidth="true"/>`
    + `<col min="2" max="2" width="${COL_W.b}" customWidth="true"/>`
    + `<col min="3" max="3" width="${COL_W.c}" customWidth="true"/>`
    + '</cols>'
    + `<sheetData>${rows.join('')}</sheetData>`
    + `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>`
    + '<printOptions horizontalCentered="true"/>'
    + '<pageMargins left="0.3" right="0.3" top="0.35" bottom="0.35" header="0.2" footer="0.2"/>'
    // fitToWidth=1·fitToHeight=0 — 열 폭 산수가 어긋나 가로로 넘칠 때의 안전망(세로는 수동 개행 유지).
    // ⚠ fitToHeight="1"은 전 시트를 한 장으로 뭉갠다 — 절대 금지
    + '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0" scale="100"/>'
    + (brks.length ? `<rowBreaks count="${brks.length}" manualBreakCount="${brks.length}">${brks.join('')}</rowBreaks>` : '')
    + `<drawing r:id="${drawingRid}"/>`
    + '</worksheet>'
}

function drawingXml(blocks: Block[], media: Array<{ rid: string }>): string {
  const anchors: string[] = []
  let n = 0
  for (const [i, b] of blocks.entries()) {
    for (const [k, slot] of b.slots.entries()) {
      if (!slot.img) continue
      const box = fitBox(slot.img)
      const rid = media[n].rid
      const id = ++n
      anchors.push(
        '<xdr:oneCellAnchor>'
        + `<xdr:from><xdr:col>1</xdr:col><xdr:colOff>${box.colOff}</xdr:colOff>`
        + `<xdr:row>${i * ROWS_PER_DEFECT + 1 + k}</xdr:row><xdr:rowOff>${box.rowOff}</xdr:rowOff></xdr:from>`
        + `<xdr:ext cx="${box.cx}" cy="${box.cy}"/>`
        + '<xdr:pic><xdr:nvPicPr>'
        + `<xdr:cNvPr id="${id}" name="photo${id}" descr="${escXml(`${b.no} ${slot.kind === 'before' ? '조치 전' : '조치 후'}`)}"/>`
        + '<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>'
        + `<xdr:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>`
        + `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${box.cx}" cy="${box.cy}"/></a:xfrm>`
        + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>'
        + '</xdr:pic><xdr:clientData/></xdr:oneCellAnchor>')
    }
  }
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"'
    + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + anchors.join('') + '</xdr:wsDr>'
}

const rels = (items: Array<{ id: string; type: string; target: string }>) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + items.map(i => `<Relationship Id="${i.id}" Type="${i.type}" Target="${i.target}"/>`).join('')
  + '</Relationships>'

/** 청크 병렬 — 순서를 보존한다(사진 순서 = 불량 순서) */
async function mapChunked<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)))
  return out
}

/** 「불량사진」 시트 한 장 — 사진이 한 장도 없으면 **null**(빈 표 3페이지가 최악이다).
 *  `notes`는 조용히 버리지 않기 위한 사유 목록으로, 라우트가 X-Workbook-Missing에 싣는다. */
export async function buildDefectPhotoSheet(
  store: PhotoStorage, defects: DefectPhotoRow[], workbookBytes: Uint8Array,
): Promise<{ part: SheetPart; notes: string[]; photoCount: number } | null> {
  const notes: string[] = []
  const withPhoto = defects.filter(d => extractStoragePath(d.photo_url) || extractStoragePath(d.after_photo_url))
  if (withPhoto.length === 0) return null
  const kept = withPhoto.slice(0, MAX_DEFECTS)
  if (withPhoto.length > kept.length) notes.push(`불량사진 ${withPhoto.length - kept.length}건 미표기(시트 상한 ${MAX_DEFECTS}건)`)

  // ① 사진 준비 — 슬롯 단위로 실패를 격리한다. 한 장이 깨져도 나머지는 실린다
  type SlotJob = { di: number; kind: 'before' | 'after'; stored: string | null }
  const jobs: SlotJob[] = kept.flatMap((d, di) => ([
    { di, kind: 'before' as const, stored: d.photo_url },
    { di, kind: 'after' as const, stored: d.after_photo_url },
  ])).filter(j => extractStoragePath(j.stored))
  const prepared = await mapChunked(jobs, CONCURRENCY, async j => {
    try { return { j, img: await prepPhoto(store, j.stored), why: '' } }
    catch (e) { return { j, img: null, why: e instanceof Error ? e.message : String(e) } }
  })

  let used = 0
  const failed: string[] = []
  const imgOf = new Map<string, Prepared>()
  for (const p of prepared) {
    const label = `${kept[p.j.di].defect_code ?? p.j.di + 1}-${p.j.kind === 'before' ? '전' : '후'}`
    if (!p.img) { failed.push(`${label}(${p.why})`); continue }
    if (used + p.img.jpeg.byteLength > PHOTO_BUDGET) { failed.push(`${label}(용량초과)`); continue }
    used += p.img.jpeg.byteLength
    imgOf.set(`${p.j.di}:${p.j.kind}`, p.img)
  }
  if (failed.length) {
    notes.push(`불량사진 ${failed.length}장 누락: ${failed.slice(0, 6).join(' · ')}${failed.length > 6 ? ` 외 ${failed.length - 6}장` : ''}`)
  }
  if (imgOf.size === 0) { notes.push('불량사진 시트 미첨부: 실을 수 있는 사진 0장'); return null }

  // ⚠ **두 슬롯 모두 비면 그 건은 싣지 않는다.** 「사진 없음」 상자는 한쪽만 있을 때(전은 찍었고
  //   조치 후는 아직) 결손을 드러내는 표시라 뜻이 있지만, 양쪽이 다 비면 빈 상자 두 칸이 페이지의
  //   절반을 먹는다 — 경로는 있는데 다운로드·디코드가 전부 실패한 건이 그렇게 된다(프로브가
  //   3건 실패 시나리오에서 빈 3페이지를 만들어 잡았다). 누락 사유는 위 failed 목록에 이미 남는다.
  const usable = kept.map((d, di) => ({ d, di }))
    .filter(({ di }) => imgOf.has(`${di}:before`) || imgOf.has(`${di}:after`))
  const blocks: Block[] = usable.map(({ d, di }, i) => ({
    no: i + 1,
    caption: [d.defect_code, d.defect_name].filter(Boolean).join(' ') || '(불량명 없음)',
    slots: [
      { kind: 'before', img: imgOf.get(`${di}:before`) ?? null },
      { kind: 'after', img: imgOf.get(`${di}:after`) ?? null },
    ],
    texts: [d.defect_detail ?? '', d.action_taken ?? ''],
  }))

  // ② 스타일은 현재 워크북의 실제 개수 위에 덧붙인다 — 인덱스를 상수로 박으면 자산 갱신에 썩는다
  const zip = await JSZip.loadAsync(workbookBytes)
  const stylesFile = zip.file('xl/styles.xml')
  if (!stylesFile) throw new Error('styles.xml 없음')
  const styled = patchStyles(await stylesFile.async('string'))

  // ③ 파트 이름은 비어 있는 번호로 — 자산에 이미 drawing1~4·image1.png가 있다
  const usedDrawings = Object.keys(zip.files)
    .map(n => /^xl\/drawings\/drawing(\d+)\.xml$/.exec(n)?.[1]).filter(Boolean).map(Number)
  const drawingName = `drawing${Math.max(0, ...usedDrawings) + 1}.xml`

  const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
  const REL_DRAWING = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing'
  const media: Array<{ rid: string; file: string; data: Uint8Array }> = []
  for (const [i, b] of blocks.entries()) {
    for (const slot of b.slots) {
      if (!slot.img) continue
      const n = media.length + 1
      media.push({ rid: `rId${n}`, file: `defect${i + 1}-${slot.kind}-${n}.jpeg`, data: slot.img.jpeg })
    }
  }

  const part: SheetPart = {
    name: SHEET_NAME,
    path: SHEET_PATH,
    xml: sheetXml(blocks, styled, 'rId1'),
    rels: rels([{ id: 'rId1', type: REL_DRAWING, target: `../drawings/${drawingName}` }]),
    printArea: `$A$1:$C$${blocks.length * ROWS_PER_DEFECT}`,
    parts: [
      { path: 'xl/styles.xml', data: styled.xml },
      { path: `xl/drawings/${drawingName}`, data: drawingXml(blocks, media) },
      {
        path: `xl/drawings/_rels/${drawingName}.rels`,
        data: rels(media.map(m => ({ id: m.rid, type: REL_IMAGE, target: `../media/${m.file}` }))),
      },
      ...media.map(m => ({ path: `xl/media/${m.file}`, data: m.data })),
    ],
    overrides: [{
      partName: `/xl/drawings/${drawingName}`,
      contentType: 'application/vnd.openxmlformats-officedocument.drawing+xml',
    }],
  }
  return { part, notes, photoCount: media.length }
}
