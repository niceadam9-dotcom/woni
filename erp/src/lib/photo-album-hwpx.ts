import 'server-only'
import JSZip from 'jszip'
import sharp from 'sharp'
import { photoKey, type PreparedAlbum, type PreparedPhoto } from '@/lib/photo-album'

/** 공사 완료 사진첩 한글파일(HWPX) — 본보기 `공사 완료 사진첩.hwp`를 한글에서 바로 열리게 (2026-10-06).
 *
 *  ⚠ 소민터 업로드용 별지 9호 HWPX(report9-hwpx)에 **덧붙이지 않는다** — 소민터는 그 파일을 서식으로
 *    읽어 칸을 채우므로 뒤에 사진 쪽이 붙으면 업로드가 거부될 수 있다. 사진첩은 따로 받는 별책이다.
 *
 *  골격: 운영 이미지에 이미 실린 `templates/report9-placeholder.hwpx`의 header(글꼴·글자/문단 모양)·
 *  settings·META-INF를 그대로 쓰고, section0은 첫 문단의 구역 정의(secPr — A4·여백)만 살려 새로 쓴다.
 *  그림 문단은 한글이 저장한 실물(`erp_goal/_Data/fireplan-out/_template.hwpx`의 글자처럼 취급 그림)을
 *  본떴다: orgSz = 원본 px × 75(HWPUNIT), sz/curSz = 표시 크기, scaMatrix = 표시 ÷ 원본.
 *
 *  사진 칸은 **고정 크기 캔버스**에 앉힌다(흰 바탕·회색 테두리·가로세로비 유지). 글자처럼 취급한 그림은
 *  제 크기대로 줄에 놓이므로 세로 사진·가로 사진이 섞이면 아래 「공사 전 / 공사 후」 라벨이 어긋난다 —
 *  칸 크기를 하나로 만들면 정렬이 구성적으로 맞는다. 사진이 없는 칸은 빈 캔버스(라벨에 「사진 없음」).
 *
 *  ⚠ 로컬 한글 2010은 HWPX를 텍스트로 열면서도 open=True를 돌려준다(거짓 초록 — project_b4 메모).
 *    이 파일의 최종 판정은 **한글 2014+ 실기 열람**이다. */

// 템플릿 header.xml의 모양 번호 — report9-placeholder.hwpx 실측(2026-10-06)
const PARA_CENTER = 10     // 가운데 정렬
const PARA_LEFT = 1        // 왼쪽 정렬
const CHAR_SEC = 17        // 첫 문단(구역 정의) 런 — 템플릿 원문 그대로
const CHAR_COVER = 21      // 16pt 한양견고딕 — 표지 제목·상호
const CHAR_BLDG = 32       // 13pt 돋움 — [건물명]
const CHAR_TITLE = 39      // 12pt 돋움 — 건 제목
const CHAR_BODY = 23       // 11pt 돋움 — 라벨·연락처

/** 사진 칸(HWPUNIT, 1/7200in) — 본문 폭 48192(A4 59528 − 좌우 5668×2) 안에 두 칸 + 간격.
 *  높이는 **한 장 3건**에서 정했다: 한컴 2024 뷰어 실측(2026-10-06) 1건 = 칸 높이 + 약 2.5cm(제목·라벨 줄).
 *  본문 높이 26.7cm(A4 29.7 − 위 2.0 − 아래 1.0) ÷ 3 = 8.9cm 안 → 칸 5.64cm(16000)이면 1건 ≈ 8.1cm.
 *  17000(6.0cm)에 건 사이 빈 줄까지 두었더니 1건 9.3cm로 **한 장에 2건**만 들어가 7건이 7쪽이 됐다. */
const SLOT_H = 16000
/** 캔버스 픽셀 — SLOT 비와 같은 비(900:680)로 만든다. 폭은 높이에서 따라 나온다 */
const CANVAS_W = 900
const CANVAS_H = 680
const SLOT_W = Math.round(SLOT_H * CANVAS_W / CANVAS_H)
const BORDER = 3
const HWP_PER_PX = 75
/** 11pt 돋움 글자 폭(HWPUNIT) — 한컴 2024 뷰어 실측: 한글 ≈ 1100(전각), 공백·괄호·숫자 ≈ 550(반각) */
const W_FULL = 1100
const W_HALF = 550
/** 두 그림 사이 공백 수 */
const GAP_SPACES = 4
const ITEMS_PER_PAGE = 3

const textWidth = (s: string) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2fff ? W_FULL : W_HALF), 0)
/** 라벨 두 개를 각 사진 칸의 가운데 아래에 놓는 공백 수 — 두 칸 중심 거리 = 칸 폭 + 간격 */
function labelGap(a: string, b: string): number {
  const centerDist = SLOT_W + GAP_SPACES * W_HALF
  return Math.max(2, Math.round((centerDist - (textWidth(a) + textWidth(b)) / 2) / W_HALF))
}

