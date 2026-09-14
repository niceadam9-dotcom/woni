/** 소방계획서 엑셀 **사진·도면 상자** 검사 (2026-09-14)
 *
 *  여태 이 축의 검사는 **0건**이었다 — 엑셀이 그림을 한 장도 싣지 않는데 두 스위트가 초록이었다.
 *  DB도 서버도 없이 템플릿 바이트 + 순수 함수만으로 판정한다.
 *
 *  ⭐ **판정축은 경로가 아니라 바이트와 픽셀이다.** 「route 상자에 무언가 들어갔다」는
 *    엉뚱한 그림이 들어가도 초록이다. 그래서 종류마다 **다른 단색**으로 그림을 지어
 *    산출물 media를 디코드해 **평균색**으로 「무엇이 들어갔나」를 묻는다.
 *
 *  ⭐ **자는 따로 든다.** 상자 크기·좌표를 제품 코드(`readGeometry`)로 재면 그 파서가 틀려도
 *    초록이다(계측기가 변경의 일부면 대조가 성립하지 않는다). 이 파일은 시트 XML을
 *    **자기 파서로** 다시 읽는다.
 *
 *  실행: npx tsx --conditions=react-server scripts/test-fire-plan-images.mts
 *  ⚠ `--conditions=react-server`가 없으면 `server-only` 표식에 걸려 **한 줄도 못 돈다**
 *    (갑지 「불량사진」 검사와 같은 규약).
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import sharp from 'sharp'
import { validateAnchors } from '../src/lib/xlsx-anchors.ts'
import {
  FIRE_PLAN_IMAGE_ANCHORS, FIRE_PLAN_IMAGE_BOXES, FP_SHEET, imageBoxDescr,
} from '../src/lib/fire-plan-anchors.ts'
import { embedFirePlanImages, planFirePlanImages } from '../src/lib/fire-plan-xlsx-images.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const XLSX_PATH = resolve(HERE, '../templates/fire-plan-workbook.xlsx')

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`) }
}

const EMU = 9525

/* ── 독립 계측기 — 제품의 파서를 쓰지 않는다 ── */
const colNum = (s: string) => s.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)
function rulerBox(xml: string, cell: string) {
  const m = /^([A-Z]+)(\d+)$/.exec(cell)!
  const c = colNum(m[1]), r = Number(m[2])
  let box = { c1: c, c2: c, r1: r, r2: r }
  for (const g of xml.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g)) {
    const c1 = colNum(g[1]), r1 = Number(g[2]), c2 = colNum(g[3]), r2 = Number(g[4])
    if (c1 <= c && c <= c2 && r1 <= r && r <= r2) box = { c1, c2, r1, r2 }
  }
  const fmt = /<sheetFormatPr\b[^>]*>/.exec(xml)?.[0] ?? ''
  const defW = Number(/defaultColWidth="([\d.]+)"/.exec(fmt)?.[1] ?? 8.43)
  const defH = Number(/defaultRowHeight="([\d.]+)"/.exec(fmt)?.[1] ?? 15)
  const w = new Map<number, number>(), h = new Map<number, number>()
  for (const t of xml.matchAll(/<col\b[^>]*\/>/g)) {
    const tag = t[0]
    const min = Number(/\bmin="(\d+)"/.exec(tag)?.[1] ?? 0), max = Number(/\bmax="(\d+)"/.exec(tag)?.[1] ?? 0)
    const wd = Number(/\bwidth="([\d.]+)"/.exec(tag)?.[1] ?? defW)
    for (let i = min; i <= Math.min(max, 1024) && min; i++) w.set(i, wd)
  }
  for (const t of xml.matchAll(/<row\b[^>]*?>/g)) {
    const tag = t[0]
    const rr = Number(/\sr="(\d+)"/.exec(tag)?.[1] ?? 0)
    if (rr) h.set(rr, Number(/\sht="([\d.]+)"/.exec(tag)?.[1] ?? defH))
  }
  const colSizes: number[] = []
  for (let i = box.c1; i <= box.c2; i++) colSizes.push(Math.round((w.get(i) ?? defW) * 7 + 5))
  const rowSizes: number[] = []
  for (let i = box.r1; i <= box.r2; i++) rowSizes.push(Math.round((h.get(i) ?? defH) * 4 / 3))
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
  return { ...box, colSizes, rowSizes, w: sum(colSizes), h: sum(rowSizes) }
}

