/** 판정자 D — S7-6 독립 축: **zip 파트 역방향 전수**로 표본 고객의 '답'을 찾는다.
 *
 *  구현자·타 판정자와 다른 점:
 *   ① 시트 목록을 workbook.xml/SheetJS SheetNames에서 얻지 않는다. **zip 안에서 `<sheetData>`를
 *      가진 파트를 전부 긁어** 시작하고, 거기서 workbook.xml로 되짚어 이름을 붙인다.
 *      → 이름이 안 붙는 파트(고아 워크시트)는 SheetNames 축의 어떤 검사에도 안 보이지만
 *        바이트로는 고객에게 배포된다(externalLinks 44파트와 같은 부류).
 *   ② 니들에 기대지 않는 축을 함께 둔다 — '표본 고객 이름 목록'은 새 고객 이름을 못 잡는다.
 *      마크가 든 문장 안의 **채워진 슬롯**(괄호 안 내용·숫자)을 구조로 센다.
 *   ③ 수식 축을 캐시 축과 분리해 센다(리터럴 0 ≠ 인쇄물 0 — LO가 재계산한다).
 *
 *  실행: npx tsx scripts/_judge27g-d-marks.mts <xlsx경로> <라벨> [plant]
 *   plant: 변이 주입(반증 가능성 자기검사) — 앵커 아닌 칸에 [√]·○·소견을 심는다.
 *  결과는 UTF-8 파일(F:/AI/ERP/_j27d-marks-<라벨>.txt)로 직접 기록한다(PS 5.1 모지바케 회피).
 *  저장소 파일은 읽기만 한다. */
import JSZip from 'jszip'
import { readFileSync, writeFileSync } from 'node:fs'
import { ANCHORS, MARK_CHECKED_RE, VERDICT_MARKS, SAMPLE_OPINION_NEEDLES, SCRUB_NEEDLES } from '../src/lib/xlsx-anchors.ts'
import { allDonorSheets } from '../src/lib/xlsx-donors.ts'

const SRC = process.argv[2] ?? 'templates/report-workbook-full.xlsx'
const LABEL = process.argv[3] ?? 'cur'
const PLANT = process.argv[4] === 'plant'
const OUT: string[] = []
const say = (s = '') => OUT.push(s)

/** 내 마크 축 — 구현자 상수(MARK_CHECKED_RE)보다 **넓다**. 좁은 쪽이 놓치는지 함께 센다 */
const MY_CHECK = /[√✓✔☑Ⅴ]/
const unesc = (s: string) => s
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

let bytes = new Uint8Array(readFileSync(SRC))

// ── 변이 주입(반증 가능성) — 자산 파일은 건드리지 않는다. 메모리 바이트에만 심는다 ──
if (PLANT) {
  const z = await JSZip.loadAsync(bytes)
  // 첫 워크시트 파트에 앵커가 아닌 좌표로 셀 3개를 추가한다
  const name = Object.keys(z.files).filter(n => /xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0]
  let xml = await z.file(name)!.async('string')
  const row = '<row r="9990">'
    + '<c r="ZY9990" t="inlineStr"><is><t>[√]소화기구</t></is></c>'
    + '<c r="ZZ9990" t="inlineStr"><is><t>○</t></is></c>'
    + '<c r="ZX9990" t="inlineStr"><is><t>( 3 )층 실명( 직원실 )</t></is></c>'
    + '<c r="ZW9990" t="str"><f>IF(C6="[  ]","/","○")</f><v>/</v></c>'
    + '</row>'
  xml = xml.replace('</sheetData>', row + '</sheetData>')
  z.file(name, xml)
  bytes = new Uint8Array(await z.generateAsync({ type: 'uint8array' }))
  say(`⚠ 변이 주입: ${name} 에 앵커 없는 [√]·○·위치문구·판정수식 4칸을 심었다`)
}

const zip = await JSZip.loadAsync(bytes)

