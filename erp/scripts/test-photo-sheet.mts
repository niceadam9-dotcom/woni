/** 공사 완료 사진첩 검증 — 엑셀 「사진첩」 시트 · PDF 렌더 · 한글파일(HWPX) (2026-10-06, 종전 소방계획서_46 「불량사진」)
 *  실행: npx tsx --conditions=react-server scripts/test-photo-sheet.mts   (+ --lo 로 LibreOffice 쪽수 축)
 *
 *  DB·네트워크에 기대지 않는다 — sharp로 합성한 픽스처를 스텁 Storage가 돌려준다.
 *
 *  ⚠ **하한을 먼저 단언한다**([0]). 임베드 사진이 0이면 이하의 '고아 0'·'왜곡 0' 류가 전부
 *  공허하게 통과한다 — 초록 화면이 아무것도 지키지 않는 상태가 이 검사의 최대 실패 양식이다.
 *
 *  사용자 지시(2026-10-06)로 바뀐 세 축을 각각 단언한다:
 *   · 위치 — 워크북 **맨 끝** [2]
 *   · 모양 — 「n. 제목」 + 공사 전 | 공사 후 **좌우**(A·B열) [8][12]
 *   · 존재 — 불량이 있으면 **사진 0장이어도** 시트가 나간다 [13]
 *  기계로만 잡히는 축(육안·LibreOffice로는 안 잡힌다):
 *   · 요소 순서 [9] — 어기면 LO는 멀쩡히 열고 **Excel만** 복구 대화상자를 띄운다
 *   · 종횡비 [7]   — media 실치수 대 EMU 비로만 확정된다
 *   · localSheetId [4] — 틀리면 **남의 인쇄영역**이 적용된다. 파일은 정상 개봉된다 */
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import JSZip from 'jszip'
import sharp from 'sharp'
import { buildPhotoAlbumSheet, PHOTO_SHEET_NAME } from '../src/lib/defect-photo-embed.ts'
import {
  albumItemsFromDefects, albumTitleOf, prepareAlbumPhotos,
  type AlbumDefectRow, type PhotoStorage,
} from '../src/lib/photo-album.ts'
import { renderPhotoAlbumHwpx } from '../src/lib/photo-album-hwpx.ts'
import { renderPhotoAlbum } from '../src/lib/doc-templates/photo-album.ts'
import { insertSheetAfter, lastSheetName, localNameMap } from '../src/lib/xlsx-sheet-surgery.ts'

const FULL = 'templates/report-workbook-full.xlsx'
const HWPX_TPL = 'templates/report9-placeholder.hwpx'
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')

const base = new Uint8Array(readFileSync(FULL))
const HEADING = '공사 완료 사진첩  [ 검증빌딩 ]'

// ── 픽스처 ──────────────────────────────────────────────────────────────────
const bucket = new Map<string, Uint8Array>()
const store: PhotoStorage = {
  storage: {
    from: () => ({
      download: async (p: string) => bucket.has(p)
        ? { data: new Blob([bucket.get(p)!]), error: null }
        : { data: null, error: { message: '없음' } },
    }),
  },
}
async function putJpeg(path: string, w: number, h: number) {
  const b = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 60, b: 60 } } })
    .jpeg().toBuffer()
  bucket.set(path, new Uint8Array(b))
}

