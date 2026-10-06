import 'server-only'
import JSZip from 'jszip'
import { escXml } from '@/lib/xlsx-inject'
import type { SheetPart } from '@/lib/xlsx-sheet-surgery'
import { colWidthToPx, rowHeightToPx } from '@/lib/xlsx-geometry'
import { photoKey, type PreparedAlbum, type PreparedPhoto } from '@/lib/photo-album'

/** 갑지 워크북 「사진첩」 시트 — 공사 완료 사진첩(2026-10-06 사용자 요청, 종전 「불량사진」 시트 대체)
 *
 *  종전(소방계획서_46): 「현5」 바로 뒤 「불량사진」 시트, 1건 = 세로 3행(캡션·조치 전·조치 후),
 *  **사진이 한 장도 없으면 시트를 뺐다**. 사용자 지시로 세 가지가 바뀌었다:
 *   · 위치 — 워크북 **맨 끝**(본보기 `공사 완료 사진첩.hwp`처럼 보고서 뒤에 붙는 별책).
 *   · 모양 — 「1. 제목」 한 줄 + **공사 전 | 공사 후 좌우** 사진 + 그 아래 라벨.
 *   · 존재 — **불량이 있으면 반드시** 나간다. 사진 없는 칸은 「사진 없음」.
 *  목록·사진 준비는 `photo-album.ts` 한 벌(PDF·한글파일과 공유)이다 — 여기는 그리기만 한다.
 *
 *  인쇄 규격: A4 세로 1장 = 3건. 1쪽 머리에만 제목 행(「공사 완료 사진첩 [건물명]」).
 *    1건 = 제목 22pt + 사진 210pt + 라벨 18pt = 250pt, 3건 = 750pt, 1쪽은 + 머리 30pt = 780pt.
 *    A4 가용 높이 (11.6929in − 상하 0.35×2) × 72 = 791.5pt 안. 이 부등식은 LO 렌더가 아니라
 *    산수로 지킨다 — LO는 제 나름 축소해 여백이 남아 보이지만 Excel은 pt 그대로 찍는다.
 *
 *  ⚠ 이 파일은 저장소에서 **엑셀에 사진을 넣는 코드** 둘 중 하나다(다른 하나 fire-plan-xlsx-images).
 *  조용히 깨지는 지점:
 *   · 미디어 확장자는 반드시 `.jpeg` — `[Content_Types]`에 `jpg` Default가 없어 `.jpg`면
 *     파일은 열리는데 **그림만 안 보인다**.
 *   · 텍스트는 inlineStr — 공유문자열에 넣으면 `t="s"` 인덱스가 밀려 **전 문서가 뒤섞인다**.
 *   · 워크시트 자식 태그는 CT_Worksheet 순서(… printOptions → pageMargins → pageSetup →
 *     headerFooter → rowBreaks → drawing). 어기면 **LibreOffice는 통과하고 Excel만** 복구한다.
 *   · 스타일은 fonts·borders·cellXfs **끝에 덧붙인다** — 기존 인덱스가 한 개도 안 밀린다. */

export const PHOTO_SHEET_NAME = '사진첩'
const SHEET_PATH = 'xl/worksheets/sheetPhoto.xml'

/** 1건이 쓰는 행 — 제목 · 사진 · 라벨 */
const ROWS_PER_ITEM = 3
const ITEMS_PER_PAGE = 3
const HEAD_PT = 30
const TITLE_PT = 22
export const PHOTO_PT = 210
const LABEL_PT = 18
/** 열 너비(엑셀 width) — A 공사 전 · B 공사 후. 51 → 357px ×2 = 714px, A4 세로 가용 폭
 *  (8.2677 − 0.30×2) × 96 = 736px 안 */
const COL_W = 51
/** 사진 상자 안쪽 여백(px) — 테두리에 딱 붙지 않게 */
const BOX_PAD = 4
const EMU_PER_PX = 9525

