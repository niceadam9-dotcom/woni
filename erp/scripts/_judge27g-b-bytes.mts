/** 판정자 B (원시 바이트/XML 축) — S0-2 서식 생존 · S0-3 JSZip 패치 · S0-4 전파 전제
 *  실행: npx tsx scripts/_judge27g-b-bytes.mts
 *  soffice 실행 금지. 커밋 자산 + 원본 .xls만 본다. 저장소 파일 수정 없음(TEMP만). */
import XLSX from 'xlsx'
import JSZip from 'jszip'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const OUT: string[] = []
const say = (s = '') => { OUT.push(s); console.log(s) }
let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => { say(`  ${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); ok ? pass++ : fail++ }

const ROOT = 'F:/AI/ERP/erp'
const FULL = `${ROOT}/templates/report-workbook-full.xlsx`
const MIN = `${ROOT}/templates/report-workbook.xlsx`
const SRC_XLS = `${ROOT}/보고서 갑지.xls`
const dir = mkdtempSync(join(tmpdir(), 'j27gb2-'))

const countOf = (styles: string, tag: string) =>
  Number(new RegExp(`<${tag} count="(\\d+)"`).exec(styles)?.[1] ?? 0)

async function styleCensus(path: string) {
  const zip = await JSZip.loadAsync(readFileSync(path))
  const styles = await zip.file('xl/styles.xml')!.async('string')
  const wb = zip.file('xl/workbook.xml') ? await zip.file('xl/workbook.xml')!.async('string') : ''
  return {
    borders: countOf(styles, 'borders'), fonts: countOf(styles, 'fonts'),
    fills: countOf(styles, 'fills'), cellXfs: countOf(styles, 'cellXfs'),
    definedNames: (wb.match(/<definedName /g) ?? []).length,
    drawing: Object.keys(zip.files).filter(f => f.includes('drawing')).length,
    media: Object.keys(zip.files).filter(f => f.startsWith('xl/media/')).length,
    parts: Object.keys(zip.files).length,
    stylesLen: styles.length,
  }
}

// ══ S0-2 ═════════════════════════════════════════════════════════════════
say('=== 판정자 B / S0-2 서식 생존 — 독립 재측정 ===')
const cFull = await styleCensus(FULL)
const cMin = await styleCensus(MIN)
say(`  report-workbook.xlsx      : ${JSON.stringify(cMin)}`)
say(`  report-workbook-full.xlsx : ${JSON.stringify(cFull)}`)
say('  구현자 주장(변환본): borders=109 · fonts=117 · fills=9 · cellXfs=712 · definedNames=981 · drawing 8 · media 1')
const claim = { borders: 109, fonts: 117, fills: 9, cellXfs: 712, definedNames: 981, drawing: 8, media: 1 }
for (const k of Object.keys(claim) as Array<keyof typeof claim>) {
  const v = (cMin as any)[k]
  say(`    ${String(k).padEnd(13)} 주장 ${String(claim[k]).padStart(4)} / 기저자산 실측 ${String(v).padStart(4)} ${v === claim[k] ? '(일치)' : '(불일치)'}`)
}

// 대조군 — SheetJS 왕복이 정말 서식을 전멸시키는가(key_evidence 재현). 검사의 판별력 증명
say('')
say('[대조군] SheetJS 왕복본의 styles.xml — S0-2 단언이 무엇을 구별하는가')
const rt = join(dir, 'sheetjs-roundtrip.xlsx')
const wbIn = XLSX.read(readFileSync(MIN), { cellStyles: true })
XLSX.writeFile(wbIn, rt, { bookType: 'xlsx' })
const cRt = await styleCensus(rt)
say(`  SheetJS 왕복본            : ${JSON.stringify(cRt)}`)
check('대조군이 실제로 서식을 잃는다(왕복본 borders/fonts가 자산보다 급감)',
  cRt.borders < cMin.borders && cRt.fonts < cMin.fonts,
  `borders ${cMin.borders}→${cRt.borders} · fonts ${cMin.fonts}→${cRt.fonts}`)
// 게이트의 실제 단언(borders>1 · fonts>1)을 대조군에 먹여 본다 — 판별력 시험
const gateVerdictOnControl = cRt.borders > 1 && cRt.fonts > 1
check("⚠ 게이트 단언('borders>1 && fonts>1')이 대조군(SheetJS 왕복본)을 **탈락**시키는가",
  !gateVerdictOnControl,
  gateVerdictOnControl
    ? `**아니다** — 왕복본도 borders=${cRt.borders}·fonts=${cRt.fonts}로 통과한다. 임계 >1은 서식 전멸을 못 가른다`
    : `대조군 탈락(borders=${cRt.borders}·fonts=${cRt.fonts})`)
// 원본 총 셀 vs 왕복 총 셀 — key_evidence의 진짜 축
const cellCount = (p: string) => {
  const w = XLSX.read(readFileSync(p), { cellStyles: true, sheetStubs: true })
  return w.SheetNames.reduce((n, s) => n + Object.keys(w.Sheets[s]).filter(k => !k.startsWith('!')).length, 0)
}
say(`  참고 총 셀: 기저자산 ${cellCount(MIN)} → SheetJS 왕복본 ${cellCount(rt)}`)

// ══ S0-3 ═════════════════════════════════════════════════════════════════
say('')
say('=== 판정자 B / S0-3 JSZip 바이트 패치 — 독립 재측정(커밋 자산 위) ===')
async function sheetPath(zip: JSZip, name: string) {
  const wb = await zip.file('xl/workbook.xml')!.async('string')
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const rel = new Map<string, string>()
  for (const m of rels.matchAll(/<Relationship\b([^>]*)>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1])?.[1], tg = /\bTarget="([^"]+)"/.exec(m[1])?.[1]
    if (id && tg) rel.set(id, tg)
  }
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    if (/\bname="([^"]+)"/.exec(m[1])?.[1] !== name) continue
    const t = rel.get(/\br:id="([^"]+)"/.exec(m[1])?.[1] ?? '') ?? ''
    return t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`
  }
  return null
}
const SENT = 'ZZ판정자BZZ'
const zA = await JSZip.loadAsync(readFileSync(MIN))
const hubPath = (await sheetPath(zA, '개요'))!
const before = await zA.file(hubPath)!.async('string')
const re = /(<c r="B14"[^>]*?)(\/>|>[\s\S]*?<\/c>)/
const hit = re.exec(before)
check('개요!B14를 XML에서 찾음', !!hit, hit ? hit[0].slice(0, 80) : '')
zA.file(hubPath, before.replace(re, `${hit![1].replace(/\st="[^"]*"/, '')} t="inlineStr"><is><t>${SENT}</t></is></c>`))
const patched = join(dir, 'patched.xlsx')
writeFileSync(patched, await zA.generateAsync({ type: 'nodebuffer' }))