async function makeDefects(n: number, opts: { broken?: boolean; noPhoto?: boolean } = {}): Promise<AlbumDefectRow[]> {
  const rows: AlbumDefectRow[] = []
  for (let i = 0; i < n; i++) {
    const b = `insp/def${i}/before.jpg`, a = `insp/def${i}/after.jpg`
    // 가로·세로·정사각을 돌아가며 — 상자 맞춤이 한 방향에서만 옳은 것을 잡는다
    const dims: Array<[number, number]> = [[1200, 900], [900, 1200], [800, 800]]
    const [bw, bh] = dims[i % 3], [aw, ah] = dims[(i + 1) % 3]
    if (!opts.noPhoto) { await putJpeg(b, bw, bh); await putJpeg(a, aw, ah) }
    rows.push({
      defect_code: `3-A-${String(i + 1).padStart(3, '0')}`,
      defect_name: `${i + 1}층 복도 소화기 압력계 불량`,
      photo_url: opts.noPhoto ? null : b, after_photo_url: opts.noPhoto ? null : a,
    })
  }
  if (opts.broken) {
    bucket.set('insp/bad/zero.jpg', new Uint8Array(0))
    bucket.set('insp/bad/corrupt.jpg', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
    await putJpeg('insp/half/before.jpg', 1000, 750)
    rows.push(
      { defect_code: 'X-1', defect_name: '0바이트', photo_url: 'insp/bad/zero.jpg', after_photo_url: null },
      { defect_code: 'X-2', defect_name: '손상', photo_url: 'insp/bad/corrupt.jpg', after_photo_url: null },
      { defect_code: 'X-3', defect_name: '없는경로', photo_url: 'insp/bad/missing.jpg', after_photo_url: null },
      { defect_code: 'X-4', defect_name: '사진없음', photo_url: null, after_photo_url: null },
      { defect_code: 'X-5', defect_name: '공사전만', photo_url: 'insp/half/before.jpg', after_photo_url: null },
    )
  }
  return rows
}
const albumOf = async (rows: AlbumDefectRow[]) => prepareAlbumPhotos(store, albumItemsFromDefects(rows))
const appendAlbum = async (rows: AlbumDefectRow[]) => {
  const album = await albumOf(rows)
  const built = await buildPhotoAlbumSheet(album, HEADING, base)
  if (!built) return null
  const ins = await insertSheetAfter(base, await lastSheetName(base), built.part)
  return { album, built, ins }
}

const N = 7
const defects = await makeDefects(N)
const run = await appendAlbum(defects)
if (!run) { console.log('❌ 빌더가 null — 이하 전부 무의미'); process.exit(1) }
const { built, ins } = run

const outZip = await JSZip.loadAsync(ins.bytes)
const baseZip = await JSZip.loadAsync(base)
const text = async (z: JSZip, p: string) => z.file(p)!.async('string')
const sheetXml = await text(outZip, 'xl/worksheets/sheetPhoto.xml')
const wbBefore = await text(baseZip, 'xl/workbook.xml')
const wbAfter = await text(outZip, 'xl/workbook.xml')
const ctAfter = await text(outZip, '[Content_Types].xml')
const drawingPath = Object.keys(outZip.files).find(n => /^xl\/drawings\/drawing\d+\.xml$/.test(n) && !baseZip.file(n))!
const drawXml = await text(outZip, drawingPath)
// ⚠ 디렉터리 항목(`xl/media/`)은 zip.file()이 null을 주므로 '새 파트'로 오인된다 — dir 제외
const mediaNew = Object.keys(outZip.files)
  .filter(n => n.startsWith('xl/media/') && !outZip.files[n].dir && !baseZip.file(n))
const anchors = [...drawXml.matchAll(/<xdr:oneCellAnchor>[\s\S]*?<\/xdr:oneCellAnchor>/g)].map(m => m[0])
const ROWS = 1 + 3 * N

console.log(`\n[0] 하한 — 0이면 이하가 전부 공허 통과한다`)
check(`불량 ${N}건`, run.album.items.length === N)
check(`임베드 사진 == ${N * 2}`, built.photoCount === N * 2, `${built.photoCount}`)
check(`media 파트 == ${N * 2}`, mediaNew.length === N * 2, `${mediaNew.length}`)
check(`oneCellAnchor == ${N * 2}`, anchors.length === N * 2, `${anchors.length}`)
check(`행 == ${ROWS}(머리 1 + 3행×${N}건)`, [...sheetXml.matchAll(/<row /g)].length === ROWS)
if (fail > 0) { console.log('\n하한 실패 — 중단'); process.exit(1) }

console.log('\n[1] zip 파트 정합')
check('워크시트 Override', ctAfter.includes('PartName="/xl/worksheets/sheetPhoto.xml"'))
check('그림 Override', ctAfter.includes(`PartName="/${drawingPath}"`))
check('jpeg Default 중복 0', [...ctAfter.matchAll(/Extension="jpeg"/g)].length === 1)
{
  const sRels = await text(outZip, 'xl/worksheets/_rels/sheetPhoto.xml.rels')
  check('시트 rels → 그림', sRels.includes(`../drawings/${drawingPath.split('/').pop()}`))
  const dRels = await text(outZip, `xl/drawings/_rels/${drawingPath.split('/').pop()}.rels`)
  const targets = [...dRels.matchAll(/Target="\.\.\/media\/([^"]+)"/g)].map(m => `xl/media/${m[1]}`)
  check('그림 rels 대상 전수 실재', targets.every(t => !!outZip.file(t)), `${targets.length}`)
  check('media 고아 0', mediaNew.every(m => targets.includes(m)))
  const wbRels = await text(outZip, 'xl/_rels/workbook.xml.rels')
  const rid = new RegExp(`<sheet name="${PHOTO_SHEET_NAME}"[^>]*r:id="(rId\\d+)"`).exec(wbAfter)![1]
  check('workbook.rels에 새 시트 관계', wbRels.includes(`Id="${rid}"`) && wbRels.includes('worksheets/sheetPhoto.xml'))
}

console.log('\n[2] 시트 목록 — 맨 끝')
{
  const namesOf = (xml: string) => [...xml.matchAll(/<sheet\s[^>]*\/>/g)].map(m => /name="([^"]*)"/.exec(m[0])![1])
  const before = namesOf(wbBefore), after = namesOf(wbAfter)
  check('시트 수 +1', after.length === before.length + 1, `${before.length}→${after.length}`)
  check(`마지막 시트 = ${PHOTO_SHEET_NAME}`, after[after.length - 1] === PHOTO_SHEET_NAME, after.slice(-2).join('→'))
  check('나머지 이름·순서 불변', after.slice(0, -1).join('|') === before.join('|'))
  check('lastSheetName = 삽입 전 끝 시트', (await lastSheetName(base)) === before[before.length - 1])
  const ids = [...wbAfter.matchAll(/sheetId="(\d+)"/g)].map(m => m[1])
  check('sheetId 중복 없음', new Set(ids).size === ids.length)
}

