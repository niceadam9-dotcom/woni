/** 소방계획서_27 Phase 0 실측 게이트 — S0-1~S0-5 (2026-08-21)
 *  실행: npx tsx scripts/_probe-xlsx-gate.mts     (서버 불필요 · 로컬 LibreOffice 필요)
 *
 *  왜 한 파일인가: 다섯 검사가 한 줄기다(.xls→.xlsx 변환 → 서식 생존 확인 → 셀 패치 →
 *  재계산 → 앵커 실재). 각각을 따로 돌리면 앞 단계 산출물을 매번 다시 만들어야 한다.
 *
 *  이 게이트가 통과해야 27 Phase 1에 착수한다. S0-3(JSZip 패치)이 실패하면 exceljs 폴백으로
 *  전환하고 그 근거를 남긴다. 읽기 전용 — 저장소 파일을 고치지 않는다(TEMP에서만 작업). */
import XLSX from 'xlsx'
import JSZip from 'jszip'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
const SRC = 'F:/AI/ERP/erp/보고서 갑지.xls'
const HUB = '개요'
const SENTINEL = 'ZZ테스트상호ZZ'          // 스포크 전파를 눈으로 구분하기 위한 표지값
const HUB_CELL = 'B14'                      // 개요!B14 = 상호 (스포크 6곳이 참조)
const SPOKES: Array<[string, string]> = [['공문', 'B8'], ['보고서', 'C4'], ['정보', 'B4']]

const dir = mkdtempSync(join(tmpdir(), 'x27-'))
let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

/** soffice로 변환. 산출 경로를 돌려준다(실패면 null).
 *  ⚠ outDir을 반드시 원본과 다르게 줄 것 — 같은 경로로 xlsx→xlsx를 시키면 soffice가
 *  자기 원본을 덮어쓰지 못해 `impl_store failed 0x4c0c`로 죽는다(2026-08-21 실측). */
function convert(src: string, to: 'pdf' | 'xlsx', outDir = dir): string | null {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  try {
    execFileSync(SOFFICE, ['--headless', '--norestore', '--convert-to', to, '--outdir', outDir, src],
      { timeout: 300_000, windowsHide: true, stdio: 'pipe' })
  } catch (e: any) {
    console.log(`     soffice 오류: ${((e.stderr || e.stdout || '').toString().trim() || e.message).split('\n')[0]}`)
    return null
  }
  const out = join(outDir, basename(src).replace(/\.[^.]+$/, `.${to}`))
  return existsSync(out) ? out : null
}

/** 인쇄여백 복원 — LibreOffice가 header/footer를 1.3cm(0.5118in)로 정규화한다(실측).
 *  법정 서식은 인쇄물이 곧 결과라 여백이 바뀌면 쪽 나눔이 흔들릴 수 있어 원본 값으로 되돌린다.
 *  값 셀은 건드리지 않고 <pageMargins/> 태그만 바꾼다. */
async function restoreMargins(zip: JSZip, origin: XLSX.WorkBook, files: Map<string, string>) {
  let done = 0
  for (const [sheet, path] of files) {
    const m = origin.Sheets[sheet]?.['!margins'] as Record<string, number> | undefined
    const f = zip.file(path)
    if (!m || !f) continue
    const xml = await f.async('string')
    const tag = `<pageMargins left="${m.left}" right="${m.right}" top="${m.top}" bottom="${m.bottom}"` +
      ` header="${m.header}" footer="${m.footer}"/>`
    if (!/<pageMargins[^>]*\/>/.test(xml)) continue
    zip.file(path, xml.replace(/<pageMargins[^>]*\/>/, tag))
    done++
  }
  return done
}

const mergeCount = (wb: XLSX.WorkBook) =>
  wb.SheetNames.reduce((n, s) => n + ((wb.Sheets[s]['!merges'] ?? []).length), 0)

// ── S0-1. .xls → .xlsx 변환 (LibreOffice) ─────────────────────────────
console.log('\n[S0-1] 템플릿 자산화 — soffice로 .xls → .xlsx')
const origWb = XLSX.read(readFileSync(SRC), { cellStyles: true })
const origMerges = mergeCount(origWb)
const origMargins = JSON.stringify(origWb.Sheets[HUB]['!margins'] ?? null)
console.log(`     원본: 시트 ${origWb.SheetNames.length} · 병합 ${origMerges}`)