const zB = await JSZip.loadAsync(readFileSync(patched))
// (a) styles.xml — 문자열이 아니라 **압축 해제 원시 바이트**로 비교(criterion 문구가 '바이트 동일')
const sO = await (await JSZip.loadAsync(readFileSync(MIN))).file('xl/styles.xml')!.async('uint8array')
const sP = await zB.file('xl/styles.xml')!.async('uint8array')
check('styles.xml 원시 바이트 동일', sO.length === sP.length && sO.every((b, i) => b === sP[i]),
  `${sO.length} vs ${sP.length}`)
// (b) 병합 불변
const mc = (p: string) => { const w = XLSX.read(readFileSync(p), { cellStyles: true }); return w.SheetNames.reduce((n, s) => n + (w.Sheets[s]['!merges'] ?? []).length, 0) }
check('병합셀 불변', mc(patched) === mc(MIN), `${mc(MIN)} → ${mc(patched)}`)
// (c) 패치값 반영
const wbP = XLSX.read(readFileSync(patched), { cellStyles: true })
check('패치값 반영', wbP.Sheets['개요']['B14']?.v === SENT, String(wbP.Sheets['개요']['B14']?.v ?? '(없음)'))
// (d) ★ 게이트보다 넓은 축 — zip 전 파트를 대조해 **의도한 1파트 외 변화 0**인가
const zO = await JSZip.loadAsync(readFileSync(MIN))
const namesO = Object.keys(zO.files).filter(f => !zO.files[f].dir).sort()
const namesP = Object.keys(zB.files).filter(f => !zB.files[f].dir).sort()
const diffs: string[] = []
check('파트 목록 동일', JSON.stringify(namesO) === JSON.stringify(namesP), `${namesO.length} vs ${namesP.length}`)
for (const n of namesO) {
  if (!zB.file(n)) { diffs.push(`${n}(사라짐)`); continue }
  const a = await zO.file(n)!.async('uint8array'), b = await zB.file(n)!.async('uint8array')
  if (a.length !== b.length || !a.every((x, i) => x === b[i])) diffs.push(n)
}
check('의도한 시트 1파트 외 내용 변화 0 (전 파트 바이트 대조)',
  diffs.length === 1 && diffs[0] === hubPath, `변화 ${diffs.length}: ${diffs.slice(0, 8).join(', ')}`)