console.log('\n[3] sharedStrings 무오염 — 제목이 여기 들어가면 전 문서 t="s"가 밀린다')
check('sharedStrings sha256 동일',
  sha(await baseZip.file('xl/sharedStrings.xml')!.async('uint8array'))
  === sha(await outZip.file('xl/sharedStrings.xml')!.async('uint8array')))

console.log('\n[4] localSheetId — 꼬리 삽입이라 재번호 0이 정상')
{
  const b = localNameMap(wbBefore), a = localNameMap(wbAfter)
  check('재번호 0건(끝에 붙였다)', ins.renumbered === 0, `${ins.renumbered}`)
  const pa = (rows: typeof b) => rows.filter(r => r.name === '_xlnm.Print_Area')
  check('Print_Area 표본이 0이 아니다(공허 방지)', pa(b).length > 0, `${pa(b).length}건`)
  check('자기검증(후): sheets[lsi] == ref 시트명',
    pa(a).every(r => r.sheet === r.refSheet),
    pa(a).filter(r => r.sheet !== r.refSheet).map(r => `${r.sheet}≠${r.refSheet}`).join(', '))
  const aExisting = a.filter(r => r.refSheet !== PHOTO_SHEET_NAME)
  check('기존 definedName 소속 시트 전수 불변',
    aExisting.length === b.length && aExisting.every((r, i) => r.sheet === b[i].sheet), `${b.length}`)
  check('새 시트 Print_Area 실재', a.some(r => r.refSheet === PHOTO_SHEET_NAME && r.lsi === ins.index))
}

console.log('\n[5] 페이지 나눔 — 1쪽 머리 + 3건, 이후 3건씩')
{
  const brks = [...sheetXml.matchAll(/<brk id="(\d+)"/g)].map(m => Number(m[1]))
  // 7건: 1~3건(행 2~10) | 4~6건(11~19) | 7건(20~22) → 끊는 자리 10, 19
  check('7건 → brk [10,19]', brks.join(',') === '10,19', brks.join(','))
  check('꼬리 brk 없음(빈 페이지 방지)', !brks.includes(ROWS))
  const cnt = /<rowBreaks count="(\d+)" manualBreakCount="(\d+)"/.exec(sheetXml)
  check('rowBreaks count == 실개수', !!cnt && Number(cnt[1]) === brks.length && Number(cnt[2]) === brks.length)
}