// ── ① zip 파트 역방향 전수 ──────────────────────────────────────────
const allParts = Object.keys(zip.files).filter(n => !zip.files[n].dir)
const sheetParts: string[] = []
for (const n of allParts) {
  if (!/\.xml$/.test(n)) continue
  const head = (await zip.file(n)!.async('string')).slice(0, 4000)
  if (/<worksheet[\s>]/.test(head)) sheetParts.push(n)
}
// workbook.xml → rels → 파트 경로 (정방향 지도). 역방향 파트 목록에서 이 지도에 없는 것이 고아다
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const rels = new Map<string, string>()
for (const m of relXml.matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g))
  rels.set(m[1], 'xl/' + m[2].replace(/^\/?xl\//, '').replace(/^\.\//, ''))
for (const m of relXml.matchAll(/<Relationship\b[^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"/g))
  rels.set(m[2], 'xl/' + m[1].replace(/^\/?xl\//, '').replace(/^\.\//, ''))
const partOfSheet = new Map<string, string>()   // 시트명 → 파트
for (const m of wbXml.matchAll(/<sheet\b[^>]*\/>/g)) {
  const tag = m[0]
  const nm = /name="([^"]*)"/.exec(tag)?.[1]
  const rid = /r:id="([^"]*)"/.exec(tag)?.[1] ?? /id="([^"]*)"/.exec(tag)?.[1]
  if (nm && rid && rels.has(rid)) partOfSheet.set(unesc(nm), rels.get(rid)!)
}
const nameOfPart = new Map([...partOfSheet].map(([k, v]) => [v, k]))
const orphanParts = sheetParts.filter(p => !nameOfPart.has(p))
say(`[1] zip 워크시트 파트 ${sheetParts.length}개 · workbook.xml 등재 시트 ${partOfSheet.size}개 · **고아 파트 ${orphanParts.length}개**`)
if (orphanParts.length) say(`    고아: ${orphanParts.slice(0, 10).join(', ')}`)

// ── ② sharedStrings (고아 si 포함) ─────────────────────────────────
const sstXml = await zip.file('xl/sharedStrings.xml')?.async('string') ?? ''
const SST: string[] = []
for (const m of sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g))
  SST.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => unesc(t[1])).join(''))

// ── ③ 전 파트 셀 순회 ───────────────────────────────────────────────
type Cell = { part: string; sheet: string; ref: string; text: string; formula: string | null }
const cells: Cell[] = []
const usedSi = new Set<number>()
for (const part of sheetParts) {
  const sheet = nameOfPart.get(part) ?? `(고아:${part})`
  const xml = await zip.file(part)!.async('string')
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[2] ?? '', body = m[3] ?? ''
    const t = /\st="([^"]*)"/.exec(attrs)?.[1] ?? 'n'
    const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1] ?? null
    const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? null
    const is = [...body.matchAll(/<is>[\s\S]*?<\/is>/g)].map(x => [...x[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(y => unesc(y[1])).join('')).join('')
    let text = ''
    if (t === 's' && v !== null) { usedSi.add(Number(v)); text = SST[Number(v)] ?? '' }
    else if (is) text = is
    else if (v !== null) text = unesc(v)
    cells.push({ part, sheet, ref: m[1], text, formula: f === null ? null : unesc(f) })
  }
}
const orphanSi = SST.map((s, i) => [i, s] as const).filter(([i, s]) => !usedSi.has(i) && s.trim() !== '')
say(`[2] 셀 ${cells.length} · sharedStrings ${SST.length}(참조 안 되는 si ${orphanSi.length})`)

// ── ④ 판정 ─────────────────────────────────────────────────────────
const anchored = new Set(ANCHORS.map(a => `${a.sheet}!${a.cell}`))
const donors = new Set(allDonorSheets())
const hit = (label: string, rows: string[]) => {
  say(`[${label}] ${rows.length}건${rows.length ? ' — ' + rows.slice(0, 12).join(' | ') : ''}`)
  return rows.length
}
const key = (c: Cell) => `${c.sheet}!${c.ref}`

// (a) 앵커 없는 체크 마크 — 구현자 상수 축
const theirMarks = cells.filter(c => MARK_CHECKED_RE.test(c.text) && !anchored.has(key(c)))
  .map(c => `${key(c)}${c.formula ? '(캐시)' : ''}='${c.text.slice(0, 30)}'`)
// (b) 내 넓은 축(√ 글리프 자체) — 좁은 상수가 놓치는 것이 있는가
const myMarks = cells.filter(c => MY_CHECK.test(c.text) && !anchored.has(key(c)))
  .map(c => `${key(c)}='${c.text.slice(0, 30)}'`)
// (c) 판정 마크 캐시(도너 범례 제외)
const verdictCache = cells.filter(c => !donors.has(c.sheet)
  && (VERDICT_MARKS as readonly string[]).includes(c.text.trim()) && c.text.trim() !== '')
  .map(c => `${key(c)}='${c.text.trim()}'${c.formula ? '(f)' : ''}`)
// (d) 판정 마크를 **산출하는 수식** — 캐시가 0이어도 LO가 되살린다
const verdictFormula = cells.filter(c => c.formula && /"[○×X/／●]"/.test(c.formula))
  .map(c => `${key(c)}=${c.formula!.slice(0, 40)}`)