const xlsxPath = convert(SRC, 'xlsx')
check('변환 산출물 생성', !!xlsxPath)
if (!xlsxPath) { console.log(`\n결과: ${pass} 통과 / ${fail} 실패 — 변환 실패로 중단`); process.exit(1) }

const convWb = XLSX.read(readFileSync(xlsxPath), { cellStyles: true })
const convMerges = mergeCount(convWb)
check('시트 수 유지', convWb.SheetNames.length === origWb.SheetNames.length,
  `${origWb.SheetNames.length} → ${convWb.SheetNames.length}`)
check('병합셀 유지', convMerges === origMerges, `${origMerges} → ${convMerges}`)
const convMargins = JSON.stringify(convWb.Sheets[HUB]?.['!margins'] ?? null)
if (convMargins !== origMargins) {
  console.log(`     ⚠ 인쇄여백 정규화됨 — ${origMargins}`)
  console.log(`                        → ${convMargins}  (header/footer를 1.3cm로 바꾼다)`)
}

// ── S0-2. 서식이 실제로 살아 있는가 (zip 내부 실측) ───────────────────
console.log('\n[S0-2] 서식 생존 — xl/styles.xml 실측')
const zip0 = await JSZip.loadAsync(readFileSync(xlsxPath))
const styles = await zip0.file('xl/styles.xml')!.async('string')
const countOf = (tag: string) => Number(new RegExp(`<${tag} count="(\\d+)"`).exec(styles)?.[1] ?? 0)
const borders = countOf('borders'), fonts = countOf('fonts'), fills = countOf('fills')
check('borders > 1 (테두리 살아 있음)', borders > 1, `borders=${borders}`)
check('fonts > 1 (글꼴 살아 있음)', fonts > 1, `fonts=${fonts}`)
console.log(`     fills=${fills} · cellXfs=${countOf('cellXfs')}`)
const names = zip0.file('xl/workbook.xml') ? await zip0.file('xl/workbook.xml')!.async('string') : ''
console.log(`     definedNames=${(names.match(/<definedName /g) ?? []).length} · ` +
  `drawing 파트=${Object.keys(zip0.files).filter(f => f.includes('drawing')).length} · ` +
  `media=${Object.keys(zip0.files).filter(f => f.startsWith('xl/media/')).length}`)