console.log('\n[6] 앵커 정합')
{
  const ids = [...drawXml.matchAll(/<xdr:cNvPr id="(\d+)"/g)].map(m => m[1])
  check('cNvPr id 유일', new Set(ids).size === ids.length && !ids.includes('0'))
  const embeds = [...drawXml.matchAll(/r:embed="(rId\d+)"/g)].map(m => m[1])
  check('r:embed 유일', new Set(embeds).size === embeds.length)
  check('xdr:ext == a:ext', anchors.every(a => {
    const x = /<xdr:ext cx="(\d+)" cy="(\d+)"\/>/.exec(a)!, y = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(a)!
    return x[1] === y[1] && x[2] === y[2]
  }))
  check('to 요소 없음(oneCellAnchor 스키마)', !drawXml.includes('<xdr:to>'))
}

console.log('\n[7] 종횡비 — 왜곡 0의 유일한 기계 축')
{
  const dRels = await text(outZip, `xl/drawings/_rels/${drawingPath.split('/').pop()}.rels`)
  const relTarget = new Map([...dRels.matchAll(/Id="(rId\d+)"[^>]*Target="\.\.\/media\/([^"]+)"/g)]
    .map(m => [m[1], `xl/media/${m[2]}`] as const))
  let worst = 0
  for (const a of anchors) {
    const rid = /r:embed="(rId\d+)"/.exec(a)![1]
    const ext = /<xdr:ext cx="(\d+)" cy="(\d+)"\/>/.exec(a)!
    const meta = await sharp(await outZip.file(relTarget.get(rid)!)!.async('nodebuffer')).metadata()
    worst = Math.max(worst, Math.abs(Number(ext[1]) / Number(ext[2]) - meta.width! / meta.height!))
  }
  check('|cx/cy − w/h| < 0.01 전수', worst < 0.01, worst.toFixed(5))
}

console.log('\n[8] 앵커 좌표 — 공사 전 A열 · 공사 후 B열, 같은 사진 행')
{
  const cols = [...drawXml.matchAll(/<xdr:col>(\d+)<\/xdr:col>/g)].map(m => Number(m[1]))
  const rows = [...drawXml.matchAll(/<xdr:row>(\d+)<\/xdr:row>/g)].map(m => Number(m[1]))
  // 0-기준 사진 행 = 1-기준 제목 행(2 + 3i) → 사진 행 3 + 3i의 0-기준 = 2 + 3i
  const wantRows = Array.from({ length: N }, (_, i) => [2 + 3 * i, 2 + 3 * i]).flat()
  check('열 = 0,1 반복(좌우)', cols.join(',') === Array.from({ length: N }, () => '0,1').join(','), cols.join(','))
  check('행 = 건마다 같은 사진 행', rows.join(',') === wantRows.join(','), rows.join(','))
}

console.log('\n[9] 요소 순서 — CT_Worksheet 시퀀스(Excel 전용 파손 축)')
{
  const seq = ['<sheetPr', '<dimension', '<sheetViews', '<sheetFormatPr', '<cols', '<sheetData',
    '<mergeCells', '<printOptions', '<pageMargins', '<pageSetup', '<rowBreaks', '<drawing ']
  const at = seq.map(t => sheetXml.indexOf(t))
  check('전 요소 실재', at.every(i => i >= 0), at.join(','))
  check('순서 오름차순', at.every((v, i) => i === 0 || v > at[i - 1]))
}

