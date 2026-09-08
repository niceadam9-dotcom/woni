/** 갑지 「불량사진」 시트 검증 (소방계획서_46 — 무서버)
 *  실행: npx tsx --conditions=react-server scripts/test-photo-sheet.mts   (+ --lo 로 LibreOffice 축)
 *
 *  DB·네트워크에 기대지 않는다 — sharp로 합성한 픽스처를 스텁 Storage가 돌려준다.
 *
 *  ⚠ **하한을 먼저 단언한다**([0]). 임베드 사진이 0이면 이하의 '고아 0'·'왜곡 0' 류가 전부
 *  공허하게 통과한다 — 초록 화면이 아무것도 지키지 않는 상태가 이 검사의 최대 실패 양식이다.
 *
 *  기계로만 잡히는 축 셋(육안·LibreOffice로는 안 잡힌다):
 *   · 요소 순서 [9] — 어기면 LO는 멀쩡히 열고 **Excel만** 복구 대화상자를 띄운다
 *   · 종횡비 [7]   — 눈으로는 "좀 눌렸나?"로 넘어간다. media 실치수 대 EMU 비로만 확정된다
 *   · localSheetId [4] — 틀리면 **남의 인쇄영역**이 적용된다. 파일은 정상 개봉된다 */
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import JSZip from 'jszip'
import sharp from 'sharp'
import { buildDefectPhotoSheet, type DefectPhotoRow, type PhotoStorage } from '../src/lib/defect-photo-embed.ts'
import { insertSheetAfter, localNameMap } from '../src/lib/xlsx-sheet-surgery.ts'
import { DEFECT_SHEET } from '../src/lib/xlsx-anchors.ts'

const FULL = 'templates/report-workbook-full.xlsx'
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')

const base = new Uint8Array(readFileSync(FULL))

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
  return { w, h }
}
/** 원본 치수(회전 후 축소 전) — 종횡비 대조의 기준 */
const srcDim = new Map<string, { w: number; h: number }>()