// ── 시트 이름 → sheetN.xml 매핑 (rels 경유) ───────────────────────────
const wbXml = await zip0.file('xl/workbook.xml')!.async('string')
const relsXml = await zip0.file('xl/_rels/workbook.xml.rels')!.async('string')
const relTarget = new Map<string, string>()
for (const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relTarget.set(m[1], m[2])
const sheetFile = new Map<string, string>()
for (const m of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  const t = relTarget.get(m[2]) ?? ''
  sheetFile.set(m[1], t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`)
}
console.log(`     시트→파일 매핑 ${sheetFile.size}건 (예: ${HUB} → ${sheetFile.get(HUB)})`)

// ── S0-1b. 인쇄여백 복원 → 이후 단계는 복원본을 템플릿으로 쓴다 ────────
console.log('\n[S0-1b] 인쇄여백 복원 — 변환이 바꾼 header/footer를 원본 값으로')
const zipT = await JSZip.loadAsync(readFileSync(xlsxPath))
const restored = await restoreMargins(zipT, origWb, sheetFile)
const tplPath = join(dir, 'template.xlsx')
writeFileSync(tplPath, await zipT.generateAsync({ type: 'nodebuffer' }))
const tplWb = XLSX.read(readFileSync(tplPath), { cellStyles: true })
check('전 시트 여백 복원', restored === sheetFile.size, `${restored}/${sheetFile.size} 시트`)
check('개요 인쇄여백 원본과 일치',
  JSON.stringify(tplWb.Sheets[HUB]?.['!margins'] ?? null) === origMargins,
  JSON.stringify(tplWb.Sheets[HUB]?.['!margins'] ?? null))
check('복원본 병합셀 불변', mergeCount(tplWb) === origMerges, `${mergeCount(tplWb)}`)

// ── S0-5. 앵커 실재 — **실제로 주입할 좌표**가 XML에 있는가 ────────────
// ⚠ 종전 검사는 반증 불가였다: 'SheetJS가 값을 읽은 셀 ⊆ 같은 파일의 <c r>'인데 SheetJS는
//   바로 그 <c r>에서 값을 뽑으므로 어떤 입력에도 부재 0이었다(2026-08-23 F세대 판정 §1-④).
//   게이트란 '통과 못 하면 착수 금지'인데 **절대 붉어지지 않는 칸**이 통과 수를 부풀렸다.
//   실질 축으로 교체한다: 주입 대상(앵커의 값 칸 + 라벨 칸)과 완전 덮어쓰기 대상(HUB_INPUT_CELLS)이
//   ① 새 변환본 ② 커밋된 배포 자산 **양쪽 모두**에 실재하는가. 서식이 갱신돼 칸이 사라지면
//   여기가 먼저 붉어진다(=Q-4 재실측 신호). 없는 셀에는 삽입하지 않으므로 실재가 전제다.
console.log('\n[S0-5] 앵커 실재 — 주입 좌표가 실제로 있는가(새 변환본 + 커밋 자산)')
{
  const { ANCHORS, HUB_INPUT_CELLS } = await import('../src/lib/xlsx-anchors.ts')
  /** 시트별 요구 좌표 — 앵커는 값 칸과 라벨 칸 둘 다 필요하다(라벨 검증이 주입의 전제) */
  const want = new Map<string, Set<string>>()
  const add = (sheet: string, cell: string) => {
    const s = want.get(sheet) ?? new Set<string>()
    s.add(cell); want.set(sheet, s)
  }
  for (const a of ANCHORS) { add(a.sheet, a.cell); add(a.sheet, a.labelCell) }
  for (const c of HUB_INPUT_CELLS) add(HUB, c)
  const total = [...want.values()].reduce((n, s) => n + s.size, 0)

  const absentIn = async (zip: JSZip, files: Map<string, string>) => {
    const out: string[] = []
    for (const [sheet, cells] of want) {
      const path = files.get(sheet)
      if (!path || !zip.file(path)) { out.push(`${sheet}!(시트없음)`); continue }
      const xml = await zip.file(path)!.async('string')
      const present = new Set([...xml.matchAll(/<c r="([A-Z]+\d+)"/g)].map(m => m[1]))
      for (const c of cells) if (!present.has(c)) out.push(`${sheet}!${c}`)
    }
    return out
  }

  const a1 = await absentIn(zip0, sheetFile)
  check(`새 변환본 — 요구 좌표 ${total}개 전부 실재`, a1.length === 0,
    a1.length ? `부재 ${a1.length}: ${a1.slice(0, 8).join(',')}` : `시트 ${want.size}개`)

  // 커밋 자산 축 — 라우트가 실제로 읽는 파일이다(빌드가 좌표를 지웠는지 여기서만 드러난다)
  const assetPath = 'templates/report-workbook-full.xlsx'
  if (existsSync(assetPath)) {
    const az = await JSZip.loadAsync(readFileSync(assetPath))
    const awb = await az.file('xl/workbook.xml')!.async('string')
    const arels = await az.file('xl/_rels/workbook.xml.rels')!.async('string')
    const arel = new Map([...arels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
    const afiles = new Map<string, string>()
    for (const m of awb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
      const t = arel.get(m[2]) ?? ''
      afiles.set(m[1], t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`)
    }
    const a2 = await absentIn(az, afiles)
    check(`커밋 자산 — 요구 좌표 ${total}개 전부 실재`, a2.length === 0,
      a2.length ? `부재 ${a2.length}: ${a2.slice(0, 8).join(',')}` : basename(assetPath))
  } else {
    check('커밋 자산 존재', false, `${assetPath} 없음`)
  }

  // 반증 가능성 자기검사 — **판정기 자체(absentIn)를** 태운다.
  // ⚠ 종전 카나리아는 정규식을 인라인으로 복제해 별도로 검사했다. 그러면 absentIn이 고장 나도
  //   카나리아는 초록이라 **검사의 민감도를 증명하지 못한다**(2026-08-24 독립 판정 지적).
  //   같은 함수에 '있을 수 없는 좌표'를 먹여, 실제로 부재로 잡히는지 본다
  const canaryWant = new Map(want)
  canaryWant.set(HUB, new Set([...(want.get(HUB) ?? []), 'ZZ9999']))
  const savedWant = new Map(want)
  want.clear(); for (const [k, v] of canaryWant) want.set(k, v)
  const canary = await absentIn(zip0, sheetFile)
  want.clear(); for (const [k, v] of savedWant) want.set(k, v)
  check('자기검사 — 같은 판정기(absentIn)가 없는 좌표(ZZ9999)를 부재로 잡는다',
    canary.length === 1 && canary[0] === `${HUB}!ZZ9999`, canary.join(', ') || '(부재 0 — 판정기가 눈이 멀었다)')
}