// (e) 대조군 — 스타일을 일부러 흔들면 (a)가 붉어지는가
{
  const z = await JSZip.loadAsync(readFileSync(MIN))
  const st = await z.file('xl/styles.xml')!.async('string')
  z.file('xl/styles.xml', st.replace(/<borders count="(\d+)"/, '<borders count="1"'))
  const p2 = join(dir, 'mut-styles.xlsx'); writeFileSync(p2, await z.generateAsync({ type: 'nodebuffer' }))
  const s2 = await (await JSZip.loadAsync(readFileSync(p2))).file('xl/styles.xml')!.async('uint8array')
  check('[변이] styles.xml을 흔들면 바이트 동일 단언이 붉어진다',
    !(sO.length === s2.length && sO.every((b, i) => b === s2[i])), `${sO.length} vs ${s2.length}`)
}

// ══ S0-4 전제 실측 ════════════════════════════════════════════════════════
say('')
say('=== 판정자 B / S0-4 — SPOKES가 정말 개요!B14에 의존하는가(원본 .xls 실측) ===')
const src = XLSX.read(readFileSync(SRC_XLS), { cellFormula: true })
say(`  원본 .xls 시트 ${src.SheetNames.length}개`)
// 단일참조 간선 그래프(게이트와 같은 규칙) → 개요!B14의 이행 폐포
const edges = new Map<string, Array<string>>()
for (const s of src.SheetNames) {
  const ws = src.Sheets[s]
  for (const k of Object.keys(ws)) {
    if (k.startsWith('!')) continue
    const f = String((ws as any)[k].f ?? ''); if (!f) continue
    const x = /^'?([^'!]+)'?!(\$?[A-Z]+\$?\d+)$/.exec(f), lo = /^(\$?[A-Z]+\$?\d+)$/.exec(f)
    if (!x && !lo) continue
    const from = x ? `${x[1]}!${x[2].replace(/\$/g, '')}` : `${s}!${lo![1].replace(/\$/g, '')}`
    edges.set(from, [...(edges.get(from) ?? []), `${s}!${k}`])
  }
}
const seen = new Set<string>(); const q = ['개요!B14']
while (q.length) for (const d of edges.get(q.shift()!) ?? []) if (!seen.has(d)) { seen.add(d); q.push(d) }
say(`  간선 ${[...edges.values()].reduce((n, a) => n + a.length, 0)}건 · 개요!B14 이행 폐포 ${seen.size}건: ${[...seen].join(', ')}`)
const SPOKES = [['공문', 'B8'], ['보고서', 'C4'], ['정보', 'B4']]
for (const [s, c] of SPOKES) {
  const inClosure = seen.has(`${s}!${c}`)
  const cell = (src.Sheets[s] as any)?.[c]
  check(`SPOKE ${s}!${c} 가 개요!B14 폐포에 실재(= '전파 안 됨' 단언에 내용이 있다)`,
    inClosure, `수식=${JSON.stringify(cell?.f ?? null)} 캐시=${JSON.stringify(cell?.v ?? null)}`)
}
check("SPOKES에 표본값 '정내과의원'이 원본 캐시로 실재(센티널 대조가 성립)",
  SPOKES.some(([s, c]) => String((src.Sheets[s] as any)?.[c]?.v ?? '').includes('정내과의원')),
  SPOKES.map(([s, c]) => `${s}!${c}=${JSON.stringify((src.Sheets[s] as any)?.[c]?.v ?? null)}`).join(' · '))

say('')
say(`결과: ${pass} PASS / ${fail} FAIL`)
say(`임시: ${dir}`)
writeFileSync(`${ROOT}/scripts/_judge27g-b-bytes.txt`, OUT.join('\n'), 'utf8')
process.exit(fail ? 1 : 0)
