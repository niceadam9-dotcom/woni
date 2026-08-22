/** 갑지 + 설비별 점검표 동봉 템플릿 빌드 (소방계획서_27 Phase 5 / S10-1 — 전처리 1회, 재실행 가능)
 *  실행: npx tsx scripts/build-workbook-full.mts     (로컬 LibreOffice 필요)
 *  산출: templates/report-workbook-full.xlsx + src/lib/xlsx-donor-manifest.json
 *
 *  기증 원본은 전체 보고서.xls(43시트) — **원천 고객의 작성 완료본**이라 결과 마크(○·／·X)
 *  약 700칸을 전수 스크럽한다(시트당 1곳뿐인 세로 3연속 ○→/→X 범례만 보존 — 실측
 *  _probe-donor-scrub). 갑지 26시트 파트는 바이트 그대로 두고(스타일·목록 3파트만 증분),
 *  기증 시트는 스타일 병합·재번호 + 공유문자열 인라인 전개로 이식한다(_probe-sheet-transplant
 *  [2]가 '성립'을, 이 스크립트가 '서식 생존'을 맡는 분업).
 *
 *  갑지 템플릿(report-workbook.xlsx)이 재빌드되면 이것도 재실행해야 한다 — manifest의
 *  baseSha256이 어긋나면 test-xlsx-donors가 먼저 붉어진다. */
import JSZip from 'jszip'
import XLSX from 'xlsx'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { sheetFileMap } from '../src/lib/xlsx-inject.ts'
import { validateAnchors, SCRUB_NEEDLES } from '../src/lib/xlsx-anchors.ts'
import { DONOR_GROUPS, DONOR_TOC_SHEET, allDonorSheets } from '../src/lib/xlsx-donors.ts'

const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
const DONOR_SRC = 'F:/AI/ERP/erp/전체 보고서.xls'
const BASE = 'templates/report-workbook.xlsx'
const OUT = 'templates/report-workbook-full.xlsx'
const MANIFEST = 'src/lib/xlsx-donor-manifest.json'
const MARK = /^[○×X\/／]$/

const dir = mkdtempSync(join(tmpdir(), 'wbfull-'))
console.log(`임시: ${dir}`)

// ── ① 기증 .xls → .xlsx (LibreOffice — SheetJS 변환은 서식 전멸) ─────
console.log('① 기증 워크북 변환')
execFileSync(SOFFICE, ['--headless', '--norestore', '--convert-to', 'xlsx', '--outdir', dir, DONOR_SRC],
  { timeout: 300_000, windowsHide: true, stdio: 'pipe' })
const donorConv = join(dir, '전체 보고서.xlsx')
if (!existsSync(donorConv)) throw new Error('LibreOffice 변환 실패')
const donorOrig = XLSX.read(readFileSync(DONOR_SRC), { cellStyles: true })
const donorZip = await JSZip.loadAsync(readFileSync(donorConv))
const donorFiles = await sheetFileMap(donorZip)
const donorNames = allDonorSheets()
for (const n of donorNames) if (!donorFiles.has(n)) throw new Error(`기증 시트 부재: ${n}`)

// ── ①b 목차 원문 대조 — 상수(tocLabel)가 원본과 어긋나면 실패 ────────
{
  const toc = donorOrig.Sheets[DONOR_TOC_SHEET]
  const rows = new Set(Object.keys(toc).filter(k => !k.startsWith('!'))
    .map(k => String((toc[k] as XLSX.CellObject).v ?? '').trim()))
  const bad = DONOR_GROUPS.filter(g => g.verifyToc && !rows.has(g.tocLabel))
  if (bad.length) throw new Error(`목차 상수 불일치: ${bad.map(b => b.tocLabel).join(' | ')}`)
  console.log(`   목차 상수 ${DONOR_GROUPS.filter(g => g.verifyToc).length}건 원문 일치`)
}

// ── ② 스타일 병합 — 기증 컬렉션 전량을 갑지 styles.xml 뒤에 증설 ─────
console.log('② 스타일 병합·재번호')
const baseBytes = new Uint8Array(readFileSync(BASE))
const outZip = await JSZip.loadAsync(baseBytes)
let styles = await outZip.file('xl/styles.xml')!.async('string')
const donStyles = await donorZip.file('xl/styles.xml')!.async('string')

