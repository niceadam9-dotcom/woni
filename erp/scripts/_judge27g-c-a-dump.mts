/** 판정자 C — 축: 원시 XML / sharedStrings 바이트 (구현자의 soffice 충실도 축과 다름)
 *  [1] 현 자산(report-workbook-full.xlsx)의 정보 12칸 + 다수동일때 15칸 표본 답 원문 덤프
 *  [2] sharedStrings 전수 — 고아 si(어느 셀도 안 가리키는 항목) census
 *  [3] 체크 글리프 census — MARK_CHECKED_RE가 놓치는 표기가 실재하는가
 *  읽기 전용. 산출물 생성 없음. */
import { readFileSync, writeFileSync } from 'node:fs'
import JSZip from 'jszip'
import { MARK_CHECKED_RE, MARK_RE, ANCHORS } from '../src/lib/xlsx-anchors.ts'

const OUT: string[] = []
const log = (s = '') => OUT.push(s)

const FULL = 'templates/report-workbook-full.xlsx'
const bytes = new Uint8Array(readFileSync(FULL))
const zip = await JSZip.loadAsync(bytes)

// ── 독립 파서: 시트명 → 파트 경로 (구현 코드의 sheetFileMap을 쓰지 않는다) ──
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const rels = new Map<string, string>()
for (const m of relXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
  rels.set(m[1], m[2].replace(/^\/?xl\//, '').replace(/^\.\//, ''))
}
for (const m of relXml.matchAll(/<Relationship\b[^>]*Target="([^"]+)"[^>]*Id="([^"]+)"/g)) {
  if (!rels.has(m[2])) rels.set(m[2], m[1].replace(/^\/?xl\//, '').replace(/^\.\//, ''))
}
const unesc = (s: string) => s
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&')

type Sheet = { name: string; path: string; state: string }
const sheets: Sheet[] = []
for (const m of wbXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
  const at = m[1]
  const name = unesc(/name="([^"]*)"/.exec(at)?.[1] ?? '')
  const rid = /r:id="([^"]+)"/.exec(at)?.[1] ?? ''
  const state = /state="([^"]*)"/.exec(at)?.[1] ?? 'visible'
  sheets.push({ name, path: 'xl/' + (rels.get(rid) ?? '?'), state })
}
log(`# 자산 ${FULL}`)
log(`시트 ${sheets.length}장 (숨김 ${sheets.filter(s => s.state !== 'visible').length}장: ${sheets.filter(s => s.state !== 'visible').map(s => `${s.name}[${s.state}]`).join(', ') || '없음'})`)
log(`worksheets 파트 ${Object.keys(zip.files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).length}개`)

// ── sharedStrings ──
const sstXml = await zip.file('xl/sharedStrings.xml')?.async('string') ?? ''
const siTexts: string[] = []
for (const m of sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
  let t = ''
  for (const tm of m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) t += unesc(tm[1])
  siTexts.push(t)
}
const declaredUnique = /uniqueCount="(\d+)"/.exec(sstXml)?.[1] ?? '?'
log(`sharedStrings si ${siTexts.length}개 (선언 uniqueCount=${declaredUnique})`)

// ── 셀 전수 (독립 파서) ──
type Cell = { sheet: string; ref: string; text: string; isFormula: boolean }
const cells: Cell[] = []
const usedSi = new Set<number>()
for (const s of sheets) {
  const xml = await zip.file(s.path)?.async('string')
  if (!xml) { log(`⚠ 파트 없음: ${s.name} → ${s.path}`); continue }
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1], body = m[2] ?? ''
    const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? '?'
    const t = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n'
    const isFormula = /<f[\s>]/.test(body)
    let text = ''
    if (t === 's') {
      const i = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '-1')
      if (i >= 0) { usedSi.add(i); text = siTexts[i] ?? '' }
    } else if (t === 'inlineStr') {
      for (const tm of body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) text += unesc(tm[1])
    } else {
      text = unesc(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '')
    }
    if (text !== '') cells.push({ sheet: s.name, ref, text, isFormula })
  }
}
log(`값 보유 셀 ${cells.length}칸 (리터럴 ${cells.filter(c => !c.isFormula).length} · 수식캐시 ${cells.filter(c => c.isFormula).length})`)

// ── [2] 고아 si ──
const orphans = siTexts.map((t, i) => [i, t] as const).filter(([i]) => !usedSi.has(i))
log(`\n## [2] 고아 sharedStrings — 어느 셀도 참조하지 않는 si: ${orphans.length}개`)
for (const [i, t] of orphans.slice(0, 40)) log(`  si#${i} ${JSON.stringify(t.slice(0, 90))}`)
const orphanMarked = orphans.filter(([, t]) => MARK_CHECKED_RE.test(t))
log(`  그중 체크 마크(√) 보유: ${orphanMarked.length}개 ${orphanMarked.slice(0, 8).map(([i]) => '#' + i).join(' ')}`)