/** 시트명 → zip 경로 (독립 구현) */
async function sheetPaths(zip: JSZip) {
  const wb = await zip.file('xl/workbook.xml')!.async('string')
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const t = new Map<string, string>()
  for (const m of rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) t.set(m[1], m[2])
  const out = new Map<string, string>()
  for (const m of wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const p = t.get(m[2]) ?? ''
    out.set(m[1], p.startsWith('/') ? p.slice(1) : `xl/${p.replace(/^\.\//, '')}`)
  }
  return out
}

/* 종류마다 다른 단색 — 「무엇이 어디로 갔나」를 색으로 묻는다.
 * ⚠ 단색이면 JPEG 압축이 색을 거의 안 흔든다(허용 오차 8이면 충분). */
const HUE: Record<string, { r: number; g: number; b: number }> = {
  map: { r: 220, g: 30, b: 30 },       // 빨강
  route: { r: 30, g: 200, b: 30 },     // 초록
  entry: { r: 30, g: 60, b: 220 },     // 파랑
  evacmap0: { r: 230, g: 200, b: 20 }, // 노랑
  evacmap1: { r: 180, g: 40, b: 200 }, // 보라
  cover: { r: 90, g: 90, b: 90 },      // 회색 — 상자가 없는 종류(음성축)
}
const solid = (c: { r: number; g: number; b: number }, w = 640, h = 400) =>
  sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer()

async function meanColor(buf: Uint8Array) {
  const s = await sharp(Buffer.from(buf)).stats()
  return { r: s.channels[0].mean, g: s.channels[1].mean, b: s.channels[2].mean }
}
const near = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, tol = 10) =>
  Math.abs(a.r - b.r) < tol && Math.abs(a.g - b.g) < tol && Math.abs(a.b - b.b) < tol

/* ══════════════════════ [0] 눈멂 가드 ══════════════════════ */
console.log('\n[0] 눈멂 가드 — 분모')
check('자산 파일이 있다', existsSync(XLSX_PATH), XLSX_PATH)
if (!existsSync(XLSX_PATH)) process.exit(1)
const templateBytes = new Uint8Array(readFileSync(XLSX_PATH))
check('사진 상자가 0이 아니다', FIRE_PLAN_IMAGE_BOXES.length >= 5, `${FIRE_PLAN_IMAGE_BOXES.length}칸`)
check('상자 목록과 앵커 수가 같다',
  FIRE_PLAN_IMAGE_ANCHORS.length === FIRE_PLAN_IMAGE_BOXES.length,
  `${FIRE_PLAN_IMAGE_ANCHORS.length}/${FIRE_PLAN_IMAGE_BOXES.length}`)
{
  const zt = await JSZip.loadAsync(templateBytes)
  const draw = Object.keys(zt.files).filter(n => n.startsWith('xl/drawings/'))
  const media = Object.keys(zt.files).filter(n => n.startsWith('xl/media/'))
  // 이 전제가 깨지면 아래 「그림 N장이 새로 생겼다」가 전부 의미를 잃는다
  check('템플릿에 drawing·media가 0개(전제)', draw.length === 0 && media.length === 0,
    `drawing ${draw.length} · media ${media.length}`)
}

/* ══════════════════════ [1] 상자 좌표 — 라벨 검증 ══════════════════════ */
console.log('\n[1] 상자 좌표 — 라벨 대조')
const av = validateAnchors(templateBytes, FIRE_PLAN_IMAGE_ANCHORS)
check('validateAnchors ok', av.ok, av.ok ? '' : av.failures.slice(0, 4).join(' / '))
if (!av.ok) { console.log('\n좌표가 어긋나 더 볼 수 없다'); process.exit(1) }
check('healed 0 (치유 = 좌표가 이미 밀렸다)', av.healed.length === 0, av.healed.join(' / '))

/* ══════════════════════ [2] 상자 기하 — 정말 「큰 빈 상자」인가 ══════════════════════
 *  ⭐ 라벨만 맞으면 통과하는 함정을 여기서 막는다. 좌표가 옆 칸(라벨 줄)을 가리키면
 *    라벨 대조는 초록인데 그림이 20px 줄에 박힌다. */