async function makeDefects(n: number, opts: { broken?: boolean } = {}): Promise<DefectPhotoRow[]> {
  const rows: DefectPhotoRow[] = []
  for (let i = 0; i < n; i++) {
    const b = `insp/def${i}/before.jpg`, a = `insp/def${i}/after.jpg`
    // 가로·세로·정사각을 돌아가며 — 상자 맞춤이 한 방향에서만 옳은 것을 잡는다
    const dims: Array<[number, number]> = [[1200, 900], [900, 1200], [800, 800]]
    const [bw, bh] = dims[i % 3], [aw, ah] = dims[(i + 1) % 3]
    srcDim.set(b, await putJpeg(b, bw, bh))
    srcDim.set(a, await putJpeg(a, aw, ah))
    rows.push({
      defect_code: `3-A-${String(i + 1).padStart(3, '0')}`,
      defect_name: `소화기 압력계 불량 ${i + 1}`,
      defect_detail: `${i + 1}층 복도`,
      action_taken: '신품 교체',
      photo_url: b, after_photo_url: a,
    })
  }
  if (opts.broken) {
    bucket.set('insp/bad/zero.jpg', new Uint8Array(0))
    bucket.set('insp/bad/corrupt.jpg', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
    rows.push(
      { defect_code: 'X-1', defect_name: '0바이트', defect_detail: null, action_taken: null,
        photo_url: 'insp/bad/zero.jpg', after_photo_url: null },
      { defect_code: 'X-2', defect_name: '손상', defect_detail: null, action_taken: null,
        photo_url: 'insp/bad/corrupt.jpg', after_photo_url: null },
      { defect_code: 'X-3', defect_name: '없는경로', defect_detail: null, action_taken: null,
        photo_url: 'insp/bad/missing.jpg', after_photo_url: null },
      // 사진이 아예 없는 건은 시트에 실리지 않는다(빈 상자 인쇄 금지)
      { defect_code: 'X-4', defect_name: '사진없음', defect_detail: null, action_taken: null,
        photo_url: null, after_photo_url: null },
      // 한쪽만 있는 건 — 조치 전만 찍고 아직 조치 안 한 실제 상황. 「사진 없음」 상자가 뜻을 갖는 유일한 경우
      { defect_code: 'X-5', defect_name: '조치전만', defect_detail: '지하 1층', action_taken: null,
        photo_url: 'insp/half/before.jpg', after_photo_url: null },
    )
    srcDim.set('insp/half/before.jpg', await putJpeg('insp/half/before.jpg', 1000, 750))
  }
  return rows
}

const N = 6
const defects = await makeDefects(N)
const built = await buildDefectPhotoSheet(store, defects, base)
if (!built) { console.log('❌ 빌더가 null — 이하 전부 무의미'); process.exit(1) }
const ins = await insertSheetAfter(base, DEFECT_SHEET, built.part)

const outZip = await JSZip.loadAsync(ins.bytes)
const baseZip = await JSZip.loadAsync(base)
const text = async (z: JSZip, p: string) => z.file(p)!.async('string')
const sheetXml = await text(outZip, 'xl/worksheets/sheetPhoto.xml')
const wbBefore = await text(baseZip, 'xl/workbook.xml')
const wbAfter = await text(outZip, 'xl/workbook.xml')
const ctAfter = await text(outZip, '[Content_Types].xml')
const drawingPath = Object.keys(outZip.files).find(n => /^xl\/drawings\/drawing\d+\.xml$/.test(n)
  && !baseZip.file(n))!
const drawXml = await text(outZip, drawingPath)
// ⚠ 디렉터리 항목(`xl/media/`)은 zip.file()이 null을 주므로 '새 파트'로 오인된다 — dir 제외
const mediaNew = Object.keys(outZip.files)
  .filter(n => n.startsWith('xl/media/') && !outZip.files[n].dir && !baseZip.file(n))
const anchors = [...drawXml.matchAll(/<xdr:oneCellAnchor>[\s\S]*?<\/xdr:oneCellAnchor>/g)].map(m => m[0])

console.log(`\n[0] 하한 — 0이면 이하가 전부 공허 통과한다`)
check('불량 블록 6건', N === 6)
check('임베드 사진 == 12', built.photoCount === 12, `${built.photoCount}`)
check('media 파트 == 12', mediaNew.length === 12, `${mediaNew.length}`)
check('oneCellAnchor == 12', anchors.length === 12, `${anchors.length}`)
check('행 == 18(3행×6건)', [...sheetXml.matchAll(/<row /g)].length === 18)
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
  const rid = /<sheet name="불량사진"[^>]*r:id="(rId\d+)"/.exec(wbAfter)![1]
  check('workbook.rels에 새 시트 관계', wbRels.includes(`Id="${rid}"`) && wbRels.includes('worksheets/sheetPhoto.xml'))
}

console.log('\n[2] 시트 목록')
{
  const namesOf = (xml: string) => [...xml.matchAll(/<sheet\s[^>]*\/>/g)].map(m => /name="([^"]*)"/.exec(m[0])![1])
  const before = namesOf(wbBefore), after = namesOf(wbAfter)
  check('시트 수 +1', after.length === before.length + 1, `${before.length}→${after.length}`)
  check(`[${before.indexOf(DEFECT_SHEET)}] = ${DEFECT_SHEET}`, after[before.indexOf(DEFECT_SHEET)] === DEFECT_SHEET)
  check('바로 뒤 = 불량사진', after[before.indexOf(DEFECT_SHEET) + 1] === '불량사진', `${ins.index}`)
  const rest = after.filter(n => n !== '불량사진')
  check('나머지 이름·순서 불변', rest.join('|') === before.join('|'))
  const ids = [...wbAfter.matchAll(/sheetId="(\d+)"/g)].map(m => m[1])
  check('sheetId 중복 없음', new Set(ids).size === ids.length)
}

console.log('\n[3] sharedStrings 무오염 — 캡션이 여기 들어가면 전 문서 t="s"가 밀린다')
check('sharedStrings sha256 동일',
  sha(await baseZip.file('xl/sharedStrings.xml')!.async('uint8array'))
  === sha(await outZip.file('xl/sharedStrings.xml')!.async('uint8array')))