/** 1쪽 머리 행 다음부터 건별 3행. item i(0부터)의 첫 행 번호 */
const rowOf = (i: number) => 2 + i * ROWS_PER_ITEM

/** 한 사진을 상자에 맞춰 놓을 때의 EMU — **가로세로비를 바꾸지 않는다**(늘리면 증빙이 왜곡된다) */
function fitBox(img: PreparedPhoto): { cx: number; cy: number; colOff: number; rowOff: number } {
  const cw = colWidthToPx(COL_W), rh = rowHeightToPx(PHOTO_PT)
  const scale = Math.min((cw - BOX_PAD * 2) / img.w, (rh - BOX_PAD * 2) / img.h)
  const w = Math.max(1, Math.round(img.w * scale))
  const h = Math.max(1, Math.round(img.h * scale))
  return {
    cx: w * EMU_PER_PX, cy: h * EMU_PER_PX,
    colOff: Math.floor((cw - w) / 2) * EMU_PER_PX,
    rowOff: Math.floor((rh - h) / 2) * EMU_PER_PX,
  }
}

type Xf = { xfHead: number; xfTitle: number; xfBox: number; xfLabel: number }

/** fonts·borders·cellXfs 끝에 덧붙인다 — 기존 인덱스 무손상이 구성적으로 보장된다.
 *  ⚠ count 속성은 **실제 원소를 세어** 다시 쓴다(+N 하드코딩은 자산이 바뀌면 어긋난다).
 *  count가 어긋나면 LibreOffice는 통과하고 Excel만 복구 대화상자를 띄운다 */
function patchStyles(xml: string): { xml: string } & Xf {
  const block = (src: string, tag: string) => {
    const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(src)
    if (!m) throw new Error(`styles.xml ${tag} 블록 없음`)
    return m
  }
  const countEls = (inner: string, tag: string) =>
    [...inner.matchAll(new RegExp(`<${tag}\\b[^>]*(?:/>|>[\\s\\S]*?</${tag}>)`, 'g'))].length
  const replaceBlock = (src: string, m: RegExpExecArray, tag: string, count: number, inner: string) =>
    src.slice(0, m.index) + `<${tag} count="${count}">${inner}</${tag}>` + src.slice(m.index + m[0].length)

  const fonts = block(xml, 'fonts')
  const fontBase = countEls(fonts[1], 'font')
  const font = (sz: number, bold: boolean) =>
    `<font>${bold ? '<b val="true"/>' : ''}<sz val="${sz}"/><color rgb="FF000000"/><name val="돋움"/><family val="3"/><charset val="129"/></font>`
  let out = replaceBlock(xml, fonts, 'fonts', fontBase + 3, fonts[1] + font(16, true) + font(11, true) + font(10, false))

  const borders = block(out, 'borders')
  const borderBase = countEls(borders[1], 'border')
  out = replaceBlock(out, borders, 'borders', borderBase + 2, borders[1]
    + '<border diagonalUp="false" diagonalDown="false"><left/><right/><top/><bottom/><diagonal/></border>'
    + '<border diagonalUp="false" diagonalDown="false"><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>')

  const xfs = block(out, 'cellXfs')
  const xfBase = countEls(xfs[1], 'xf')
  const xf = (fontId: number, borderId: number, h: string) =>
    `<xf numFmtId="0" fontId="${fontId}" fillId="0" borderId="${borderId}" xfId="0"`
    + ' applyFont="true" applyBorder="true" applyAlignment="true" applyProtection="false">'
    + `<alignment horizontal="${h}" vertical="center" textRotation="0" wrapText="true" indent="0" shrinkToFit="false"/>`
    + '<protection locked="true" hidden="false"/></xf>'
  out = replaceBlock(out, xfs, 'cellXfs', xfBase + 4, xfs[1]
    + xf(fontBase, borderBase, 'center')            // 머리 — 테두리 없음
    + xf(fontBase + 1, borderBase, 'left')          // 건 제목 — 테두리 없음
    + xf(fontBase + 2, borderBase + 1, 'center')    // 사진 상자
    + xf(fontBase + 2, borderBase + 1, 'center'))   // 라벨
  return { xml: out, xfHead: xfBase, xfTitle: xfBase + 1, xfBox: xfBase + 2, xfLabel: xfBase + 3 }
}