console.log('\n[2] 상자 기하 — 독립 계측기로 실측')
{
  const zt = await JSZip.loadAsync(templateBytes)
  const paths = await sheetPaths(zt)
  for (const a of av.anchors) {
    const xml = await zt.file(paths.get(a.sheet)!)!.async('string')
    const b = rulerBox(xml, a.cell)
    check(`${a.field} 상자가 크다`, b.w >= 300 && b.h >= 120, `${a.sheet}!${a.cell} ${b.w}×${b.h}px`)
    // 병합되지 않은 홑칸이면 그건 상자가 아니다
    check(`${a.field} 병합 상자다`, b.c2 > b.c1 || b.r2 > b.r1, `${b.c1}-${b.c2} / ${b.r1}-${b.r2}`)
  }
}

/* ══════════════════════ [3] 배정(plan) — 순수 함수 ══════════════════════ */
console.log('\n[3] 배정 — 어떤 그림이 어느 상자로 가는가')
type Img = { file: string; kind: string; caption: string }
const srcs = {
  map: await solid(HUE.map), route: await solid(HUE.route), entry: await solid(HUE.entry),
  evac0: await solid(HUE.evacmap0), evac1: await solid(HUE.evacmap1), cover: await solid(HUE.cover),
}
const fullImages: Img[] = [
  { file: 'img_0.png', kind: 'cover', caption: '' },
  { file: 'img_1.png', kind: 'map', caption: '위치도' },
  { file: 'img_2.png', kind: 'route', caption: '소방차 진입경로' },
  { file: 'img_3.png', kind: 'entry', caption: '소방차 진입장소 및 주변 소방시설 현황' },
  { file: 'img_4.png', kind: 'evacmap', caption: '2층' },
  { file: 'img_5.png', kind: 'evacmap', caption: '3층' },
]
const fullAssets = [
  { name: 'img_0.png', data: new Uint8Array(srcs.cover) },
  { name: 'img_1.png', data: new Uint8Array(srcs.map) },
  { name: 'img_2.png', data: new Uint8Array(srcs.route) },
  { name: 'img_3.png', data: new Uint8Array(srcs.entry) },
  { name: 'img_4.png', data: new Uint8Array(srcs.evac0) },
  { name: 'img_5.png', data: new Uint8Array(srcs.evac1) },
]
const plan = planFirePlanImages(fullImages, fullAssets, av.anchors)
check('상자 5칸이 모두 배정됐다', plan.targets.length === 5, `${plan.targets.length}칸`)
{
  const at = (sheet: string, cell: string) => plan.targets.find(t => t.sheet === sheet && t.cell === cell)
  // ⭐ 바이트 동일성으로 판정 — 「그 상자에 무언가 들어갔다」가 아니라 「**그 그림**이 들어갔다」
  const same = (a: Uint8Array | undefined, b: Buffer) => !!a && Buffer.from(a).equals(b)
  check('위치도 → 1.3 위치·운영현황!A3', same(at(FP_SHEET.F1_3_LOC, 'A3')?.data, srcs.map))
  check('경로도 → 1.3 진입경로!A2', same(at(FP_SHEET.F1_3_ROUTE, 'A2')?.data, srcs.route))
  check('진입장소 사진 → 1.3 진입경로!A4', same(at(FP_SHEET.F1_3_ROUTE, 'A4')?.data, srcs.entry))
  check('평면도 1장째 → 1.5.2!A4', same(at(FP_SHEET.F1_5_2, 'A4')?.data, srcs.evac0))
  check('평면도 2장째 → 1.5.2!A6', same(at(FP_SHEET.F1_5_2, 'A6')?.data, srcs.evac1))
  // 자리표 비우기는 **1.5.2 두 칸뿐**이다(나머지 상자엔 안내 글자가 없다)
  const bc = plan.blankCells.map(c => `${c.sheet}!${c.cell}`).sort()
  check('자리표 비우기 = 1.5.2 두 칸', bc.length === 2 && bc.every(s => s.startsWith(FP_SHEET.F1_5_2)), bc.join(' · '))
  // 음성축 — 상자 없는 종류는 조용히 사라지지 않는다
  check('표지 사진은 「상자 없음」으로 고지된다',
    plan.notes.some(n => n.includes('cover') && n.includes('상자가 없어')), plan.notes.join(' | '))
}
{
  // 넘침 — 평면도 3장이면 2칸만 쓰고 1장은 **고지**한다
  const many = [...fullImages, { file: 'img_6.png', kind: 'evacmap', caption: '4층' }]
  const p = planFirePlanImages(many, [...fullAssets, { name: 'img_6.png', data: new Uint8Array(srcs.evac0) }], av.anchors)
  check('평면도 3장 → 2칸 + 넘침 고지', p.targets.length === 5 && p.notes.some(n => n.includes('1장 미표기')),
    p.notes.join(' | '))
}
{
  const p = planFirePlanImages([], [], av.anchors)
  check('그림 0장 → 배정 0·자리표 0', p.targets.length === 0 && p.blankCells.length === 0)
}
{
  // 짝 깨짐(images에는 있는데 assets에 바이트가 없다) — 조용히 넘기지 않는다
  const p = planFirePlanImages([{ file: 'ghost.png', kind: 'route', caption: '' }], [], av.anchors)
  check('바이트 없는 그림은 고지된다', p.targets.length === 0 && p.notes.some(n => n.includes('이미지 바이트 없음')),
    p.notes.join(' | '))
}