console.log('\n[10] 무손상 — 기존 파트가 바이트 그대로인가')
{
  const allow = new Set(['[Content_Types].xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml'])
  const changed: string[] = []
  for (const name of Object.keys(baseZip.files)) {
    if (baseZip.files[name].dir) continue
    const after = outZip.file(name)
    if (!after) { changed.push(`${name}(소실)`); continue }
    if (allow.has(name)) continue
    if (sha(await baseZip.file(name)!.async('uint8array')) !== sha(await after.async('uint8array'))) changed.push(name)
  }
  check('허용 4파트 외 변경 0', changed.length === 0, changed.slice(0, 5).join(', '))
}

console.log('\n[11] 스타일 — 끝에 덧붙였는가(기존 인덱스 무손상)')
{
  const sBefore = await text(baseZip, 'xl/styles.xml'), sAfter = await text(outZip, 'xl/styles.xml')
  const blockOf = (xml: string, tag: string) => new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml)!
  for (const [tag, el, add] of [['fonts', 'font', 3], ['borders', 'border', 2], ['cellXfs', 'xf', 4]] as const) {
    const b = blockOf(sBefore, tag), a = blockOf(sAfter, tag)
    const count = (s: string) => [...s.matchAll(new RegExp(`<${el}\\b[^>]*(?:/>|>[\\s\\S]*?</${el}>)`, 'g'))].length
    const nb = count(b[1]), na = count(a[1]), attr = Number(/count="(\d+)"/.exec(a[0])![1])
    check(`${tag}: ${nb}+${add} == ${na} == count 속성`, na === nb + add && attr === na, `count=${attr}`)
    check(`${tag}: 기존 원소 앞부분 그대로`, a[1].startsWith(b[1]))
  }
}

console.log('\n[12] 셀 내용')
{
  const merges = [...sheetXml.matchAll(/<mergeCell ref="([^"]+)"/g)].map(m => m[1])
  check(`병합 ${1 + N}칸(머리 + 건 제목 A:B)`, merges.length === 1 + N && merges[0] === 'A1:B1' && merges[1] === 'A2:B2', merges.join(','))
  check('mergeCells count == 실개수', Number(/<mergeCells count="(\d+)"/.exec(sheetXml)![1]) === merges.length)
  check('머리 문구', sheetXml.includes(HEADING))
  check('건 제목 「n. 불량명」 전수', defects.every((d, i) => sheetXml.includes(`${i + 1}. ${d.defect_name}`)))
  check('라벨 「공사 전」·「공사 후」 × N', [...sheetXml.matchAll(/>공사 전</g)].length === N && [...sheetXml.matchAll(/>공사 후</g)].length === N)
  const rows = [...sheetXml.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)]
  check('행마다 셀 2개(A·B)', rows.every(r => [...r[1].matchAll(/<c /g)].length === 2))
  check(`사진 행 210pt × ${N}`, [...sheetXml.matchAll(/ht="210"/g)].length === N)
  // 1쪽(머리 30 + 3건 × (제목 22 + 사진 210 + 라벨 18))이 A4 가용 높이를 넘지 않는가 — 상수를 키우면 여기서 먼저 붉어진다
  const page1 = 30 + 3 * (22 + 210 + 18)
  check(`1쪽 높이 ${page1}pt ≤ A4 가용 791.5pt`, page1 <= 791.5, `${page1}pt`)
  check(`인쇄영역 A1:B${ROWS}`, built.part.printArea === `$A$1:$B$${ROWS}`, built.part.printArea)
}