const cell = (ref: string, s: number, text?: string | null) =>
  text ? `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escXml(text)}</t></is></c>`
    : `<c r="${ref}" s="${s}"/>`

function sheetXml(album: PreparedAlbum, heading: string, xf: Xf, drawingRid: string | null): string {
  const n = album.items.length
  const last = rowOf(n) - 1
  const rows: string[] = [
    `<row r="1" ht="${HEAD_PT}" customHeight="true">${cell('A1', xf.xfHead, heading)}${cell('B1', xf.xfHead)}</row>`,
  ]
  const merges = ['<mergeCell ref="A1:B1"/>']
  for (const [i, it] of album.items.entries()) {
    const r = rowOf(i)
    rows.push(`<row r="${r}" ht="${TITLE_PT}" customHeight="true">${cell(`A${r}`, xf.xfTitle, `${it.no}. ${it.title}`)}${cell(`B${r}`, xf.xfTitle)}</row>`)
    merges.push(`<mergeCell ref="A${r}:B${r}"/>`)
    const has = (k: 'before' | 'after') => album.photos.has(photoKey(it.no, k))
    rows.push(`<row r="${r + 1}" ht="${PHOTO_PT}" customHeight="true">`
      + cell(`A${r + 1}`, xf.xfBox, has('before') ? null : '사진 없음')
      + cell(`B${r + 1}`, xf.xfBox, has('after') ? null : '사진 없음') + '</row>')
    rows.push(`<row r="${r + 2}" ht="${LABEL_PT}" customHeight="true">`
      + cell(`A${r + 2}`, xf.xfLabel, '공사 전') + cell(`B${r + 2}`, xf.xfLabel, '공사 후') + '</row>')
  }
  // 페이지 끝마다 강제 개행 — 1쪽은 머리 1행 + 3건, 이후 3건씩.
  // ⚠ 마지막 행 뒤에는 넣지 않는다(꼬리 빈 페이지가 1장 더 인쇄된다)
  const brks: string[] = []
  for (let i = ITEMS_PER_PAGE; i < n; i += ITEMS_PER_PAGE) brks.push(`<brk id="${rowOf(i) - 1}" max="16383" man="true"/>`)

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheetPr><pageSetUpPr fitToPage="true"/></sheetPr>'
    + `<dimension ref="A1:B${last}"/>`
    + '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + `<cols><col min="1" max="2" width="${COL_W}" customWidth="true"/></cols>`
    + `<sheetData>${rows.join('')}</sheetData>`
    + `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>`
    + '<printOptions horizontalCentered="true"/>'
    + '<pageMargins left="0.3" right="0.3" top="0.35" bottom="0.35" header="0.2" footer="0.2"/>'
    // fitToWidth=1·fitToHeight=0 — 열 폭 산수가 어긋나 가로로 넘칠 때의 안전망(세로는 수동 개행 유지).
    // ⚠ fitToHeight="1"은 전 시트를 한 장으로 뭉갠다 — 절대 금지
    + '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0" scale="100"/>'
    + (brks.length ? `<rowBreaks count="${brks.length}" manualBreakCount="${brks.length}">${brks.join('')}</rowBreaks>` : '')
    + (drawingRid ? `<drawing r:id="${drawingRid}"/>` : '')
    + '</worksheet>'
}

type Media = { rid: string; file: string; data: Uint8Array; row: number; col: number; img: PreparedPhoto; descr: string }