console.log('\n[4] localSheetId 재번호')
{
  const b = localNameMap(wbBefore), a = localNameMap(wbAfter)
  const expect = b.filter(r => r.lsi >= ins.index).length
  check(`재번호 건수 == ${expect}`, ins.renumbered === expect, `${ins.renumbered}`)
  check('재번호 대상이 0이 아니다(가드 자체의 공허 방지)', expect > 0, `${expect}`)
  // ⚠ 자기검증은 Print_Area에만 건다 — 나머지 localSheetId는 죽은 외부 매크로 잔재라
  //   ref 앞이 시트명이 아니다(전체에 걸면 **원본에서도** 실패한다 — 첫 실행에서 확인)
  const pa = (rows: typeof b) => rows.filter(r => r.name === '_xlnm.Print_Area')
  check('Print_Area 표본이 0이 아니다(공허 방지)', pa(b).length > 0, `${pa(b).length}건`)
  check('자기검증(전): sheets[lsi] == ref 시트명', pa(b).every(r => r.sheet === r.refSheet))
  check('자기검증(후): sheets[lsi] == ref 시트명',
    pa(a).every(r => r.sheet === r.refSheet),
    pa(a).filter(r => r.sheet !== r.refSheet).map(r => `${r.sheet}≠${r.refSheet}`).join(', '))
  // 새 Print_Area 1건이 늘었으므로 기존 항목만 ord로 맞댄다
  const aExisting = a.filter(r => r.refSheet !== '불량사진')
  check('기존 definedName 소속 시트 전수 불변',
    aExisting.length === b.length && aExisting.every((r, i) => r.sheet === b[i].sheet), `${b.length}`)
  check('새 시트 Print_Area 실재', a.some(r => r.refSheet === '불량사진' && r.lsi === ins.index))
}

console.log('\n[5] 페이지 나눔')
{
  const brks = [...sheetXml.matchAll(/<brk id="(\d+)"/g)].map(m => Number(m[1]))
  // 3건/장 = 9행/장 → 6건(18행)이면 9행에서 한 번만 끊는다
  check('6건 → brk [9]', brks.join(',') === '9', brks.join(','))
  check('꼬리 brk 없음(빈 페이지 방지)', !brks.includes(18))
  const cnt = /<rowBreaks count="(\d+)" manualBreakCount="(\d+)"/.exec(sheetXml)
  check('rowBreaks count == 실개수', !!cnt && Number(cnt[1]) === brks.length && Number(cnt[2]) === brks.length)
}

console.log('\n[6] 앵커 정합')
{
  const ids = [...drawXml.matchAll(/<xdr:cNvPr id="(\d+)"/g)].map(m => m[1])
  check('cNvPr id 유일', new Set(ids).size === ids.length && !ids.includes('0'))
  const embeds = [...drawXml.matchAll(/r:embed="(rId\d+)"/g)].map(m => m[1])
  check('r:embed 유일', new Set(embeds).size === embeds.length)
  const extPairs = anchors.every(a => {
    const x = /<xdr:ext cx="(\d+)" cy="(\d+)"\/>/.exec(a)!
    const y = /<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(a)!
    return x[1] === y[1] && x[2] === y[2]
  })
  check('xdr:ext == a:ext', extPairs)
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
    const buf = await outZip.file(relTarget.get(rid)!)!.async('nodebuffer')
    const meta = await sharp(buf).metadata()
    worst = Math.max(worst, Math.abs(Number(ext[1]) / Number(ext[2]) - meta.width! / meta.height!))
  }
  check('|cx/cy − w/h| < 0.01 전수', worst < 0.01, worst.toFixed(5))
}

console.log('\n[8] 앵커 좌표')
{
  const cols = [...drawXml.matchAll(/<xdr:col>(\d+)<\/xdr:col>/g)].map(m => Number(m[1]))
  const rows = [...drawXml.matchAll(/<xdr:row>(\d+)<\/xdr:row>/g)].map(m => Number(m[1]))
  const want = Array.from({ length: N }, (_, i) => [3 * i + 1, 3 * i + 2]).flat()
  check('전부 B열(0-based 1)', cols.every(c => c === 1))
  check('행 집합 == {3i+1, 3i+2}', rows.join(',') === want.join(','), rows.join(','))
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
    const x = sha(await baseZip.file(name)!.async('uint8array'))
    const y = sha(await after.async('uint8array'))
    if (x !== y) changed.push(name)
  }
  check('허용 4파트 외 변경 0', changed.length === 0, changed.slice(0, 5).join(', '))
}

