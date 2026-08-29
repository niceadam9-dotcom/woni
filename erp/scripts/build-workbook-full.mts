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
import { DONOR_GROUPS, DONOR_TOC_SHEET, DONOR_TOC_BODY_CELLS, allDonorSheets } from '../src/lib/xlsx-donors.ts'
import { extractDonorItemMap } from '../src/lib/xlsx-donor-itemmap-extract.ts'

const SOFFICE = 'C:\\Program Files\\LibreOffice\\program\\soffice.com'
const DONOR_SRC = 'F:/AI/ERP/erp/전체 보고서.xls'
const BASE = 'templates/report-workbook.xlsx'
const OUT = 'templates/report-workbook-full.xlsx'
const MANIFEST = 'src/lib/xlsx-donor-manifest.json'
const ITEMMAP = 'src/lib/xlsx-donor-itemmap.json'
const MARK = /^[○×X\/／]$/
/** 문장 안 괄호에 기입된 판정 — '( ○ )'. 원문은 공란이라 마크만 공백으로 되돌린다 */
const PAREN_MARK = /([(（])(\s*)([○×X\/／])(\s*)([)）])/g

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
const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** XML 텍스트 노드 → 실제 문자열. **엔티티를 해제하지 않으면** 뒤의 escXml이 '&'를 다시 이스케이프해
 *  줄바꿈 `&#10;`이 리터럴 '&#10;'로 인쇄된다(2026-08-23 독립 판정 실측 67칸 — 소화기구 범례 포함).
 *  수치 참조(&#10; · &#x41;)까지 풀고 `&amp;`를 **맨 마지막에** 풀어야 원문의 리터럴 '&'가 산다. */
const decodeXmlText = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&')
/** 셀 텍스트 재이스케이프 — 줄바꿈은 수치 참조로 되돌린다(Excel이 쓰는 형태이자 공백 정규화에 안전) */
const escCellText = (s: string) => escXml(s).replace(/\r/g, '&#13;').replace(/\n/g, '&#10;')

const sstTexts: string[] = []
{
  const sstFile = donorZip.file('xl/sharedStrings.xml')
  if (sstFile) {
    const sstXml = await sstFile.async('string')
    for (const m of sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g))
      sstTexts.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => decodeXmlText(t[1])).join(''))
  }
}
const unescXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

/** 기증 원본 결함 수리표 (소방계획서_32 D트랙) — 좌표·기대값·이웃 가드를 함께 선언한다.
 *  ⚠ 수기 편집 금지: 이 워크북은 매 빌드마다 원본 .xls에서 새로 만들어지므로 손으로 고치면 사라진다. */
const DONOR_CELL_FIXES = [
  // R-1: 기증 원본 오타 — A4와 코드가 같아 한 응답이 사라지고 다른 응답이 옆 행에 찍힌다.
  //      워크북 전체에서 유일한 중복이며, 정본 코드는 3-A-002다(항목 문구로 확정).
  { sheet: '스1', cell: 'A5', from: '3-A-001', to: '3-A-002',
    guardCell: 'B5', guard: '○ 보조수원(옥상)의 유효수량 적정 여부' },
] as const
const DONOR_DV_FIXES = [
  // R-2: 첫 항목 행만 목록 원천이 유실됐다(#REF!). 같은 시트의 나머지 dv와 같은 범위로 복구.
  //      워크북 전체 dv 중 유일한 #REF!다.
  { sheet: '소', sqref: 'C4', from: '#REF!', to: '$F$16:$F$18' },
] as const
/** D-1(2026-08-29 사용자 확정) — 결과칸 드롭다운의 '불량'을 ERP 어휘 `×`(U+00D7)로 통일.
 *  기증 원본은 ASCII `X`(U+0058)를 쓰는데 resultMark()·PDF·별지 4호는 전부 `×`다. 이 워크북은
 *  **손으로 고쳐 쓰는 산출물**이라(route.ts:18-27) 드롭다운이 X를 내면, 주입값 ×와 수기값 X가
 *  한 열에 섞인다. dv는 showErrorMessage="true" errorStyle="stop"이라 사용자가 ×를 직접 타이핑할
 *  수도 없다. 그래서 목록 원천인 범례 셀 자체를 고친다.
 *  ⚠ 좌표를 손으로 적지 않는다 — 아래 범례 탐지(protectedCells)가 이미 찾아낸 3칸의 마지막을 쓴다.
 *    손목록으로 박으면 자산이 바뀔 때 조용히 어긋난다. */