export type PhotoAlbumHwpxInput = {
  buildingName: string
  company: { name: string; phone: string; fax: string; email: string }
  album: PreparedAlbum
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 사진 → 고정 캔버스 JPEG(없으면 빈 칸). 테두리는 extend로 — 글꼴이 필요 없어 컨테이너에서도 같다 */
async function slotImage(img: PreparedPhoto | undefined): Promise<Uint8Array> {
  const innerW = CANVAS_W - BORDER * 2, innerH = CANVAS_H - BORDER * 2
  const inner = img
    ? await sharp(Buffer.from(img.jpeg))
      .resize({ width: innerW, height: innerH, fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' }).toBuffer()
    : await sharp({ create: { width: innerW, height: innerH, channels: 3, background: '#ffffff' } }).png().toBuffer()
  const out = await sharp(inner)
    .extend({ top: BORDER, bottom: BORDER, left: BORDER, right: BORDER, background: '#9a9a9a' })
    .jpeg({ quality: 82 }).toBuffer()
  return new Uint8Array(out)
}

/** 글자처럼 취급한 그림 — 한글 실물 저장본의 원소 순서를 그대로 따른다.
 *  `seq`는 문서 안 일련번호(그림 id·zOrder) — 모듈 전역에 두면 동시 요청끼리 섞인다 */
function picXml(seq: number, binId: string, pxW: number, pxH: number, w: number, h: number): string {
  const ow = pxW * HWP_PER_PX, oh = pxH * HWP_PER_PX
  const id = 1900000000 + seq
  const sx = (w / ow).toFixed(6), sy = (h / oh).toFixed(6)
  return `<hp:pic id="${id}" zOrder="${seq}" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${id - 1000000000}" reverse="0">`
    + '<hp:offset x="0" y="0"/>'
    + `<hp:orgSz width="${ow}" height="${oh}"/><hp:curSz width="${w}" height="${h}"/>`
    + '<hp:flip horizontal="0" vertical="0"/>'
    + `<hp:rotationInfo angle="0" centerX="${Math.round(w / 2)}" centerY="${Math.round(h / 2)}" rotateimage="1"/>`
    + '<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
    + `<hc:scaMatrix e1="${sx}" e2="0" e3="0" e4="0" e5="${sy}" e6="0"/>`
    + '<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>'
    + `<hc:img binaryItemIDRef="${binId}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>`
    + `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${ow}" y="0"/><hc:pt2 x="${ow}" y="${oh}"/><hc:pt3 x="0" y="${oh}"/></hp:imgRect>`
    + `<hp:imgClip left="0" right="${ow}" top="0" bottom="${oh}"/>`
    + '<hp:inMargin left="0" right="0" top="0" bottom="0"/>'
    + `<hp:imgDim dimwidth="${ow}" dimheight="${oh}"/><hp:effects/>`
    + `<hp:sz width="${w}" widthRelTo="ABSOLUTE" height="${h}" heightRelTo="ABSOLUTE" protect="0"/>`
    + '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
    + '<hp:outMargin left="0" right="0" top="0" bottom="0"/>'
    + '</hp:pic>'
}

const para = (paraPr: number, charPr: number, inner: string, pageBreak = false) =>
  `<hp:p id="2147483648" paraPrIDRef="${paraPr}" styleIDRef="0" pageBreak="${pageBreak ? 1 : 0}" columnBreak="0" merged="0">`
  + `<hp:run charPrIDRef="${charPr}">${inner}</hp:run></hp:p>`
const text = (s: string) => (s ? `<hp:t>${esc(s)}</hp:t>` : '<hp:t/>')
const blank = (n: number) => Array.from({ length: n }, () => para(PARA_CENTER, CHAR_BODY, text(''))).join('')

/** 템플릿 HWPX + 사진첩 → 새 HWPX 바이트 */
export async function renderPhotoAlbumHwpx(templateBytes: Uint8Array, input: PhotoAlbumHwpxInput): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(templateBytes)
  const secFile = zip.file('Contents/section0.xml')
  const hpfFile = zip.file('Contents/content.hpf')
  if (!secFile || !hpfFile) throw new Error('HWPX 템플릿 구조 이상 — section0.xml·content.hpf 없음')
  const sec = await secFile.async('string')

  // ① 구역 정의 — 첫 문단의 secPr + 단 정의(colPr)까지만 살린다(A4·여백이 여기 있다)
  const open = /<hs:sec\b[^>]*>/.exec(sec)
  const secEnd = sec.indexOf('</hp:secPr>')
  const ctrlEnd = sec.indexOf('</hp:ctrl>', secEnd)
  const firstP = sec.indexOf('<hp:p ')
  if (!open || secEnd < 0 || ctrlEnd < 0 || firstP < 0) throw new Error('HWPX 템플릿 구역 정의(secPr) 미발견')
  const secPrRun = sec.slice(sec.indexOf('<hp:secPr', firstP), ctrlEnd + '</hp:ctrl>'.length)
  const head = sec.slice(0, open.index + open[0].length)

  // ② 사진 칸 이미지 — 건마다 공사 전·후 두 장(없으면 빈 칸)
  const bins: Array<{ id: string; file: string; data: Uint8Array }> = []
  const addBin = (data: Uint8Array) => {
    const n = bins.length + 1
    const b = { id: `album${n}`, file: `BinData/album${n}.jpg`, data }
    bins.push(b)
    return b.id
  }

  const { album, buildingName, company } = input
  const body: string[] = []
  // 표지 — 본보기 배치(제목 → [건물명] → 상호 → 연락처). 세로 간격은 빈 줄로
  body.push(`<hp:p id="0" paraPrIDRef="${PARA_CENTER}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">`
    + `<hp:run charPrIDRef="${CHAR_SEC}">${secPrRun}</hp:run><hp:run charPrIDRef="${CHAR_BODY}"><hp:t/></hp:run></hp:p>`)
  body.push(blank(5), para(PARA_CENTER, CHAR_COVER, text('공  사   완  료   사  진  첩')))
  body.push(blank(12), para(PARA_CENTER, CHAR_BLDG, text(`[  ${buildingName}  ]`)))
  body.push(blank(12), para(PARA_CENTER, CHAR_COVER, text(company.name)))
  const contact = [company.phone && `T : ${company.phone}`, company.fax && `F : ${company.fax}`, company.email && `email : ${company.email}`]
    .filter(Boolean).join('      ')
  body.push(blank(8), para(PARA_CENTER, CHAR_BODY, text(contact)))

  for (const [i, it] of album.items.entries()) {
    const before = album.photos.get(photoKey(it.no, 'before'))
    const after = album.photos.get(photoKey(it.no, 'after'))
    const idB = addBin(await slotImage(before))
    const idA = addBin(await slotImage(after))
    // 한 장에 3건 — 매 장의 첫 건은 쪽 나눔(표지 뒤 첫 건 포함)
    body.push(para(PARA_LEFT, CHAR_TITLE, text(`${it.no}. ${it.title}`), i % ITEMS_PER_PAGE === 0))
    body.push(para(PARA_CENTER, CHAR_BODY,
      picXml(bins.length - 1, idB, CANVAS_W, CANVAS_H, SLOT_W, SLOT_H) + text(' '.repeat(GAP_SPACES))
      + picXml(bins.length, idA, CANVAS_W, CANVAS_H, SLOT_W, SLOT_H)))
    const la = before ? '공사 전' : '공사 전(사진 없음)'
    const lz = after ? '공사 후' : '공사 후(사진 없음)'
    body.push(para(PARA_CENTER, CHAR_BODY, text(`${la}${' '.repeat(labelGap(la, lz))}${lz}`)))
  }

  zip.file('Contents/section0.xml', `${head}${body.join('')}</hs:sec>`)

  // ③ 매니페스트 — 그림은 opf:item(isEmbeded=1)로 등록해야 binaryItemIDRef가 풀린다
  let hpf = await hpfFile.async('string')
  const items = bins.map(b => `<opf:item id="${b.id}" href="${b.file}" media-type="image/jpg" isEmbeded="1"/>`).join('')
  hpf = hpf.replace('<opf:item id="section0"', () => `${items}<opf:item id="section0"`)
  if (bins.length && !hpf.includes(`id="${bins[0].id}"`)) throw new Error('HWPX 매니페스트 갱신 실패')
  zip.file('Contents/content.hpf', hpf)
  // 그림은 무압축(한글 저장본과 같다 — JPEG는 이미 압축돼 있다)
  for (const b of bins) zip.file(b.file, b.data, { compression: 'STORE' })

  // ④ 미리보기 글 — 탐색기 미리보기·검색용
  const prv = [`공사 완료 사진첩`, `[ ${buildingName} ]`, company.name,
    ...album.items.map(it => `<${it.no}. ${it.title}>`)].join('\r\n')
  if (zip.file('Preview/PrvText.txt')) zip.file('Preview/PrvText.txt', prv)

  // 템플릿에서 무압축인 두 항목(mimetype은 OCF 규약상 첫 항목·무압축 필수)은 그대로 무압축 —
  // report9-hwpx와 같은 처리. 항목 순서는 JSZip이 유지한다
  for (const name of ['mimetype', 'version.xml']) {
    const f = zip.file(name)
    if (f) zip.file(name, await f.async('uint8array'), { compression: 'STORE', createFolders: false })
  }
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
}