const blockOf = (xml: string, tag: string): { whole: string; count: number; inner: string } | null => {
  const m = new RegExp(`<${tag} count="(\\d+)"[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml)
  return m ? { whole: m[0], count: Number(m[1]), inner: m[2] } : null
}
const tgt = Object.fromEntries(['numFmts', 'fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs']
  .map(t => [t, blockOf(styles, t)]))
const don = Object.fromEntries(['numFmts', 'fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs']
  .map(t => [t, blockOf(donStyles, t)]))
for (const t of ['fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs'])
  if (!tgt[t] || !don[t]) throw new Error(`styles 블록 부재: ${t}`)

// numFmtId 재번호 — 커스텀(≥164)만. 갑지의 커스텀 최대 id 다음부터 부여
const numFmtMap = new Map<number, number>()
{
  const tgtIds = [...(tgt.numFmts?.inner ?? '').matchAll(/numFmtId="(\d+)"/g)].map(m => Number(m[1]))
  let next = Math.max(163, ...tgtIds) + 1
  const donEntries = [...(don.numFmts?.inner ?? '').matchAll(/<numFmt [^>]*\/>/g)].map(m => m[0])
  const appended: string[] = []
  for (const e of donEntries) {
    const id = Number(/numFmtId="(\d+)"/.exec(e)![1])
    if (id < 164) continue
    numFmtMap.set(id, next)
    appended.push(e.replace(`numFmtId="${id}"`, `numFmtId="${next}"`))
    next++
  }
  if (appended.length) {
    if (tgt.numFmts) {
      styles = styles.replace(tgt.numFmts.whole,
        `<numFmts count="${tgt.numFmts.count + appended.length}">${tgt.numFmts.inner}${appended.join('')}</numFmts>`)
    } else {
      // 갑지에 numFmts 블록이 없으면 fonts 앞에 신설
      styles = styles.replace(/<fonts /, `<numFmts count="${appended.length}">${appended.join('')}</numFmts><fonts `)
    }
  }
  console.log(`   numFmt 커스텀 ${appended.length}건 재번호`)
}

const fontOff = tgt.fonts!.count, fillOff = tgt.fills!.count, borderOff = tgt.borders!.count
const styleXfOff = tgt.cellStyleXfs!.count, cellXfOff = tgt.cellXfs!.count
const remapEntry = (e: string, withXfId: boolean): string => e
  .replace(/numFmtId="(\d+)"/g, (_m, id: string) => `numFmtId="${numFmtMap.get(Number(id)) ?? id}"`)
  .replace(/fontId="(\d+)"/g, (_m, id: string) => `fontId="${Number(id) + fontOff}"`)
  .replace(/fillId="(\d+)"/g, (_m, id: string) => `fillId="${Number(id) + fillOff}"`)
  .replace(/borderId="(\d+)"/g, (_m, id: string) => `borderId="${Number(id) + borderOff}"`)
  .replace(/xfId="(\d+)"/g, (_m, id: string) => withXfId ? `xfId="${Number(id) + styleXfOff}"` : `xfId="${id}"`)

// ⚠ 자기닫힘(<xf/>)을 [^>]*>로 받으면 '/'까지 삼켜 다음 엔트리의 닫힘까지 먹는다(폐포 프로브에서
//   실측한 부류와 같은 축) — 여는 태그의 끝(/> 여부)을 먼저 판정하고 닫힘은 인덱스로 찾는다
const entriesOf = (inner: string, tag: string): string[] => {
  const out: string[] = []
  const re = new RegExp(`<${tag}\\b[^>]*?(/?)>`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(inner))) {
    if (m[1] === '/') { out.push(m[0]); continue }
    const close = inner.indexOf(`</${tag}>`, re.lastIndex)
    if (close < 0) throw new Error(`${tag} 닫힘 없음`)
    out.push(inner.slice(m.index, close + tag.length + 3))
    re.lastIndex = close + tag.length + 3
  }
  return out
}
{
  const append = (tag: 'fonts' | 'fills' | 'borders' | 'cellStyleXfs' | 'cellXfs', entryTag: string, withXfId: boolean) => {
    const t = tgt[tag]!, d = don[tag]!
    const entries = entriesOf(d.inner, entryTag)
    if (entries.length !== d.count) throw new Error(`${tag} 파싱 ${entries.length} ≠ count ${d.count}`)
    const mapped = entries.map(e => remapEntry(e, withXfId)).join('')
    styles = styles.replace(t.whole,
      `${t.whole.slice(0, t.whole.indexOf('>') + 1).replace(`count="${t.count}"`, `count="${t.count + entries.length}"`)}${t.inner}${mapped}</${tag}>`)
  }
  append('fonts', 'font', false)
  append('fills', 'fill', false)
  append('borders', 'border', false)
  append('cellStyleXfs', 'xf', false)
  append('cellXfs', 'xf', true)
  outZip.file('xl/styles.xml', styles)
  console.log(`   fonts +${don.fonts!.count} · fills +${don.fills!.count} · borders +${don.borders!.count} · cellStyleXfs +${don.cellStyleXfs!.count} · cellXfs +${don.cellXfs!.count}`)
}

// ── ③ 공유문자열 준비(인라인 전개용) ─────────────────────────────────
const sstTexts: string[] = []
{
  const sstFile = donorZip.file('xl/sharedStrings.xml')
  if (sstFile) {
    const sstXml = await sstFile.async('string')
    for (const m of sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g))
      sstTexts.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''))
  }
}
const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const unescXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

// ── ④ 기증 시트 이식 — 스크럽·s재번호·여백복원·인라인 전개 ───────────
console.log('④ 기증 시트 이식')
let wbXml = await outZip.file('xl/workbook.xml')!.async('string')
let relsXml = await outZip.file('xl/_rels/workbook.xml.rels')!.async('string')
let ctXml = await outZip.file('[Content_Types].xml')!.async('string')
let maxRid = Math.max(...[...relsXml.matchAll(/Id="rId(\d+)"/g)].map(m => Number(m[1])))
let maxSheetId = Math.max(...[...wbXml.matchAll(/sheetId="(\d+)"/g)].map(m => Number(m[1])))
let scrubTotal = 0
const legendBySheet = new Map<string, string[]>()

for (const name of donorNames) {
  let xml = await donorZip.file(donorFiles.get(name)!)!.async('string')

  // 공유문자열 → 인라인 전개(자기닫힘 없음 — t="s"는 항상 <v> 보유)
  xml = xml.replace(/<c([^>]*?) t="s"([^>]*)><v>(\d+)<\/v><\/c>/g, (_m, a: string, b: string, idx: string) =>
    `<c${a}${b} t="inlineStr"><is><t xml:space="preserve">${escXml(sstTexts[Number(idx)] ?? '')}</t></is></c>`)
  if (/ t="s"/.test(xml)) throw new Error(`${name}: t="s" 잔존 — 인라인 전개 실패`)

  // 셀 스타일 인덱스 재번호(cellXfs 증설 오프셋) — <c>·<row>의 s=, <col>의 style=
  xml = xml.replace(/(<(?:c|row)\b[^>]*?)\ss="(\d+)"/g, (_m, head: string, s: string) => `${head} s="${Number(s) + cellXfOff}"`)
  xml = xml.replace(/(<col\b[^>]*?)\sstyle="(\d+)"/g, (_m, head: string, s: string) => `${head} style="${Number(s) + cellXfOff}"`)

  // 인쇄여백 복원(원본 .xls 실측값 — LO가 header/footer를 1.3cm로 정규화)
  const mg = donorOrig.Sheets[name]?.['!margins'] as Record<string, number> | undefined
  if (!mg) throw new Error(`${name}: 원본 여백 없음`)
  if (!/<pageMargins[^>]*\/>/.test(xml)) throw new Error(`${name}: pageMargins 태그 부재`)
  xml = xml.replace(/<pageMargins[^>]*\/>/,
    `<pageMargins left="${mg.left}" right="${mg.right}" top="${mg.top}" bottom="${mg.bottom}" header="${mg.header}" footer="${mg.footer}"/>`)

  // 활성 탭 흔적 제거(기증 워크북의 선택 상태가 따라오지 않게)
  xml = xml.replace(/\stabSelected="1"/g, '')

  // 결과 마크 스크럽 — 원본 값 기준으로 대상 좌표를 정하고(보는 층), XML을 지운다(고치는 층).
  // 범례(세로 ○→/→X 3연속, 시트당 ≤1곳)는 보존한다 — 양식의 일부다.
  if (name !== DONOR_TOC_SHEET) {
    const ws = donorOrig.Sheets[name]
    const val = (c: number, r: number) =>
      String((ws[XLSX.utils.encode_cell({ c, r })] as XLSX.CellObject | undefined)?.v ?? '').trim()
    const protectedCells = new Set<string>()
    for (const k of Object.keys(ws).filter(k => !k.startsWith('!'))) {
      const { c, r } = XLSX.utils.decode_cell(k)
      if (val(c, r) === '○' && val(c, r + 1) === '/' && val(c, r + 2) === 'X') {
        for (const dr of [0, 1, 2]) protectedCells.add(XLSX.utils.encode_cell({ c, r: r + dr }))
      }
    }
    if (protectedCells.size > 3) throw new Error(`${name}: 범례 후보 복수(${protectedCells.size / 3}곳) — 규칙 재검토`)
    legendBySheet.set(name, [...protectedCells])
    for (const k of Object.keys(ws).filter(k => !k.startsWith('!'))) {
      const v = String((ws[k] as XLSX.CellObject).v ?? '').trim()
      if (!MARK.test(v) || protectedCells.has(k)) continue
      const re = new RegExp(`<c r="${k}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`)
      const m = re.exec(xml)
      if (!m) throw new Error(`${name}!${k}: 스크럽 대상 셀이 XML에 없다`)
      const attrs = (m[1] ?? '').replace(/\st="[^"]*"/, '')
      xml = xml.replace(re, `<c r="${k}"${attrs}/>`)
      scrubTotal++
    }
  }

  // 파트 추가 + 목록 3곳 등록
  const part = `xl/worksheets/sheetD${++maxSheetId}.xml`
  const rid = `rId${++maxRid}`
  outZip.file(part, xml)
  relsXml = relsXml.replace('</Relationships>',
    `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${part.split('/').pop()}"/></Relationships>`)
  wbXml = wbXml.replace('</sheets>', `<sheet name="${escXml(name)}" sheetId="${maxSheetId}" r:id="${rid}"/></sheets>`)
  ctXml = ctXml.replace('</Types>',
    `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`)
}
outZip.file('xl/workbook.xml', wbXml)
outZip.file('xl/_rels/workbook.xml.rels', relsXml)
outZip.file('[Content_Types].xml', ctXml)
console.log(`   ${donorNames.length}시트 이식 · 결과 마크 ${scrubTotal}칸 스크럽 · 범례 ${[...legendBySheet.values()].filter(v => v.length).length}곳 보존`)

