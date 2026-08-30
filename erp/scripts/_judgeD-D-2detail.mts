/** 판정자 D — D2/D3 심층: 간4 실재 여부 · dv 원천 범위 ↔ 범례 좌표 폐포 · J시트 C열 문구 · 인라인 dv 전수 */
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

const ASSET = path.resolve(process.cwd(), 'templates/report-workbook-full.xlsx')
const OUT = path.resolve(process.cwd(), 'scripts/_out/_judgeD-D2b.txt')
const lines: string[] = []
const say = (s: string) => lines.push(s)

const zip = await JSZip.loadAsync(fs.readFileSync(ASSET))
const sstXml = await zip.file('xl/sharedStrings.xml')?.async('string') ?? ''
const sst: string[] = []
for (const si of sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) sst.push([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''))
const dec = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#10;/g, '\n').replace(/&#13;/g, '\r').replace(/&amp;/g, '&')
const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)
const colName = (n: number) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26 } return s }

const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const rel = new Map<string, string>()
for (const m of relsXml.matchAll(/<Relationship\s([^>]*)\/>/g)) {
  const id = /Id="([^"]+)"/.exec(m[1])?.[1]; const tgt = /Target="([^"]+)"/.exec(m[1])?.[1]
  if (id && tgt) rel.set(id, tgt.replace(/^\/?xl\//, '').replace(/^\.\.\//, ''))
}
const sheets: Array<{ name: string; file: string }> = []
for (const m of wbXml.matchAll(/<sheet\s([^>]*?)\/>/g)) {
  sheets.push({ name: dec(/name="([^"]*)"/.exec(m[1])?.[1] ?? ''), file: 'xl/' + (rel.get(/r:id="([^"]+)"/.exec(m[1])?.[1] ?? '') ?? '') })
}
function readCells(xml: string) {
  const val = new Map<string, string>(); const refs = new Set<string>()
  const re = /<c(\s[^>]*?)?(\/>|>)/g; let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const attrs = m[1] ?? ''; const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1]; const self = m[2] === '/>'
    let body = ''
    if (!self) { const e = xml.indexOf('</c>', re.lastIndex); if (e < 0) break; body = xml.slice(re.lastIndex, e); re.lastIndex = e + 4 }
    if (!ref) continue
    refs.add(ref); if (!body) continue
    let v: string | null = null
    if (/t="inlineStr"/.test(attrs)) v = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')
    else { const vm = /<v>([\s\S]*?)<\/v>/.exec(body); if (vm) v = /t="s"/.test(attrs) ? (sst[+vm[1]] ?? '') : vm[1] }
    if (v !== null) val.set(ref, dec(v))
  }
  return { val, refs }
}
function expand(sq: string) {
  const out: string[] = []
  for (const p of sq.trim().split(/\s+/)) {
    const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(p); if (!m) continue
    if (!m[3]) { out.push(`${m[1]}${m[2]}`); continue }
    for (let c = colNum(m[1]); c <= colNum(m[3]); c++) for (let r = +m[2]; r <= +m[4]; r++) out.push(`${colName(c)}${r}`)
  }
  return out
}
const CODE_RE = /^\d{1,2}-[A-Z]-\d{3}$/
const cache = new Map<string, ReturnType<typeof readCells>>()
const xmlCache = new Map<string, string>()
for (const s of sheets) { const f = zip.file(s.file); if (!f) continue; const x = await f.async('string'); xmlCache.set(s.name, x); cache.set(s.name, readCells(x)) }

// ── ① 간4 · CO2-4 · 할3 의 정체
say('=== 간4 / CO2-4 / 할3 / 다중2 dump (first 60 non-empty cells) ===')
for (const n of ['간4', 'CO2-4', '할3']) {
  const c = cache.get(n); if (!c) { say(`${n}: NOT FOUND`); continue }
  const ents = [...c.val].filter(([, v]) => v.trim() !== '')
  say(`-- ${n}: nonEmpty=${ents.length} refs=${c.refs.size}`)
  const sorted = ents.sort((a, b) => { const ra = +a[0].replace(/[A-Z]/g, ''), rb = +b[0].replace(/[A-Z]/g, ''); return ra - rb || colNum(a[0].replace(/\d/g, '')) - colNum(b[0].replace(/\d/g, '')) })
  for (const [r, v] of sorted.slice(0, 60)) say(`   ${r} = ${JSON.stringify(v).slice(0, 110)}`)
}

// ── ② J열 4시트: A/B/C/J 열 나란히
say('')
say('=== J-col sheets: A(code) | C(text?) | J(result) ===')
for (const n of ['옥3', '스4', '옥외3', '다중1']) {
  const c = cache.get(n)!
  say(`-- ${n}`)
  const rows = [...c.val].filter(([r, v]) => /^A\d+$/.test(r) && CODE_RE.test(v.trim())).map(([r]) => +r.slice(1)).sort((a, b) => a - b)
  for (const r of rows) {
    say(`   r${r}: A=${JSON.stringify(c.val.get('A' + r) ?? '')} B=${JSON.stringify((c.val.get('B' + r) ?? '').slice(0, 30))} C=${JSON.stringify((c.val.get('C' + r) ?? '').slice(0, 60))} J=${JSON.stringify(c.val.get('J' + r) ?? '')} Jexists=${c.refs.has('J' + r)}`)
  }
}