console.log('\n[13] 존재 — 불량이 있으면 사진 0장이어도 나간다 · 사유 고지')
{
  const r2 = await appendAlbum(await makeDefects(3, { broken: true }))
  if (!r2) check('사유 시나리오 빌드', false, 'null 반환')
  else {
    const note = r2.album.notes.join(' | ')
    check('0바이트 사유', note.includes('0바이트'), note)
    check('디코드실패 사유', note.includes('디코드실패'))
    check('다운로드실패 사유', note.includes('다운로드실패'))
    check('임베드 == 정상 3건×2 + 공사 전만 1장', r2.built.photoCount === 7, `${r2.built.photoCount}`)
    const x2 = await text(await JSZip.loadAsync(r2.ins.bytes), 'xl/worksheets/sheetPhoto.xml')
    // 종전과 반대 — 사진이 다 깨진 건·사진 없는 건도 **싣는다**(불량은 불량이다). 3 + 5 = 8건
    check('사진 실패·없음 건도 싣는다 → 8건 25행', [...x2.matchAll(/<row /g)].length === 25, `${[...x2.matchAll(/<row /g)].length}`)
    check('빈 칸은 「사진 없음」', x2.includes('사진 없음'))
    check('사진 없는 건 제목 실재', x2.includes('사진없음') && x2.includes('없는경로'))
  }
  const zero = await appendAlbum(await makeDefects(2, { noPhoto: true }))
  check('사진 0장 2건 → 시트 생성', !!zero && zero.built.photoCount === 0)
  if (zero) {
    const zx = await JSZip.loadAsync(zero.ins.bytes)
    const zs = await text(zx, 'xl/worksheets/sheetPhoto.xml')
    check('사진 0장 → drawing 요소·시트 rels 없음(빈 그림 파트 금지)',
      !zs.includes('<drawing ') && !zx.file('xl/worksheets/_rels/sheetPhoto.xml.rels'))
    check('사진 0장 → 「사진 없음」 4칸', [...zs.matchAll(/사진 없음/g)].length === 4)
  }
  check('불량 0건 → null(그때만 빠진다)', (await buildPhotoAlbumSheet(await albumOf([]), HEADING, base)) === null)
}

console.log('\n[13b] 제목 — 불량명 · code == name이면 항목명 → 코드')
{
  check('이름 ≠ 코드 → 이름만(본보기처럼 번호 없이)', albumTitleOf({ defect_code: '15-B-006', defect_name: '주경종 불량' }) === '주경종 불량')
  check('이름 == 코드 → 점검표 항목명', albumTitleOf({ defect_code: '1-A-001', defect_name: '1-A-001' }, '소화기 압력 적정') === '소화기 압력 적정')
  check('이름 == 코드 · 항목명 없음 → 코드', albumTitleOf({ defect_code: '1-A-001', defect_name: '1-A-001' }) === '1-A-001')
  check('이름 공백뿐 → 코드', albumTitleOf({ defect_code: '15-B-006', defect_name: '   ' }) === '15-B-006')
  check('둘 다 없음 → 「(불량명 없음)」', albumTitleOf({ defect_code: null, defect_name: null }) === '(불량명 없음)')
  const items = albumItemsFromDefects([
    { defect_code: 'A', defect_name: 'a', photo_url: 'http://x/storage/v1/object/public/inspection-defects/p/1.jpg', after_photo_url: '' },
  ])
  check('번호 1부터 · 구형 공개 URL은 사진으로 · 빈 문자열은 없음', items[0].no === 1 && !!items[0].before && items[0].after === null)
}

console.log('\n[15] PDF 렌더 — 표지 + 3건/쪽, 빈 칸은 「사진 없음」')
{
  const html = renderPhotoAlbum({
    buildingName: '검증빌딩',
    company: { name: '검증소방', phone: '031-000-0000', fax: '', email: 'a@b.c', logoSrc: null },
    items: Array.from({ length: 7 }, (_, i) => ({ no: i + 1, title: `불량 <${i + 1}>`, beforeSrc: i === 0 ? 'album1-before.jpg' : null, afterSrc: null })),
  })
  check('쪽 = 표지 1 + ceil(7/3)=3', [...html.matchAll(/<div class="page">/g)].length === 4)
  check('제목 이스케이프', html.includes('1. 불량 &lt;1&gt;') && !html.includes('불량 <1>'))
  check('사진 src(자산 파일명)', html.includes('src="album1-before.jpg"'))
  check('빈 칸 「사진 없음」 13칸', [...html.matchAll(/사진 없음/g)].length === 13)
  check('표지 상호·[건물명]', html.includes('검증소방') && html.includes('검증빌딩'))
  check('팩스 없으면 연락처에서 생략', !html.includes('F : '))
}