const LEGEND_BAD_FROM = 'X', LEGEND_BAD_TO = '×'

// ── ④ 기증 시트 이식 — 스크럽·s재번호·여백복원·인라인 전개 ───────────
console.log('④ 기증 시트 이식')
let wbXml = await outZip.file('xl/workbook.xml')!.async('string')
let relsXml = await outZip.file('xl/_rels/workbook.xml.rels')!.async('string')
let ctXml = await outZip.file('[Content_Types].xml')!.async('string')
let maxRid = Math.max(...[...relsXml.matchAll(/Id="rId(\d+)"/g)].map(m => Number(m[1])))
let maxSheetId = Math.max(...[...wbXml.matchAll(/sheetId="(\d+)"/g)].map(m => Number(m[1])))
let scrubTotal = 0
let parenScrubTotal = 0
let legacyStripped = 0
let cellFixed = 0, dvFixed = 0, glyphFixed = 0
const legendBySheet = new Map<string, string[]>()
const glyphFixedCells: string[] = []

for (const name of donorNames) {
  let xml = await donorZip.file(donorFiles.get(name)!)!.async('string')

  // 공유문자열 → 인라인 전개(자기닫힘 없음 — t="s"는 항상 <v> 보유)
  xml = xml.replace(/<c([^>]*?) t="s"([^>]*)><v>(\d+)<\/v><\/c>/g, (_m, a: string, b: string, idx: string) =>
    `<c${a}${b} t="inlineStr"><is><t xml:space="preserve">${escCellText(sstTexts[Number(idx)] ?? '')}</t></is></c>`)
  if (/ t="s"/.test(xml)) throw new Error(`${name}: t="s" 잔존 — 인라인 전개 실패`)

  // ── ④b 기증 원본 결함 수리 (소방계획서_32 D트랙 R-1·R-2) ──
  // 수기 편집은 재빌드 때 되돌아간다 — 수리는 반드시 이 축에서만. `from`이 어긋나면 즉시 세운다
  // (자산이 갱신됐다는 신호다). 좌표만 믿지 않고 `guard`로 이웃 문구까지 대조한다 — 원본이 한 행
  // 밀렸을 때 좌표만 보면 **엉뚱한 행을 개명**하게 된다.
  for (const f of DONOR_CELL_FIXES.filter(f => f.sheet === name)) {
    const re = new RegExp(`(<c r="${f.cell}"[^>]*><is><t[^>]*>)([\\s\\S]*?)(</t></is></c>)`)
    const m = re.exec(xml)
    if (!m) throw new Error(`${name}!${f.cell}: 수리 대상이 인라인 문자열이 아니다`)
    if (m[2] !== f.from) throw new Error(`${name}!${f.cell}: 수리 전제 불일치 — 기대 '${f.from}' 실제 '${m[2]}'`)
    const g = new RegExp(`(<c r="${f.guardCell}"[^>]*><is><t[^>]*>)([\\s\\S]*?)(</t></is></c>)`).exec(xml)
    if (g?.[2] !== f.guard) throw new Error(`${name}!${f.guardCell}: 가드 불일치 — 기대 '${f.guard}' 실제 '${g?.[2]}'`)
    // ⚠ 치환은 **함수 replacer**로만 — 문자열 replacer는 `$`를 해석한다(아래 dv 주석 참조)
    xml = xml.replace(re, (_m, a: string, _b: string, c: string) => `${a}${escCellText(f.to)}${c}`)
    cellFixed++
  }
  for (const f of DONOR_DV_FIXES.filter(f => f.sheet === name)) {
    const re = new RegExp(`(<dataValidation[^>]*sqref="${f.sqref}"[^>]*>[\\s\\S]*?<formula1>)([\\s\\S]*?)(</formula1>)`)
    const m = re.exec(xml)
    if (!m) throw new Error(`${name} dv sqref=${f.sqref}: 수리 대상 없음`)
    if (m[2].trim() !== f.from) throw new Error(`${name} dv ${f.sqref}: 수리 전제 불일치 — 기대 '${f.from}' 실제 '${m[2]}'`)
    // ⚠ **문자열 replacer 금지.** 엑셀 참조는 `$F$16:$F$18`처럼 `$`를 품는데, 치환 문자열에서
    //   `$16`은 '그룹 16'으로 해석되고, 그런 그룹이 없으면 V8은 `$1`(=매치 접두사 전체) + '6'으로
    //   되돌아간다. 2026-08-29 실측: formula1이 <dataValidation …> 통째를 삼킨 괴물이 됐고
    //   **⑤ 사후검증도 ⑤b 추출기도 전부 초록이었다**(#REF!가 사라졌으니 고쳐진 줄 알았다).
    //   잡아낸 것은 오직 옛 자산과의 **쪽수 대조군**이었다(72 vs 73).
    xml = xml.replace(re, (_m, a: string, _b: string, c: string) => `${a}${f.to}${c}`)
    // 닫힌 덮개 — 쓴 것을 되읽어 확인한다. 위 함정은 '썼다'와 '들어갔다'가 다른 사례였다
    const back = new RegExp(`<dataValidation[^>]*sqref="${f.sqref}"[^>]*>[\\s\\S]*?<formula1>([\\s\\S]*?)</formula1>`).exec(xml)
    if (back?.[1] !== f.to) throw new Error(`${name} dv ${f.sqref}: 수리 결과 불일치 — 기대 '${f.to}' 실제 ${JSON.stringify(back?.[1])}`)
    dvFixed++
  }

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

  // 셀 메모 앵커 제거 — 이식은 시트 XML만 옮기고 rels는 새로 만들지 않으므로, 남겨 두면
  // **없는 파트를 가리키는 고아 참조**가 된다(뷰어가 파일을 거부할 수 있다). 기증본의 내부
  // 메모 역시 우리 배포물에 실릴 이유가 없다 — 갑지 ④h와 같은 규약
  if (/<legacyDrawing\b/.test(xml)) { xml = xml.replace(/<legacyDrawing[^>]*\/>/g, ''); legacyStripped++ }

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

    // ── D-1: 범례의 '불량' 글자를 X → × 로. 탐지 규칙이 세 번째 칸을 X로 못 박고 있으므로
    //    그 칸이 곧 대상이다(손목록 없음). 스크럽은 protectedCells를 건너뛰므로 값은 살아남는다.
    if (protectedCells.size === 3) {
      const badCell = [...protectedCells].find(k => val(XLSX.utils.decode_cell(k).c, XLSX.utils.decode_cell(k).r) === LEGEND_BAD_FROM)
      if (!badCell) throw new Error(`${name}: 범례 3칸인데 '${LEGEND_BAD_FROM}' 칸이 없다`)
      const re = new RegExp(`(<c r="${badCell}"[^>]*><is><t[^>]*>)([\\s\\S]*?)(</t></is></c>)`)
      const m = re.exec(xml)
      if (!m) throw new Error(`${name}!${badCell}: 범례 칸이 인라인 문자열이 아니다`)
      if (m[2] !== LEGEND_BAD_FROM) throw new Error(`${name}!${badCell}: 범례 전제 불일치 — 기대 '${LEGEND_BAD_FROM}' 실제 '${m[2]}'`)
      xml = xml.replace(re, `$1${LEGEND_BAD_TO}$3`)
      glyphFixed++; glyphFixedCells.push(`${name}!${badCell}`)
    }
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

    // ── 문자열 **안**에 박힌 판정 마크 — 셀 값 전체가 마크일 때만 보던 축의 사각(2026-08-23 독립 판정).
    // 펌프성능시험 3항이 '… 140% 이하 ( ○ )'처럼 문장 안에서 적합 판정을 물고 있어, 하지도 않은
    // 시험이 전 고객 문서에 '전 항목 적합'으로 인쇄됐다(5칸 × 3 = 15개). 고시 원문은 공란이다
    // (별지4호 원문 XML 실측: '140% 이하일 것(   )' 9건 · 원문에 괄호 안 마크 0건).
    // 규칙은 좁게 — 괄호 안이 (공백* 마크1자 공백*)인 경우만, 마크를 공백으로 바꿔 폭을 지킨다.
    // 범례("양호 “○”, 불량 “×”")·항목 불릿('○ 설치높이 적합 여부')은 괄호가 아니라 손대지 않는다.
    for (const k of Object.keys(ws).filter(k => !k.startsWith('!'))) {
      const v = String((ws[k] as XLSX.CellObject).v ?? '')
      if (!PAREN_MARK.test(v)) continue
      const fixed = v.replace(PAREN_MARK, (_m, open: string, s1: string, _mk: string, s2: string, close: string) =>
        `${open}${s1} ${s2}${close}`)
      const re = new RegExp(`(<c r="${k}"[^>]*><is><t[^>]*>)([\\s\\S]*?)(</t></is></c>)`)
      const m = re.exec(xml)
      if (!m) throw new Error(`${name}!${k}: 괄호 마크 스크럽 대상이 인라인 문자열이 아니다`)
      xml = xml.replace(re, `$1${escCellText(fixed)}$3`)
      parenScrubTotal++
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
console.log(`   ${donorNames.length}시트 이식 · 결과 마크 ${scrubTotal}칸 스크럽 · 괄호 안 판정 ${parenScrubTotal}칸 스크럽 · 범례 ${[...legendBySheet.values()].filter(v => v.length).length}곳 보존 · 메모 앵커 ${legacyStripped}시트 제거`)
console.log(`   수리(32 D트랙): 셀 ${cellFixed}칸 · dv ${dvFixed}건 · 범례 불량글자 ${glyphFixed}칸 X→×`)
if (cellFixed !== DONOR_CELL_FIXES.length) throw new Error(`셀 수리 ${cellFixed}/${DONOR_CELL_FIXES.length} — 수리표 항목이 대상 시트에 닿지 않았다`)
if (dvFixed !== DONOR_DV_FIXES.length) throw new Error(`dv 수리 ${dvFixed}/${DONOR_DV_FIXES.length}`)

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

  // ★ 텍스트 충실도 — '열리는가'와 '텍스트가 사는가'는 다른 검사다. 병합·마크·페이지 수는 전부
  //   초록인데 인라인 전개가 엔티티를 이중 이스케이프해 줄바꿈 67칸이 리터럴 '&#10;'로 인쇄되고
  //   있었다(2026-08-23 독립 판정). 원본 셀 텍스트와 산출 셀 텍스트를 **전 도너 셀 전수 대조**하되,
  //   의도한 변형(빈칸 스크럽 · 괄호 안 판정 공백화)만 예외로 인정한다.
  for (const n of donorNames) {
    if (n === DONOR_TOC_SHEET) continue
    const ows = donorOrig.Sheets[n], nws = wb.Sheets[n] ?? {}
    for (const k of Object.keys(ows).filter(k => !k.startsWith('!'))) {
      const before = String((ows[k] as XLSX.CellObject).v ?? '')
      const after = String((nws[k] as XLSX.CellObject | undefined)?.v ?? '')
      if (before === after) continue
      // 예외 ①: 결과 마크 칸은 통째로 비운다
      if (MARK.test(before.trim()) && after === '') continue
      // 예외 ②: 괄호 안 판정만 공백으로
      if (before.replace(PAREN_MARK, (_m, o: string, s1: string, _mk: string, s2: string, c: string) =>
        `${o}${s1} ${s2}${c}`) === after) continue
      // 예외 ③: 수리표에 **등재된 좌표의 등재된 변형만** 인정한다(소방계획서_32 D트랙).
      //   좌표만 보고 넘기면 그 칸의 다른 변형까지 눈감게 되므로 from→to 쌍으로 대조한다.
      if (DONOR_CELL_FIXES.some(f => f.sheet === n && f.cell === k && f.from === before && f.to === after)) continue
      // 예외 ④: 범례 '불량' 글자 X → × (D-1). 대상 좌표는 빌드가 실제로 고친 것만
      if (before === LEGEND_BAD_FROM && after === LEGEND_BAD_TO && glyphFixedCells.includes(`${n}!${k}`)) continue
      fails.push(`텍스트 변형: ${n}!${k}\n        원본=${JSON.stringify(before).slice(0, 120)}\n        산출=${JSON.stringify(after).slice(0, 120)}`)
    }
  }
  // 괄호 안 판정 마크 잔존 0 — 위 대조와 축이 겹치지만, 원본에 없던 형태가 생기는 경우까지 막는다
  for (const n of donorNames) {
    for (const k of Object.keys(wb.Sheets[n] ?? {}).filter(k => !k.startsWith('!'))) {
      const v = String((wb.Sheets[n][k] as XLSX.CellObject).v ?? '')
      if (new RegExp(PAREN_MARK.source).test(v)) fails.push(`괄호 안 판정 잔존: ${n}!${k} = ${v.slice(0, 60)}`)
    }
  }
  // 목차 본문 칸이 XML에 실재하는가 — 없는 셀엔 쓸 수 없다(S0-5 전제). 그룹 수만큼 필요하다
  {
    const outZ = await JSZip.loadAsync(bytes)
    const map = await sheetFileMap(outZ)
    const tocXml = await outZ.file(map.get(DONOR_TOC_SHEET)!)!.async('string')
    const missing = DONOR_TOC_BODY_CELLS.filter(c => !new RegExp(`<c r="${c}"`).test(tocXml))
    if (missing.length) fails.push(`목차 본문 칸 XML 부재: ${missing.join(', ')}`)
    if (DONOR_TOC_BODY_CELLS.length < DONOR_GROUPS.length)
      fails.push(`목차 본문 칸 ${DONOR_TOC_BODY_CELLS.length} < 그룹 ${DONOR_GROUPS.length} — 전 설비 고객이 잘린다`)
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

  // 셀 메모 · 판정 산출 수식 — 기저에서 없앤 두 축이 도너 이식으로 되살아나지 않았는가.
  // 기저 파트는 바이트 복사라 '따라올 리 없다'가 참이지만, 도너 시트가 자기 legacyDrawing을
  // 달고 올 수 있고(rels 없이 이식되므로 고아 참조가 된다) 도너에도 판정 수식이 있을 수 있다.
  // 두 축 다 **파트/수식 존재 자체**로 판정한다 — 니들 목록은 다음 것을 못 본다(④d와 같은 규약)
  {
    const outZ = await JSZip.loadAsync(bytes)
    const parts = Object.keys(outZ.files).filter(n =>
      /xl\/(threadedComments\/)?comments\d*\.xml$/.test(n) || /vmlDrawing/.test(n))
    if (parts.length) fails.push(`셀 메모 파트 잔존 ${parts.length}개: ${parts.slice(0, 4).join(', ')}`)
    const map = await sheetFileMap(outZ)
    for (const [sheet, path] of map) {
      const xml = await outZ.file(path)!.async('string')
      if (/<legacyDrawing\b/.test(xml)) fails.push(`legacyDrawing(메모 앵커) 잔존: ${sheet}`)
      for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(m[2] ?? '')?.[1]
        if (f && /&quot;[○×X/／]&quot;|"[○×X/／]"/.test(f))
          fails.push(`판정 산출 수식 잔존: ${sheet}!${m[1]} = ${f.slice(0, 50)}`)
      }
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

// ── ⑤b 도너 항목 좌표 추출 → 교차검증 → 매핑 기록 (소방계획서_32 D트랙 S5-1) ──
// 런타임은 XML을 파싱하지 않는다 — 여기서 만든 JSON만 읽는다. 실패가 하나라도 있으면
// **자산을 갱신하지 않고 세운다**(잘못된 좌표로 주입하면 점검항목 문구를 덮어쓴다).
console.log('⑤b 항목 좌표 추출')
{
  /** 2026-08-29 실측 핀 — 자산이 조용히 바뀌면 여기서 먼저 붉어진다.
   *  바꿀 일이 생기면 **의도적으로** 고칠 것(자동 갱신 금지). */
  const EXPECT = { codes: 720, sheets: 37, colC: 33, colJ: 4 }
  const outZ = await JSZip.loadAsync(bytes)
  const map = await sheetFileMap(outZ)
  const donorSheets: Array<{ name: string; xml: string }> = []
  for (const n of donorNames) donorSheets.push({ name: n, xml: await outZ.file(map.get(n)!)!.async('string') })

  const ex = extractDonorItemMap(donorSheets)
  const fails = [...ex.failures]

  // F-8 핀 대조
  if (ex.entries.length !== EXPECT.codes) fails.push(`F-8 코드 수 ${ex.entries.length} ≠ 핀 ${EXPECT.codes}`)
  const nSheets = Object.keys(ex.resultCols).length
  if (nSheets !== EXPECT.sheets) fails.push(`F-8 코드 보유 시트 ${nSheets} ≠ 핀 ${EXPECT.sheets}`)
  const nC = Object.values(ex.resultCols).filter(c => c === 'C').length
  const nJ = Object.values(ex.resultCols).filter(c => c === 'J').length
  if (nC !== EXPECT.colC || nJ !== EXPECT.colJ) fails.push(`F-8 결과열 분포 C${nC}/J${nJ} ≠ 핀 C${EXPECT.colC}/J${EXPECT.colJ}`)
  const otherCols = [...new Set(Object.values(ex.resultCols))].filter(c => c !== 'C' && c !== 'J')
  if (otherCols.length) fails.push(`F-8 예상 밖 결과열: ${otherCols.join(',')}`)

  // F-9 `r=`가 첫 속성인가 — xlsx-inject.ts setCell 정규식의 전제. 깨지면 주입이 조용히 빗나간다
  for (const { name, xml } of donorSheets) {
    const bad = [...xml.matchAll(/<c\s([^>]*?)(?:\/>|>)/g)].filter(m => !/^r="/.test(m[1].trim())).length
    if (bad) fails.push(`F-9 ${name}: r=가 첫 속성이 아닌 셀 ${bad}개 — setCell 전제 붕괴`)
  }
  // 도너 dv 온전성 — ①#REF! 잔존 0(R-2 회귀) ②formula1 안에 XML 태그가 섞이지 않았는가.
  // ②는 '고쳤다'가 '망가뜨렸다'였던 실사고의 회귀 축이다(치환 문자열 `$16` 함정, ④b 주석 참조).
  // #REF!만 보면 오염된 formula1은 '고쳐진 것'으로 보인다 — 두 축이 다르다.
  for (const { name, xml } of donorSheets) {
    for (const m of xml.matchAll(/<formula1>([\s\S]*?)<\/formula1>/g)) {
      if (m[1].includes('#REF!')) fails.push(`도너 dv #REF! 잔존: ${name} — ${m[1].slice(0, 40)}`)
      if (/[<>]/.test(m[1])) fails.push(`도너 dv formula1 오염(XML 혼입): ${name} — ${m[1].slice(0, 60)}`)
      if (m[1].length > 40) fails.push(`도너 dv formula1 비정상 길이 ${m[1].length}: ${name} — ${m[1].slice(0, 60)}`)
    }
  }

  if (fails.length) {
    for (const f of fails) console.error(`   ❌ ${f}`)
    process.exit(1)
  }

  const cells: Record<string, [string, string]> = {}
  const itemText: Record<string, string> = {}
  for (const e of ex.entries) { cells[e.code] = [e.sheet, e.cell]; itemText[e.code] = e.itemText }
  writeFileSync(ITEMMAP, JSON.stringify({
    note: '빌드 생성물 — 손으로 고치지 말 것. scripts/build-workbook-full.mts ⑤b가 자산에서 뽑는다.',
    builtAt: new Date().toISOString().slice(0, 10),
    assetSha256: createHash('sha256').update(bytes).digest('hex'),
    counts: { codes: ex.entries.length, sheets: nSheets, colC: nC, colJ: nJ },
    resultCols: ex.resultCols,
    dvOnly: ex.dvOnly,
    cells, itemText,
  }, null, 1) + '\n')
  console.log(`   ${ex.entries.length}코드 · 결과열 C${nC}/J${nJ} · dv만 ${Object.values(ex.dvOnly).reduce((a, b) => a + b, 0)}칸 → ${ITEMMAP}`)
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
  // 쪽수 핀 — 자산 수리가 **레이아웃을 건드리면 여기서만 드러난다**. 2026-08-29 실사고:
  // dv formula1이 통째로 오염됐는데 ⑤·⑤b가 전부 초록이었고, 옛 자산과의 쪽수 차(72 vs 73)만이
  // 그것을 잡았다. 서식이 의도적으로 바뀌면 이 상수를 **손으로** 고칠 것(자동 갱신 금지).
  const EXPECT_PDF_PAGES = 72
  if (pdfPages !== EXPECT_PDF_PAGES)
    throw new Error(`PDF ${pdfPages}쪽 ≠ 핀 ${EXPECT_PDF_PAGES}쪽 — 수리가 레이아웃을 바꿨다. 옛 자산을 같은 LibreOffice로 렌더해 대조할 것(scripts/_probe-pagecount.mts)`)
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