// ── S0-3. JSZip 셀 패치 → 열리는가 + 서식 유지되는가 ──────────────────
console.log('\n[S0-3] JSZip 바이트 패치 — 개요!B14 교체')
const basePdf = convert(tplPath, 'pdf')
const pageCount = (p: string) => (readFileSync(p).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
check('템플릿 PDF 변환', !!basePdf, basePdf ? `${pageCount(basePdf)}쪽 · ${(readFileSync(basePdf).length / 1024).toFixed(0)}KB` : '')

/** 셀의 값을 인라인 문자열로 교체. <f>가 있으면 지운다(formula-replace) */
function patchCell(xml: string, ref: string, value: string): { xml: string; hit: boolean } {
  const re = new RegExp(`(<c r="${ref}"[^>]*?)(/>|>[\\s\\S]*?</c>)`)
  const m = re.exec(xml)
  if (!m) return { xml, hit: false }
  const attrs = m[1].replace(/\st="[^"]*"/, '')          // 기존 타입 제거 후 inlineStr로
  const repl = `${attrs} t="inlineStr"><is><t>${value}</t></is></c>`
  return { xml: xml.replace(re, repl), hit: true }
}

const zip1 = await JSZip.loadAsync(readFileSync(tplPath))
const hubPath = sheetFile.get(HUB)!
const patched = patchCell(await zip1.file(hubPath)!.async('string'), HUB_CELL, SENTINEL)
check(`개요!${HUB_CELL} 셀을 XML에서 찾음`, patched.hit)
zip1.file(hubPath, patched.xml)
const patchedPath = join(dir, 'patched.xlsx')
writeFileSync(patchedPath, await zip1.generateAsync({ type: 'nodebuffer' }))

const patchedWb = XLSX.read(readFileSync(patchedPath), { cellStyles: true })
check('패치본 병합셀 불변', mergeCount(patchedWb) === convMerges, `${convMerges} → ${mergeCount(patchedWb)}`)
const zip1r = await JSZip.loadAsync(readFileSync(patchedPath))
check('패치본 styles.xml 바이트 동일',
  (await zip1r.file('xl/styles.xml')!.async('string')) === styles)
check('패치값 반영', patchedWb.Sheets[HUB][HUB_CELL]?.v === SENTINEL,
  String(patchedWb.Sheets[HUB][HUB_CELL]?.v ?? '(없음)'))
const patchedPdf = convert(patchedPath, 'pdf')
check('패치본 PDF 변환', !!patchedPdf,
  patchedPdf && basePdf ? `${pageCount(patchedPdf)}쪽 (템플릿 ${pageCount(basePdf)}쪽)` : '')
if (patchedPdf && basePdf) check('페이지 수 동일', pageCount(patchedPdf) === pageCount(basePdf))

// ── S0-4. fullCalcOnLoad — 스포크 전파 + #REF! 표면화 ─────────────────
console.log('\n[S0-4] 재계산 — fullCalcOnLoad 부여 후 스포크 전파')
const zip2 = await JSZip.loadAsync(readFileSync(patchedPath))
let wb2 = await zip2.file('xl/workbook.xml')!.async('string')
wb2 = wb2.includes('<calcPr')
  ? wb2.replace(/<calcPr([^>]*)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>')
  : wb2.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>')
check('calcPr fullCalcOnLoad 부여', wb2.includes('fullCalcOnLoad="1"'))
zip2.file('xl/workbook.xml', wb2)
const calcPath = join(dir, 'calc.xlsx')
writeFileSync(calcPath, await zip2.generateAsync({ type: 'nodebuffer' }))

// LibreOffice가 열면서 재계산한 결과를 xlsx로 다시 받아 값 확인 (PDF 텍스트 추출보다 결정적)
const recalcPath = convert(calcPath, 'xlsx', join(dir, 'recalc'))   // ⚠ 반드시 다른 폴더로
check('재계산본 생성', !!recalcPath)
if (recalcPath) {
  const rc = XLSX.read(readFileSync(recalcPath), { cellStyles: true })
  // ⚠ 기대값은 '전파되지 않음'이다. 이 프로브의 목적은 fullCalcOnLoad에 기대도 되는지를 **가리는** 것이고,
  //    실측 결과 LibreOffice는 이 플래그를 무시하고 옛 <v>를 그대로 들고 있었다. 그래서 S0-4b가 정답이 됐다.
  //    (뒤집혀서 붉어지면 그것도 정보다 — 뷰어가 재계산해 준다는 뜻이니 설계를 다시 볼 것)
  const propagated = SPOKES.filter(([s, c]) => String(rc.Sheets[s]?.[c]?.v ?? '').includes(SENTINEL))
  for (const [sheet, cell] of SPOKES) {
    console.log(`     ${sheet}!${cell} = ${JSON.stringify(rc.Sheets[sheet]?.[cell]?.v ?? null)}`)
  }
  check('LibreOffice는 fullCalcOnLoad를 무시한다(기대=전파 안 됨)', propagated.length === 0,
    propagated.length ? `${propagated.length}건이 전파됨 — 설계 재검토` : '옛 캐시값 유지 확인')
  const refs: string[] = []
  for (const s of rc.SheetNames) {
    const ws = rc.Sheets[s]
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      const c = ws[k]
      if (c.t === 'e' || String(c.v ?? '').includes('#REF!')) refs.push(`${s}!${k}=${c.v}`)
    }
  }
  console.log(`\n     ⚠ 재계산으로 드러난 오류 셀 ${refs.length}건${refs.length ? ':' : ''}`)
  for (const r of refs.slice(0, 40)) console.log(`       ${r}`)
  if (refs.length > 40) console.log(`       … 외 ${refs.length - 40}건`)
}

// ── S0-4b. 캐시값 동시 주입 — 뷰어의 재계산에 기대지 않는다 ────────────
// LibreOffice는 fullCalcOnLoad를 무시하고 옛 <v>를 그대로 보여준다(위에서 실측).
// 뷰어가 재계산해 주기를 바라는 대신, 허브를 참조하는 셀의 **캐시값 <v>도 함께 갱신**한다.
// <f>는 남긴다 — 사용자가 Excel에서 허브를 고치면 그때부터는 수식이 살아 움직인다.
console.log('\n[S0-4b] 캐시값 동시 주입 — 스포크 <v>를 함께 갱신(수식은 보존)')
const srcWb = XLSX.read(readFileSync(tplPath), { cellFormula: true })
/** 단일 셀 직접 참조 수식의 의존 그래프. **1단계로는 부족하다** —
 *  `완료보고서!B5 = '계획서'!B5`처럼 스포크가 스포크를 참조하는 2차 사슬이 있어서,
 *  허브 직접 참조만 갱신하면 옛 값이 그대로 남는다(2026-08-21 실측: '정내과의원' 4회 잔존). */
const edges = new Map<string, Array<{ sheet: string; cell: string }>>()
for (const s of srcWb.SheetNames) {
  const ws = srcWb.Sheets[s]
  for (const k of Object.keys(ws)) {
    if (k.startsWith('!')) continue
    const f = String(ws[k].f ?? '')
    if (!f) continue
    // 간선은 두 종류다 — 시트 넘김(`'개요'!B14`)과 **같은 시트 안**(`A3`).
    // 후자를 빼면 `계약서!D24 = A3` 같은 사슬이 끊겨 옛 값이 그대로 남는다(2026-08-21 실측).
    const x = /^'?([^'!]+)'?!(\$?[A-Z]+\$?\d+)$/.exec(f)
    const local = /^(\$?[A-Z]+\$?\d+)$/.exec(f)
    if (!x && !local) continue
    const from = x ? `${x[1]}!${x[2].replace(/\$/g, '')}` : `${s}!${local![1].replace(/\$/g, '')}`
    const arr = edges.get(from) ?? []
    arr.push({ sheet: s, cell: k })
    edges.set(from, arr)
  }
}
/** 이행 폐포 — 허브 한 칸이 바뀌면 따라 바뀌어야 할 셀 전부 */
const dependents: Array<{ sheet: string; cell: string }> = []
const seen = new Set<string>()
const queue = [`${HUB}!${HUB_CELL}`]
while (queue.length) {
  for (const d of edges.get(queue.shift()!) ?? []) {
    const key = `${d.sheet}!${d.cell}`
    if (seen.has(key)) continue
    seen.add(key); dependents.push(d); queue.push(key)
  }
}
console.log(`     직접 참조 간선 ${[...edges.values()].reduce((n, a) => n + a.length, 0)}건 · ` +
  `${HUB}!${HUB_CELL}의 **이행 폐포** ${dependents.length}건`)