console.log('\n[16] 한글파일(HWPX) — 구조(한글 실기 열람은 사람 몫, 2024 뷰어로 1회 확인)')
{
  const album = await albumOf(await makeDefects(4, { broken: false }))
  const bytes = await renderPhotoAlbumHwpx(new Uint8Array(readFileSync(HWPX_TPL)), {
    buildingName: '검증 & 빌딩', company: { name: '검증소방', phone: '031', fax: '', email: '' }, album,
  })
  const z = await JSZip.loadAsync(bytes)
  const raw = Object.keys(z.files)
  check('첫 항목 mimetype', raw[0] === 'mimetype')
  check('mimetype = application/hwp+zip', (await z.file('mimetype')!.async('string')) === 'application/hwp+zip')
  const sec = await text(z, 'Contents/section0.xml'), hpf = await text(z, 'Contents/content.hpf')
  const refs = [...sec.matchAll(/binaryItemIDRef="([^"]+)"/g)].map(m => m[1])
  const items = new Map([...hpf.matchAll(/<opf:item id="([^"]+)" href="([^"]+)"/g)].map(m => [m[1], m[2]] as const))
  check('그림 = 4건 × 2', refs.length === 8, `${refs.length}`)
  check('그림 참조 전수가 매니페스트·BinData에 실재', refs.every(r => items.has(r) && !!z.file(items.get(r)!)))
  check('구역 정의(secPr) 정확히 1', [...sec.matchAll(/<hp:secPr\b/g)].length === 1)
  check('쪽 나눔 = ceil(4/3) = 2', [...sec.matchAll(/pageBreak="1"/g)].length === 2)
  check('본문 이스케이프(& → &amp;)', sec.includes('검증 &amp; 빌딩') && !sec.includes('검증 & 빌딩'))
  check('그림 id 유일', (() => { const ids = [...sec.matchAll(/<hp:pic id="(\d+)"/g)].map(m => m[1]); return new Set(ids).size === ids.length })())
  check('header.xml 원본 그대로', sha(await z.file('Contents/header.xml')!.async('uint8array'))
    === sha(await (await JSZip.loadAsync(readFileSync(HWPX_TPL))).file('Contents/header.xml')!.async('uint8array')))
  // XML 잘 짜였는가 — 태그 짝 근사(열림 == 닫힘)
  const opens = [...sec.matchAll(/<hp:(p|run|pic)\b[^>]*[^/]>/g)].length
  const closes = [...sec.matchAll(/<\/hp:(p|run|pic)>/g)].length
  check('hp:p·run·pic 열림 == 닫힘', opens === closes, `${opens}/${closes}`)
}

// ── [14] LibreOffice 페이지 수 **차분** (옵션) ────────────────────────────────
if (process.argv.includes('--lo')) {
  console.log('\n[14] LibreOffice 페이지 차분')
  const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
  const dir = mkdtempSync(join(tmpdir(), 'photosheet-'))
  const conv = (xlsx: string) => execFileSync(SOFFICE, ['-env:UserInstallation=file:///' + dir.replace(/\\/g, '/') + '/lo',
    '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, xlsx], { timeout: 600_000 })
  const pagesIn = (pdf: string) => [...readFileSync(pdf).toString('latin1').matchAll(/\/Type\s*\/Page[^s]/g)].length
  const baseXlsx = join(dir, 'base.xlsx'); writeFileSync(baseXlsx, base); conv(baseXlsx)
  const basePages = pagesIn(join(dir, 'base.pdf'))
  const sheetPages = async (n: number) => {
    const r = (await appendAlbum(await makeDefects(n)))!
    const xlsx = join(dir, `n${n}.xlsx`); writeFileSync(xlsx, r.ins.bytes); conv(xlsx)
    return pagesIn(join(dir, `n${n}.pdf`)) - basePages
  }
  const s3 = await sheetPages(3), s4 = await sheetPages(4), s7 = await sheetPages(7)
  console.log(`  기준선 ${basePages}쪽 · 사진첩 3건=${s3} 4건=${s4} 7건=${s7}`)
  check('3건 = 1쪽', s3 === 1, `${s3}쪽`)
  check('4건 = 2쪽', s4 === 2, `${s4}쪽`)
  check('7건 = 3쪽', s7 === 3, `${s7}쪽`)
} else {
  console.log('\n[14] LibreOffice 페이지 차분 — 생략(--lo 로 실행)')
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