console.log('\n[11] 스타일 — 끝에 덧붙였는가(기존 인덱스 무손상)')
{
  const sBefore = await text(baseZip, 'xl/styles.xml')
  const sAfter = await text(outZip, 'xl/styles.xml')
  const blockOf = (xml: string, tag: string) =>
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml)!
  for (const [tag, el, add] of [['fonts', 'font', 2], ['borders', 'border', 1], ['cellXfs', 'xf', 3]] as const) {
    const b = blockOf(sBefore, tag), a = blockOf(sAfter, tag)
    const nb = [...b[1].matchAll(new RegExp(`<${el}\\b[^>]*(?:/>|>[\\s\\S]*?</${el}>)`, 'g'))].length
    const na = [...a[1].matchAll(new RegExp(`<${el}\\b[^>]*(?:/>|>[\\s\\S]*?</${el}>)`, 'g'))].length
    const attr = Number(/count="(\d+)"/.exec(a[0])![1])
    check(`${tag}: ${nb}+${add} == ${na} == count 속성`, na === nb + add && attr === na, `count=${attr}`)
    check(`${tag}: 기존 원소 앞부분 그대로`, a[1].startsWith(b[1]))
  }
}

console.log('\n[12] 셀 내용')
{
  const merges = [...sheetXml.matchAll(/<mergeCell ref="([^"]+)"/g)].map(m => m[1])
  check('병합 6칸(캡션 B:C)', merges.length === 6 && merges[0] === 'B1:C1', merges.join(','))
  const mc = /<mergeCells count="(\d+)"/.exec(sheetXml)!
  check('mergeCells count == 실개수', Number(mc[1]) === merges.length)
  check('캡션 텍스트 실재', defects.every(d => sheetXml.includes(`${d.defect_code} ${d.defect_name}`)))
  const rows = [...sheetXml.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)]
  check('행마다 셀 3개', rows.every(r => [...r[1].matchAll(/<c /g)].length === 3))
  // 3건/장으로 바뀌며 사진 117pt·캡션 20pt — 3건(캡션 20 + 사진 117×2 = 254pt)이 A4 791.5pt 안
  check('사진 행 높이 117pt × 12', [...sheetXml.matchAll(/ht="117"/g)].length === 12)
  check('캡션 행 높이 20pt × 6', [...sheetXml.matchAll(/ht="20"/g)].length === 6)
  // 한 장(3건)의 실제 높이가 A4 가용 높이를 넘지 않는가 — 상수를 키우면 여기서 먼저 붉어진다
  const perPage = 3 * (20 + 117 * 2)
  check('3건/장 높이 762pt ≤ A4 가용 791.5pt', perPage <= 791.5, `${perPage}pt`)
  check('인쇄영역 A1:C18', built.part.printArea === '$A$1:$C$18', built.part.printArea)
}

console.log('\n[13] 사유 고지 — 조용히 버리지 않는가')
{
  const rows2 = await makeDefects(3, { broken: true })
  const b2 = await buildDefectPhotoSheet(store, rows2, base)
  if (!b2) { check('사유 시나리오 빌드', false, 'null 반환'); }
  else {
    const note = b2.notes.join(' | ')
    check('0바이트 사유', note.includes('0바이트'), note)
    check('디코드실패 사유', note.includes('디코드실패'))
    check('다운로드실패 사유', note.includes('다운로드실패'))
    check('임베드 == 정상 3건×2 + 한쪽만 1장', b2.photoCount === 7, `${b2.photoCount}`)
    const x2 = await text(await JSZip.loadAsync((await insertSheetAfter(base, DEFECT_SHEET, b2.part)).bytes),
      'xl/worksheets/sheetPhoto.xml')
    check('사진 없는 슬롯은 「사진 없음」 문구', x2.includes('사진 없음'))
    // 전 슬롯 실패한 3건(X-1~X-3)은 빠지고, 한쪽만 있는 X-5는 남는다 → 4건 12행
    check('전멸한 건은 싣지 않는다 → 4건 12행', [...x2.matchAll(/<row /g)].length === 12,
      `${[...x2.matchAll(/<row /g)].length}`)
    check('4건 = brk [9]', [...x2.matchAll(/<brk id="(\d+)"/g)].map(m => m[1]).join(',') === '9')
    check('빈 상자 건이 캡션에도 없다', !x2.includes('0바이트') && !x2.includes('없는경로'))
    check('한쪽만 있는 건은 남는다(X-5)', x2.includes('조치전만'))
  }
  const none = await buildDefectPhotoSheet(store, [
    { defect_code: 'Z', defect_name: '무사진', defect_detail: null, action_taken: null, photo_url: null, after_photo_url: null },
  ], base)
  check('사진 0장이면 시트를 만들지 않는다(null)', none === null)
}