// (e) 표본 소견 니들(손목록 축)
const opinion = cells.filter(c => SAMPLE_OPINION_NEEDLES.some(n => c.text.includes(n)))
  .map(c => `${key(c)}='${c.text.slice(0, 24)}'`)
// (f) PII 니들
const pii = cells.filter(c => SCRUB_NEEDLES.some(n => c.text.includes(n))).map(c => key(c))
// (g) **니들 없는 축** — 마크가 든 문장 안의 '채워진 슬롯'.
//     `( 3 )층`·`( 직원실 )`·`( 1 개소 )`처럼 괄호 안이 비어 있어야 할 자리에 내용이 있는 칸.
//     새 고객 이름이든 표본이든 똑같이 잡힌다(니들 목록은 표본 하나만 인코딩한다)
const FILLED = /\([^()]*[가-힣0-9][^()]*\)/
const SLOTWORD = /(개소|층|실명|명|대|기|동)/
const filledSlots = cells.filter(c => !anchored.has(key(c)) && !donors.has(c.sheet)
  && /\[[\s√]*\]|［[\s√]*］/.test(c.text) && FILLED.test(c.text) && SLOTWORD.test(c.text))
  .map(c => `${key(c)}='${c.text.replace(/\s+/g, ' ').slice(0, 46)}'`)

let bad = 0
bad += hit('a 앵커없는 체크마크(구현자 상수)', theirMarks)
bad += hit('b 앵커없는 √글리프(내 넓은 축)', myMarks)
bad += hit('c 판정마크 캐시(갑지 시트)', verdictCache)
bad += hit('d 판정마크 산출 수식', verdictFormula)
bad += hit('e 표본 소견 니들', opinion)
bad += hit('f PII 니들', pii)
hit('g 니들없는 축: 마크 문장 안 채워진 슬롯(참고)', filledSlots)
hit('h 고아 sharedStrings 텍스트(참고)', orphanSi.slice(0, 8).map(([i, s]) => `si${i}='${s.slice(0, 24)}'`))

// ── ⑤ 목차 두 장 — 기저 '목차'와 도너 '목 차'가 같은 목록인가 ─────────
{
  const of = (sheet: string) => cells.filter(c => c.sheet === sheet && c.text.trim() !== '')
    .map(c => c.text.trim()).filter(t => t.length > 1)
  const a = of('목차'), b = of('목 차')
  const onlyA = a.filter(x => !b.includes(x)), onlyB = b.filter(x => !a.includes(x))
  say(`[5] 목차 ${a.length}항목 · '목 차' ${b.length}항목 · 한쪽에만 있는 항목 ${onlyA.length + onlyB.length}건`)
  if (onlyA.length) say(`    목차에만: ${onlyA.slice(0, 8).join(' | ')}`)
  if (onlyB.length) say(`    목 차에만: ${onlyB.slice(0, 8).join(' | ')}`)
}

// ── ⑥ S7-6이 지목한 5개 결함 좌표를 직접 본다(비웠는가 / 지어냈는가) ──
{
  const at = (sheet: string, ref: string) => cells.find(c => c.sheet === sheet && c.ref === ref)
  const show = (sheet: string, ref: string, why: string) => {
    const c = at(sheet, ref)
    say(`    ${sheet}!${ref} ${why}: ` + (c === undefined ? '(셀 없음)'
      : `text=${JSON.stringify(c.text)}${c.formula ? ` f=${JSON.stringify(c.formula)}` : ''}`))
  }
  say('[6] S7-6이 지목한 좌표 실측')
  show('대상물', 'G3', '①점검구분')
  show('위임장', 'D2', '①전파칸')
  for (const r of ['C6', 'D7', 'Y13', 'C28', 'Y28']) show('현황', r, '②설치체크')
  for (const r of ['S7', 'S12', 'AO13']) show('현황', r, '②판정칸')
  show('현3', 'C8', '③수신기위치')
  for (const r of ['C4', 'C5', 'C10']) show('현5', r, '④소견')
  show('계획서', 'H12', '④복제칸')
  show('완료보고서', 'B20', '이행조치')
}

say('')
say(`판정(${LABEL}): 결함성 발견 ${bad}건 (a~f 합)`)
const path = `F:/AI/ERP/_j27d-marks-${LABEL}.txt`
writeFileSync(path, OUT.join('\n') + '\n', 'utf8')
console.log(OUT.join('\n'))
console.log(`\n(기록: ${path})`)
process.exit(bad === 0 ? 0 : 2)