// ── ③ 결과열 dv 원천 범위가 범례 3칸과 일치하는가 (닫힌 덮개)
say('')
say('=== dv source range vs legend block (per donor sheet) ===')
say('sheet\trcol\tdvSqrefOnRcol\tformula1\tsourceCells\tsourceValues\tlegendBlock\tMATCH')
const MARKV = /^[○×X/／]$/
let mismatched = 0, sourceHasAsciiX = 0
for (const s of sheets) {
  const c = cache.get(s.name); if (!c) continue
  const xml = xmlCache.get(s.name)!
  const codes = [...c.val].filter(([r, v]) => /^A\d+$/.test(r) && CODE_RE.test(v.trim()))
  if (!codes.length) continue
  const heads = [...c.val].filter(([, v]) => v.trim() === '점검결과').map(([r]) => r)
  if (heads.length !== 1) { say(`${s.name}\tHEADS=${heads.length}`); continue }
  const rcol = /^([A-Z]+)/.exec(heads[0])![1]
  // 범례
  let legend: string[] = []
  for (const [ref, v] of c.val) {
    if (v.trim() !== '○') continue
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!; const col = m[1], r = +m[2]
    const v2 = (c.val.get(`${col}${r + 1}`) ?? '').trim(), v3 = (c.val.get(`${col}${r + 2}`) ?? '').trim()
    if (MARKV.test(v2) && MARKV.test(v3)) legend = [ref, `${col}${r + 1}`, `${col}${r + 2}`]
  }
  for (const d of xml.matchAll(/<dataValidation\s([^>]*?)(\/>|>([\s\S]*?)<\/dataValidation>)/g)) {
    const a = d[1], body = d[3] ?? ''
    if (/\btype="list"/.test(a) === false) continue
    const sq = /sqref="([^"]*)"/.exec(a)?.[1] ?? ''
    const cells = expand(sq)
    if (!cells.some(x => new RegExp(`^${rcol}\\d+$`).test(x))) continue
    const f1 = dec(/<formula1>([\s\S]*?)<\/formula1>/.exec(body)?.[1] ?? '')
    const srcCells = /^\$?[A-Z]+\$?\d+/.test(f1) ? expand(f1) : []
    const srcVals = srcCells.map(x => c.val.get(x) ?? '')
    const inline = !srcCells.length ? f1 : ''
    const match = srcCells.length === 3 && legend.length === 3 && srcCells.join(',') === legend.join(',')
    if (!match) mismatched++
    if (srcVals.includes('X') || /(^|[",])X([",]|$)/.test(inline)) sourceHasAsciiX++
    say(`${s.name}\t${rcol}\t${sq}\t${f1}\t${srcCells.join(',')}\t${JSON.stringify(srcVals.join('|') || inline)}\t${legend.join(',')}\t${match ? 'OK' : 'DIFF'}`)
  }
}
say(`MISMATCH ${mismatched} · sourceHasAsciiX ${sourceHasAsciiX}`)

// ── ④ 워크북 전체 인라인 list dv (마크 포함 여부 무관)
say('')
say('=== ALL inline-list dv (formula1 not a range) ===')
for (const s of sheets) {
  const xml = xmlCache.get(s.name); if (!xml) continue
  for (const d of xml.matchAll(/<dataValidation\s([^>]*?)(\/>|>([\s\S]*?)<\/dataValidation>)/g)) {
    const a = d[1], body = d[3] ?? ''
    if (!/\btype="list"/.test(a)) continue
    const f1 = dec(/<formula1>([\s\S]*?)<\/formula1>/.exec(body)?.[1] ?? '')
    if (/^\$?[A-Z]+\$?\d+/.test(f1)) continue
    say(`${s.name}\tsqref=${/sqref="([^"]*)"/.exec(a)?.[1]}\tf1=${JSON.stringify(f1)}\t${a.replace(/\s+/g, ' ').slice(0, 200)}`)
  }
}

// ── ⑤ 워크북 전체에서 ASCII 'X' 단독 셀 (수기 잔존/범례 잔존 탐지)
say('')
say('=== cells whose whole value is ASCII X (U+0058) ===')
let asciiX = 0
for (const s of sheets) {
  const c = cache.get(s.name); if (!c) continue
  for (const [r, v] of c.val) if (v.trim() === 'X') { say(`${s.name}!${r}`); asciiX++ }
}
say(`asciiX total ${asciiX}`)

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, lines.join('\n'), 'utf8')
console.log('wrote ' + OUT + ' lines=' + lines.length)