// ── [1] 표본 답 원문 ──
const at = (sheet: string, ref: string) => cells.find(c => c.sheet === sheet && c.ref === ref)
log('\n## [1] 정보 시트 12칸 + B5 (자산 원문 = 표본 고객의 답)')
for (const ref of ['B5', 'B8', 'B10', 'B11', 'B12', 'B13', 'B14', 'E14', 'I14', 'B19', 'B20', 'B21', 'B22', 'B23']) {
  const c = at('정보', ref)
  log(`  정보!${ref} ${c?.isFormula ? '(수식)' : ''} ${JSON.stringify(c?.text ?? null)}`)
}
log('\n## [1b] 다수동일때 3블록 15칸')
for (const off of [0, 10, 20]) for (const r of [6, 7, 8, 9, 10]) {
  const c = at('다수동일때', `B${r + off}`)
  log(`  다수동일때!B${r + off} ${JSON.stringify(c?.text ?? null)}  (라벨 A${r + off}=${JSON.stringify(at('다수동일때', `A${r + off}`)?.text ?? null)})`)
}
// 이웃 — 다수동일때 이외에 같은 서식 어휘를 가진 시트가 또 있는가
log('\n## [1c] "건축물구조/지붕구조/계단/승강기/주차장" 라벨을 가진 시트 전수')
const LABELS = ['건축물구조', '지붕구조', '계단', '승강기', '주차장']
const bySheet = new Map<string, string[]>()
for (const c of cells) {
  const t = c.text.replace(/\s/g, '')
  if (LABELS.includes(t)) (bySheet.get(c.sheet) ?? bySheet.set(c.sheet, []).get(c.sheet)!).push(`${c.ref}=${t}`)
}
for (const [s, v] of bySheet) log(`  ${s}: ${v.join(' ')}`)

// ── [3] 체크 글리프 census ──
log('\n## [3] 체크 글리프 census — MARK_CHECKED_RE 사각 탐색')
const GLYPHS = ['√', '✓', '✔', '☑', '☒', 'V', 'v', 'Ｖ', '●', '■', '★', '◉', '◎', '＊', 'ㅇ']
const tokenRe = /[[［(（〔【][^\]］)）〕】]{0,24}[\]］)）〕】]/g
const tokCount = new Map<string, { n: number; ex: string[] }>()
for (const c of cells) for (const m of c.text.matchAll(tokenRe)) {
  const e = tokCount.get(m[0]) ?? { n: 0, ex: [] }
  e.n++; if (e.ex.length < 3) e.ex.push(`${c.sheet}!${c.ref}`)
  tokCount.set(m[0], e)
}
const checkTokens = [...tokCount].filter(([t]) => GLYPHS.some(g => t.includes(g)))
log(`  괄호 토큰 ${tokCount.size}종 · 체크 글리프 보유 ${checkTokens.length}종`)
log('  토큰 | 건수 | MARK_CHECKED_RE | MARK_RE | 예')
for (const [t, e] of checkTokens.sort((a, b) => b[1].n - a[1].n))
  log(`  ${JSON.stringify(t)} | ${e.n} | ${MARK_CHECKED_RE.test(t) ? 'O' : '**MISS**'} | ${MARK_RE.test(t) ? 'O' : 'miss'} | ${e.ex.join(' ')}`)

log('\n  글리프 단위 분포(괄호 무관):')
for (const g of GLYPHS) {
  const hit = cells.filter(c => c.text.includes(g))
  if (hit.length) log(`    '${g}' — ${hit.length}칸 (리터럴 ${hit.filter(c => !c.isFormula).length}/수식 ${hit.filter(c => c.isFormula).length}) 예 ${hit.slice(0, 4).map(c => c.sheet + '!' + c.ref).join(' ')}`)
}

// MARK_CHECKED_RE 매치 칸 vs 앵커
const anchored = new Set(ANCHORS.map(a => `${a.sheet}!${a.cell}`))
const marked = cells.filter(c => MARK_CHECKED_RE.test(c.text))
log(`\n  MARK_CHECKED_RE 매치 ${marked.length}칸 (리터럴 ${marked.filter(c => !c.isFormula).length} · 수식캐시 ${marked.filter(c => c.isFormula).length})`)
const unan = marked.filter(c => !anchored.has(`${c.sheet}!${c.ref}`))
log(`  그중 앵커 없음: ${unan.length}칸 ${unan.slice(0, 12).map(c => `${c.sheet}!${c.ref}=${JSON.stringify(c.text.slice(0, 30))}`).join(' | ')}`)

// ── [4] 워크시트 밖 파트에 마크/표본 문자열이 있는가(도형·머리글·차트 등) ──
log('\n## [4] 워크시트·sharedStrings 밖 파트의 체크 마크')
for (const name of Object.keys(zip.files)) {
  if (zip.files[name].dir) continue
  if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name) || name === 'xl/sharedStrings.xml') continue
  const raw = await zip.file(name)!.async('string')
  if (MARK_CHECKED_RE.test(raw) || /√/.test(raw)) log(`  ⚠ ${name} — √ 포함`)
}
log('  (위 목록이 비면 마크는 worksheets/sharedStrings 안에만 있다)')

writeFileSync('scripts/_judge27g-c-a-dump.txt', OUT.join('\n'), 'utf8')
console.log('written')