/* ══════════════════════ [4] 삽입(embed) — 산출물 바이트 ══════════════════════ */
console.log('\n[4] 삽입 — 산출물 구조와 픽셀')
const out = await embedFirePlanImages(templateBytes, plan.targets)
check('앉힌 그림 5장', out.placed === 5, `${out.placed}장 · notes=${out.notes.join(' | ') || '없음'}`)
const zo = await JSZip.loadAsync(out.bytes)
const paths = await sheetPaths(zo)
{
  const draws = Object.keys(zo.files).filter(n => /^xl\/drawings\/drawing\d+\.xml$/.test(n)).sort()
  // ⚠ JSZip은 `xl/media/` **폴더 엔트리**도 목록에 넣는다 — 거르지 않으면 장수가 하나 부풀어
  //   「그림당 1장」이 영영 안 맞는다(이 검사가 처음 빨강이던 이유다)
  const media = Object.keys(zo.files).filter(n => n.startsWith('xl/media/') && !zo.files[n].dir).sort()
  // 상자는 5칸이지만 시트는 셋(1.3 진입경로가 두 칸을 갖는다) → drawing 3장·media 5장
  check('drawing 파트 3장(시트당 1장)', draws.length === 3, draws.join(' '))
  check('media 파트 5장(그림당 1장)', media.length === 5, `${media.length}장`)
  check('media는 전부 .jpeg', media.every(n => n.endsWith('.jpeg')), media.join(' '))

  const ct = await zo.file('[Content_Types].xml')!.async('string')
  check('[Content_Types]에 jpeg Default', /<Default\s+Extension="jpeg"/.test(ct))
  const ov = [...ct.matchAll(/<Override\s+PartName="\/xl\/drawings\/drawing\d+\.xml"/g)].length
  check('[Content_Types]에 drawing Override 3건', ov === 3, `${ov}건`)
}