let bytes = new Uint8Array(await outZip.generateAsync({ type: 'uint8array' }))

// ── ⑤ 사후 검증 ──────────────────────────────────────────────────────
console.log('⑤ 사후 검증')
{
  const fails: string[] = []
  const wb = XLSX.read(bytes, { cellStyles: true })
  const baseWb = XLSX.read(baseBytes, { cellStyles: true })
  const expected = baseWb.SheetNames.length + donorNames.length
  if (wb.SheetNames.length !== expected) fails.push(`시트 수 ${wb.SheetNames.length} ≠ ${expected}`)

  // 기증 시트 병합·마크 검증 — 병합은 원본과 동수, 마크는 범례만 잔존
  for (const n of donorNames) {
    const om = (donorOrig.Sheets[n]['!merges'] ?? []).length
    const nm = (wb.Sheets[n]?.['!merges'] ?? []).length
    if (om !== nm) fails.push(`${n} 병합 ${om} → ${nm}`)
    if (n === DONOR_TOC_SHEET) continue
    const marks = Object.keys(wb.Sheets[n] ?? {}).filter(k => !k.startsWith('!'))
      .filter(k => MARK.test(String((wb.Sheets[n][k] as XLSX.CellObject).v ?? '').trim()))
    const legend = new Set(legendBySheet.get(n) ?? [])
    const strays = marks.filter(k => !legend.has(k))
    if (strays.length) fails.push(`${n} 마크 잔존: ${strays.join(',')}`)
    if (legend.size && marks.length !== legend.size) fails.push(`${n} 범례 훼손: ${marks.length}/${legend.size}`)
  }

  // 갑지 파트 바이트 불변(스타일·목록 3파트 제외) — 손대지 않은 것은 그대로여야 한다
  {
    const baseZip = await JSZip.loadAsync(baseBytes)
    const outZ = await JSZip.loadAsync(bytes)
    const touchable = new Set(['xl/styles.xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', '[Content_Types].xml'])
    for (const name of Object.keys(baseZip.files)) {
      if (baseZip.files[name].dir || touchable.has(name)) continue
      const a = await baseZip.file(name)!.async('uint8array')
      const b = outZ.file(name) ? await outZ.file(name)!.async('uint8array') : null
      if (!b || a.length !== b.length || !a.every((v, i) => v === b[i])) fails.push(`갑지 파트 변형: ${name}`)
    }
  }

  // 앵커 전수 생존(치유 0) + 니들 원시 바이트 0
  const check = validateAnchors(bytes)
  if (!check.ok) fails.push(`앵커: ${check.failures.join(' | ')}`)
  else if (check.healed.length) fails.push(`앵커 치유 발생(좌표 밀림): ${check.healed.join(' | ')}`)
  {
    const outZ = await JSZip.loadAsync(bytes)
    for (const name of Object.keys(outZ.files)) {
      if (outZ.files[name].dir) continue
      const raw = unescXml(await outZ.file(name)!.async('string'))
      for (const n of SCRUB_NEEDLES) if (raw.includes(n)) fails.push(`니들 잔존: ${name} ⊃ '${n}'`)
    }
  }
  if (fails.length) {
    for (const f of fails) console.error(`   ❌ ${f}`)
    process.exit(1)
  }
  console.log(`   시트 ${wb.SheetNames.length} · 갑지 파트 불변 · 마크=범례만 · 앵커 전수 생존`)
}