console.log(`     ${dependents.map(d => `${d.sheet}!${d.cell}`).join(', ')}`)

/** 수식은 남기고 캐시값 <v>만 교체 */
function patchCachedValue(xml: string, ref: string, value: string): { xml: string; hit: boolean } {
  const re = new RegExp(`<c r="${ref}"([^>]*)>([\\s\\S]*?)</c>`)
  const m = re.exec(xml)
  if (!m) return { xml, hit: false }
  const attrs = m[1].replace(/\st="[^"]*"/, '') + ' t="str"'   // 수식 결과 문자열
  const f = /<f[^>]*>[\s\S]*?<\/f>|<f[^>]*\/>/.exec(m[2])?.[0] ?? ''
  return { xml: xml.replace(re, `<c r="${ref}"${attrs}>${f}<v>${value}</v></c>`), hit: true }
}

const zip3 = await JSZip.loadAsync(readFileSync(tplPath))
const hp = patchCell(await zip3.file(hubPath)!.async('string'), HUB_CELL, SENTINEL)
zip3.file(hubPath, hp.xml)
let propagated = 0
for (const d of dependents) {
  const p = sheetFile.get(d.sheet)
  if (!p) continue
  const r = patchCachedValue(await zip3.file(p)!.async('string'), d.cell, SENTINEL)
  if (r.hit) { zip3.file(p, r.xml); propagated++ }
}
check('의존 셀 캐시값 갱신', propagated === dependents.length, `${propagated}/${dependents.length}`)
const cachedPath = join(dir, 'cached.xlsx')
writeFileSync(cachedPath, await zip3.generateAsync({ type: 'nodebuffer' }))

// 뷰어가 실제로 무엇을 보여주는가 — soffice로 html 변환해 본문에서 찾는다
const htmlPath = convert(cachedPath, 'html' as 'pdf', join(dir, 'html'))
if (htmlPath) {
  const body = readFileSync(htmlPath, 'utf8')
  check('LibreOffice 렌더 결과에 주입값 존재', body.includes(SENTINEL),
    `${(body.match(new RegExp(SENTINEL, 'g')) ?? []).length}회 등장`)
  check('옛 캐시값(정내과의원) 잔존 없음', !body.includes('정내과의원'),
    body.includes('정내과의원') ? `${(body.match(/정내과의원/g) ?? []).length}회 잔존 — 다른 경로로도 새어나온다` : '')
} else check('cached.xlsx html 변환', false)
const cachedPdf = convert(cachedPath, 'pdf', join(dir, 'cachedpdf'))
if (cachedPdf && basePdf) check('캐시 주입본 페이지 수 동일', pageCount(cachedPdf) === pageCount(basePdf),
  `${pageCount(cachedPdf)} vs ${pageCount(basePdf)}`)

console.log(`\n임시 산출물: ${dir}`)
console.log(`파일: ${readdirSync(dir).join(' · ')}`)
console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