// ── [14] LibreOffice 페이지 수 **차분** (옵션) ────────────────────────────────
// 절대 페이지 수는 도너 구성에 따라 변하므로 차분으로만 판정한다.
if (process.argv.includes('--lo')) {
  console.log('\n[14] LibreOffice 페이지 차분')
  const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
  const dir = mkdtempSync(join(tmpdir(), 'photosheet-'))
  const pagesOf = async (n: number) => {
    const rows = await makeDefects(n)
    const b = (await buildDefectPhotoSheet(store, rows, base))!
    const bytes = (await insertSheetAfter(base, DEFECT_SHEET, b.part)).bytes
    const xlsx = join(dir, `n${n}.xlsx`)
    writeFileSync(xlsx, bytes)
    // ⚠ 프로필 격리 필수 — 남의 세션 soffice와 겹치면 ETIMEDOUT
    execFileSync(SOFFICE, ['-env:UserInstallation=file:///' + dir.replace(/\\/g, '/') + '/lo',
      '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, xlsx], { timeout: 600_000 })
    const pdf = readFileSync(join(dir, `n${n}.pdf`)).toString('latin1')
    return [...pdf.matchAll(/\/Type\s*\/Page[^s]/g)].length
  }
  // 기준선 = 사진 대지가 **없는** 워크북. 이걸 빼야 대지 자체의 쪽수가 나온다 —
  // 차분만 보면 "몇 건부터 2쪽인가"라는 요구를 직접 셀 수 없다(도너 구성이 절대값을 흔든다).
  const baseXlsx = join(dir, 'base.xlsx')
  writeFileSync(baseXlsx, base)
  execFileSync(SOFFICE, ['-env:UserInstallation=file:///' + dir.replace(/\\/g, '/') + '/lo',
    '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, baseXlsx], { timeout: 600_000 })
  const basePages = [...readFileSync(join(dir, 'base.pdf')).toString('latin1').matchAll(/\/Type\s*\/Page[^s]/g)].length
  const sheetPages = async (n: number) => (await pagesOf(n)) - basePages

  const s3 = await sheetPages(3), s4 = await sheetPages(4), s6 = await sheetPages(6)
  const s7 = await sheetPages(7), s9 = await sheetPages(9), s10 = await sheetPages(10)
  console.log(`  기준선 ${basePages}쪽 · 대지 3건=${s3} 4건=${s4} 6건=${s6} 7건=${s7} 9건=${s9} 10건=${s10}`)

  // ⚠ **3→4가 2건/장과 3건/장을 가르는 축이다.** 3건일 때 2건/장은 2쪽, 3건/장은 1쪽이다.
  //   5→6·6→7만 보면 둘 다 같은 모양이 나와 아무것도 구별하지 못한다(옛 검사가 그 함정에 있었다).
  check('3건 = 1쪽 ⇒ 3건/장(2건/장이면 2쪽)', s3 === 1, `${s3}쪽`)
  check('3건 → 4건: +1 (1쪽→2쪽)', s4 - s3 === 1, `${s3}→${s4}`)
  // 사용자 확정 규격(2026-09-08): 1~3건 1쪽 · 4~6건 2쪽 · 7~9건 3쪽 · 10~12건 4쪽
  check('4~6건 = 2쪽(6건에서 안 넘친다)', s4 === 2 && s6 === 2, `4건 ${s4} · 6건 ${s6}`)
  check('7~9건 = 3쪽', s7 === 3 && s9 === 3, `7건 ${s7} · 9건 ${s9}`)
  check('10건 = 4쪽(9→10에서 넘어간다)', s10 === 4, `${s9}→${s10}`)
} else {
  console.log('\n[14] LibreOffice 페이지 차분 — 생략(--lo 로 실행)')
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