/* 시트별 — drawing 배선·좌표·기하·픽셀 */
for (const t of plan.targets) {
  const xml = await zo.file(paths.get(t.sheet)!)!.async('string')
  const rid = /<drawing r:id="([^"]+)"\/>/.exec(xml)?.[1]
  check(`${t.sheet} 시트에 <drawing>이 있다`, !!rid, rid ?? '')
  if (!rid) continue
  // CT_Worksheet 순서 — drawing 뒤에 다른 형제가 없어야 한다(이 서식에는 없다)
  check(`${t.sheet} <drawing>이 </worksheet> 직전`,
    xml.indexOf('<drawing r:id=') > xml.lastIndexOf('<pageSetup'))

  const relsPath = paths.get(t.sheet)!.replace(/worksheets\/([^/]+)$/, 'worksheets/_rels/$1.rels')
  const rels = await zo.file(relsPath)?.async('string')
  const dTarget = rels ? new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] : undefined
  check(`${t.sheet} rels가 drawing을 가리킨다`, !!dTarget?.includes('../drawings/drawing'), dTarget ?? '(없음)')
  if (!dTarget) continue

  const dName = dTarget.replace('../drawings/', '')
  const dXml = await zo.file(`xl/drawings/${dName}`)!.async('string')
  const dRels = await zo.file(`xl/drawings/_rels/${dName}.rels`)!.async('string')

  // 이 상자의 앵커를 descr로 골라낸다(한 시트에 두 상자가 있는 경우 대비)
  const anchorXml = [...dXml.matchAll(/<xdr:oneCellAnchor>[\s\S]*?<\/xdr:oneCellAnchor>/g)]
    .map(m => m[0]).find(a => a.includes(`descr="${t.descr.replace(/&/g, '&amp;')}"`))
  check(`${t.sheet}!${t.cell} 앵커가 있다`, !!anchorXml, t.descr)
  if (!anchorXml) continue

  const tplZip = await JSZip.loadAsync(templateBytes)
  const box = rulerBox(await tplZip.file(paths.get(t.sheet)!)!.async('string'), t.cell)
  const fromCol = Number(/<xdr:col>(\d+)<\/xdr:col>/.exec(anchorXml)![1])
  const fromRow = Number(/<xdr:row>(\d+)<\/xdr:row>/.exec(anchorXml)![1])
  const colOff = Number(/<xdr:colOff>(\d+)<\/xdr:colOff>/.exec(anchorXml)![1]) / EMU
  const rowOff = Number(/<xdr:rowOff>(\d+)<\/xdr:rowOff>/.exec(anchorXml)![1]) / EMU
  const cx = Number(/<xdr:ext cx="(\d+)"/.exec(anchorXml)![1])
  const cy = Number(/cy="(\d+)"\/>/.exec(anchorXml)![1])

  /* ⭐ **절대 위치로 묻는다.** 「from이 상자의 왼쪽 위 칸인가」만 물으면 두 결함을 놓친다:
   *   ① 0-based 변환이 틀려 한 칸 밀리는 것 ② `colOff`를 그 **열 폭보다 크게** 줘서 뷰어가
   *   클램프해 그림이 왼쪽에 붙는 것(2026-09-14 LibreOffice 육안이 잡았고 구조 단언은 전부
   *   초록이었다 — 미세 격자라 A열이 18px뿐이었다). 그래서 칸 인덱스 + 칸 안 오프셋을
   *   **px 절대값으로 되돌려** 상자 안에서 가운데인지 잰다. */
  const ci = fromCol - (box.c1 - 1)
  const ri = fromRow - (box.r1 - 1)
  const inBox = ci >= 0 && ci < box.colSizes.length && ri >= 0 && ri < box.rowSizes.length
  check(`${t.sheet}!${t.cell} 앵커 칸이 상자 안`, inBox, `col+${ci}/${box.colSizes.length} row+${ri}/${box.rowSizes.length}`)
  if (inBox) {
    /* ⭐ **오프셋은 그 칸 폭 안에 있어야 한다.** 절대 위치가 맞아도 `colOff`가 칸 폭을 넘으면
     *   뷰어가 클램프해 그림이 왼쪽 위로 붙는다 — 계산상으로는 가운데인데 인쇄물은 아니다.
     *   이 한 줄이 없으면 「칸을 안 옮기고 오프셋만 크게 주는」 옛 구현이 그대로 초록이다. */
    check(`${t.sheet}!${t.cell} 오프셋이 그 칸 폭 안`,
      colOff <= box.colSizes[ci] && rowOff <= box.rowSizes[ri],
      `${colOff.toFixed(0)}/${box.colSizes[ci]}px · ${rowOff.toFixed(0)}/${box.rowSizes[ri]}px`)
    const absX = box.colSizes.slice(0, ci).reduce((a, b) => a + b, 0) + colOff
    const absY = box.rowSizes.slice(0, ri).reduce((a, b) => a + b, 0) + rowOff
    const wantX = (box.w - cx / EMU) / 2, wantY = (box.h - cy / EMU) / 2
    /* ⚠ 허용 오차는 **2px**이다. 처음에 20px(≈칸 폭)로 뒀더니 「열을 한 칸 밀어 쓰는」 변이
     *   M2가 그 안에 숨어 초록이 됐다 — 쪼개기는 px 단위로 정확하므로 느슨할 이유가 없다. */
    check(`${t.sheet}!${t.cell} 그림이 상자 안에서 가운데`,
      Math.abs(absX - wantX) <= 2 && Math.abs(absY - wantY) <= 2,
      `(${absX.toFixed(0)},${absY.toFixed(0)}) vs (${wantX.toFixed(0)},${wantY.toFixed(0)})`)
    // 그림이 상자 밖으로 삐져나가지 않는다
    check(`${t.sheet}!${t.cell} 그림이 상자 밖으로 안 나간다`,
      absX >= 0 && absY >= 0 && absX + cx / EMU <= box.w + 1 && absY + cy / EMU <= box.h + 1,
      `${absX.toFixed(0)}+${(cx / EMU).toFixed(0)} ≤ ${box.w}`)
  }
  check(`${t.sheet}!${t.cell} 그림이 상자를 안 넘는다`,
    cx <= box.w * EMU && cy <= box.h * EMU, `${Math.round(cx / EMU)}×${Math.round(cy / EMU)}px ≤ ${box.w}×${box.h}px`)
  /* ⭐ **반대쪽 단언** — 안 넘는 것만 물으면 「상자를 잘못 재서 우표만 하게 넣었다」가 초록으로
   *   통과한다(변이 M11이 실증: 상자를 300×200으로 고정했는데 83/0이 그대로 초록이었다).
   *   비율 보존 축소이므로 **한 변은 반드시 상자에 닿는다** — 둘 다 한참 모자라면 자를 잘못 든 것이다. */
  const fillRatio = Math.max(cx / EMU / box.w, cy / EMU / box.h)
  check(`${t.sheet}!${t.cell} 그림이 상자를 채운다`, fillRatio >= 0.85, `${(fillRatio * 100).toFixed(0)}%`)
  // 가로세로비 보존 — 늘리면 도면이 왜곡된다
  const srcMeta = await sharp(Buffer.from(t.data)).metadata()
  const srcRatio = srcMeta.width! / srcMeta.height!
  check(`${t.sheet}!${t.cell} 가로세로비 보존`, Math.abs(cx / cy - srcRatio) / srcRatio < 0.02,
    `${(cx / cy).toFixed(3)} vs ${srcRatio.toFixed(3)}`)

  // ⭐ 픽셀 판정 — 이 상자에 **그 그림**이 들어갔는가(경로·이름이 아니라 색으로)
  const embedRid = /r:embed="([^"]+)"/.exec(anchorXml)![1]
  const mediaTarget = new RegExp(`Id="${embedRid}"[^>]*Target="([^"]+)"`).exec(dRels)![1]
  const mediaBytes = await zo.file(`xl/media/${mediaTarget.replace('../media/', '')}`)!.async('uint8array')
  check(`${t.sheet}!${t.cell} media가 JPEG`, mediaBytes[0] === 0xFF && mediaBytes[1] === 0xD8)
  const got = await meanColor(mediaBytes)
  const want = await meanColor(t.data)
  check(`${t.sheet}!${t.cell} 들어간 그림이 그 그림이다(평균색)`, near(got, want),
    `got ${got.r.toFixed(0)},${got.g.toFixed(0)},${got.b.toFixed(0)} / want ${want.r.toFixed(0)},${want.g.toFixed(0)},${want.b.toFixed(0)}`)
}