// ── ⑥ LibreOffice 렌더 확인(페이지 수 기록) ──────────────────────────
console.log('⑥ LibreOffice 렌더')
let pdfPages = 0
{
  const tmpXlsx = join(dir, 'full.xlsx')
  writeFileSync(tmpXlsx, bytes)
  execFileSync(SOFFICE, ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, tmpXlsx],
    { timeout: 600_000, windowsHide: true, stdio: 'pipe' })
  const pdf = join(dir, 'full.pdf')
  if (!existsSync(pdf)) throw new Error('PDF 변환 실패 — 워크북이 열리지 않는다')
  pdfPages = (readFileSync(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
  console.log(`   PDF ${pdfPages}쪽 (갑지 단독 27쪽 + 기증 ${donorNames.length}시트)`)
}

// ── 산출 ─────────────────────────────────────────────────────────────
writeFileSync(OUT, bytes)
const manifest = {
  source: '전체 보고서.xls',
  builtAt: new Date().toISOString().slice(0, 10),
  sha256: createHash('sha256').update(bytes).digest('hex'),
  baseSha256: createHash('sha256').update(baseBytes).digest('hex'),
  sheetCount: XLSX.read(bytes).SheetNames.length,
  donorSheetCount: donorNames.length,
  pdfPages,
  note: '갑지 템플릿(report-workbook.xlsx) 재빌드 시 build-workbook-full.mts도 재실행(baseSha256 짝) — 어긋나면 test-xlsx-donors가 먼저 붉어진다',
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
console.log(`\n✅ ${OUT} (${(bytes.length / 1024).toFixed(0)}KB) · ${MANIFEST}`)
console.log(`   sha256 ${manifest.sha256.slice(0, 16)}… · 시트 ${manifest.sheetCount} · PDF ${pdfPages}쪽`)