function drawingXml(media: Media[]): string {
  const anchors = media.map((m, i) => {
    const box = fitBox(m.img)
    const id = i + 1
    return '<xdr:oneCellAnchor>'
      + `<xdr:from><xdr:col>${m.col}</xdr:col><xdr:colOff>${box.colOff}</xdr:colOff>`
      + `<xdr:row>${m.row}</xdr:row><xdr:rowOff>${box.rowOff}</xdr:rowOff></xdr:from>`
      + `<xdr:ext cx="${box.cx}" cy="${box.cy}"/>`
      + '<xdr:pic><xdr:nvPicPr>'
      + `<xdr:cNvPr id="${id}" name="photo${id}" descr="${escXml(m.descr)}"/>`
      + '<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>'
      + `<xdr:blipFill><a:blip r:embed="${m.rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>`
      + `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${box.cx}" cy="${box.cy}"/></a:xfrm>`
      + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>'
      + '</xdr:pic><xdr:clientData/></xdr:oneCellAnchor>'
  })
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

/** 「사진첩」 시트 한 장 — 불량이 0건이면 **null**(그때만 빠진다). 사진이 0장이어도 시트는 나간다.
 *  `heading`은 1쪽 머리 문구(「공사 완료 사진첩 [건물명]」). */
export async function buildPhotoAlbumSheet(
  album: PreparedAlbum, heading: string, workbookBytes: Uint8Array,
): Promise<{ part: SheetPart; photoCount: number } | null> {
  if (album.items.length === 0) return null

  // 스타일은 현재 워크북의 실제 개수 위에 덧붙인다 — 인덱스를 상수로 박으면 자산 갱신에 썩는다
  const zip = await JSZip.loadAsync(workbookBytes)
  const stylesFile = zip.file('xl/styles.xml')
  if (!stylesFile) throw new Error('styles.xml 없음')
  const styled = patchStyles(await stylesFile.async('string'))

  const media: Media[] = []
  for (const [i, it] of album.items.entries()) {
    for (const [col, kind] of (['before', 'after'] as const).entries()) {
      const img = album.photos.get(photoKey(it.no, kind))
      if (!img) continue
      const n = media.length + 1
      media.push({
        rid: `rId${n}`, file: `album${it.no}-${kind}-${n}.jpeg`, data: img.jpeg, img,
        row: rowOf(i), col, // 0-기준 행 = 사진 행(제목 행 rowOf(i) 바로 아래 → 1-기준 rowOf(i)+1)
        descr: `${it.no} ${kind === 'before' ? '공사 전' : '공사 후'}`,
      })
    }
  }

  // 파트 이름은 비어 있는 번호로 — 자산에 이미 drawing1~4·image1.png가 있다
  const usedDrawings = Object.keys(zip.files)
    .map(n => /^xl\/drawings\/drawing(\d+)\.xml$/.exec(n)?.[1]).filter(Boolean).map(Number)
  const drawingName = `drawing${Math.max(0, ...usedDrawings) + 1}.xml`
  const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
  const REL_DRAWING = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing'
  const hasDrawing = media.length > 0

  const part: SheetPart = {
    name: PHOTO_SHEET_NAME,
    path: SHEET_PATH,
    xml: sheetXml(album, heading, styled, hasDrawing ? 'rId1' : null),
    rels: hasDrawing ? rels([{ id: 'rId1', type: REL_DRAWING, target: `../drawings/${drawingName}` }]) : undefined,
    printArea: `$A$1:$B$${rowOf(album.items.length) - 1}`,
    parts: [
      { path: 'xl/styles.xml', data: styled.xml },
      ...(hasDrawing ? [
        { path: `xl/drawings/${drawingName}`, data: drawingXml(media) },
        {
          path: `xl/drawings/_rels/${drawingName}.rels`,
          data: rels(media.map(m => ({ id: m.rid, type: REL_IMAGE, target: `../media/${m.file}` }))),
        },
        ...media.map(m => ({ path: `xl/media/${m.file}`, data: m.data })),
      ] : []),
    ],
    overrides: hasDrawing ? [{
      partName: `/xl/drawings/${drawingName}`,
      contentType: 'application/vnd.openxmlformats-officedocument.drawing+xml',
    }] : [],
  }
  return { part, photoCount: media.length }
}