/* ══════════════════════ [5] 무손상 ══════════════════════ */
console.log('\n[5] 무손상 — 그림을 넣어도 나머지는 그대로')
{
  const wbT = XLSX.read(templateBytes, { cellStyles: false })
  const wbO = XLSX.read(out.bytes, { cellStyles: false })
  check('시트 목록 불변', wbT.SheetNames.join('|') === wbO.SheetNames.join('|'),
    `${wbT.SheetNames.length} vs ${wbO.SheetNames.length}`)
  // 값 칸이 하나라도 변하면 안 된다 — 이 모듈은 그림만 넣는다(자리표 비우기는 주입 단계가 한다)
  let diff = 0
  for (const name of wbT.SheetNames) {
    const a = wbT.Sheets[name] as Record<string, XLSX.CellObject>
    const b = wbO.Sheets[name] as Record<string, XLSX.CellObject>
    for (const k of Object.keys(a)) {
      if (k.startsWith('!')) continue
      if (String(a[k]?.v ?? '') !== String(b[k]?.v ?? '')) diff++
    }
  }
  check('셀 값 변경 0칸', diff === 0, `${diff}칸`)
}
{
  const zero = await embedFirePlanImages(templateBytes, [])
  check('그림 0장이면 바이트를 손대지 않는다',
    zero.bytes === templateBytes && zero.placed === 0)
}

/* ══════════════════════ [6] 이름·대체텍스트 ══════════════════════ */
console.log('\n[6] 대체 텍스트 — 자구를 베끼지 않는다')
{
  const b = FIRE_PLAN_IMAGE_BOXES.find(x => x.field === 'img_evacmap_1')!
  // manifest의 그 칸 글자를 그대로 쓴다(`[해당 층 평면도]`) — 코드에 베낀 문자열이 아니다
  check('1.5.2 상자 설명이 manifest 자구', imageBoxDescr(b).includes('평면도'), imageBoxDescr(b))
  const r = FIRE_PLAN_IMAGE_BOXES.find(x => x.field === 'img_entry')!
  check('진입장소 상자 설명이 manifest 자구', imageBoxDescr(r).includes('진입장소'), imageBoxDescr(r))
}

console.log(`\n결과: ${pass} pass / ${fail} fail`)
process.exit(fail ? 1 : 0)
