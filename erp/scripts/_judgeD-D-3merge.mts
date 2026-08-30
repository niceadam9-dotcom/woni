/** 판정자 D — ①J시트 병합 앵커 축 ②전 결과셀 공란·실재 ③기타시설(가스·전기) 인쇄 자리 전수 탐색 */
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

const ASSET = path.resolve(process.cwd(), 'templates/report-workbook-full.xlsx')
const OUT = path.resolve(process.cwd(), 'scripts/_out/_judgeD-D3merge.txt')
const L: string[] = []
const say = (s: string) => L.push(s)

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
  const id = /Id="([^"]+)"/.exec(m[1])?.[1]; const t = /Target="([^"]+)"/.exec(m[1])?.[1]
  if (id && t) rel.set(id, t.replace(/^\/?xl\//, '').replace(/^\.\.\//, ''))
}
const sheets: Array<{ name: string; file: string }> = []
for (const m of wbXml.matchAll(/<sheet\s([^>]*?)\/>/g))
  sheets.push({ name: dec(/name="([^"]*)"/.exec(m[1])?.[1] ?? ''), file: 'xl/' + (rel.get(/r:id="([^"]+)"/.exec(m[1])?.[1] ?? '') ?? '') })

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

const CODE_RE = /^\d{1,2}-[A-Z]-\d{3}$/
const itemmap = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'src/lib/xlsx-donor-itemmap.json'), 'utf8')) as
  { cells: Record<string, [string, string]> }

const data = new Map<string, { val: Map<string, string>; refs: Set<string>; xml: string }>()
for (const s of sheets) { const f = zip.file(s.file); if (!f) continue; const x = await f.async('string'); data.set(s.name, { ...readCells(x), xml: x }) }

// ── ① 병합 지도: itemmap의 720 좌표가 전부 앵커인가 / 실재하는가 / 공란인가
say('=== itemmap 720 coords: exists / empty / merge-anchor ===')
const mergeAnchorOf = new Map<string, Map<string, string>>()   // sheet -> nonAnchorCell -> anchor
for (const [name, d] of data) {
  const m2 = new Map<string, string>()
  for (const mm of d.xml.matchAll(/<mergeCell[^>]*ref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
    const a = /^([A-Z]+)(\d+)$/.exec(mm[1])!, b = /^([A-Z]+)(\d+)$/.exec(mm[2])!
    for (let c = colNum(a[1]); c <= colNum(b[1]); c++) for (let r = +a[2]; r <= +b[2]; r++) {
      const ref = `${colName(c)}${r}`
      if (ref !== mm[1]) m2.set(ref, mm[1])
    }
  }
  mergeAnchorOf.set(name, m2)
}
let missing = 0, nonEmpty = 0, nonAnchor = 0, ok = 0
const bad: string[] = []
for (const [code, [sh, cell]] of Object.entries(itemmap.cells)) {
  const d = data.get(sh)
  if (!d) { bad.push(`${code} sheet missing ${sh}`); missing++; continue }
  const exists = d.refs.has(cell)
  const v = (d.val.get(cell) ?? '').trim()
  const na = mergeAnchorOf.get(sh)!.has(cell)
  if (!exists) { bad.push(`MISSING ${code} ${sh}!${cell}`); missing++ }
  if (v !== '') { bad.push(`NONEMPTY ${code} ${sh}!${cell} = ${JSON.stringify(v)}`); nonEmpty++ }
  if (na) { bad.push(`NONANCHOR ${code} ${sh}!${cell} -> anchor ${mergeAnchorOf.get(sh)!.get(cell)}`); nonAnchor++ }
  if (exists && v === '' && !na) ok++
}
say(`total ${Object.keys(itemmap.cells).length} · OK ${ok} · missing ${missing} · nonEmpty ${nonEmpty} · nonAnchor ${nonAnchor}`)
for (const b of bad.slice(0, 40)) say('  ' + b)

say('')
say('=== merges on J-col sheets touching result column ===')
for (const n of ['옥3', '스4', '옥외3', '다중1', '간4']) {
  const d = data.get(n); if (!d) continue
  const ms = [...d.xml.matchAll(/<mergeCell[^>]*ref="([A-Z]+\d+:[A-Z]+\d+)"/g)].map(m => m[1]).filter(r => /^[JK]\d+:[JK]\d+$/.test(r))
  say(`${n}: ${ms.join(' ')}`)
}

// ── ③ 기타시설(가스·전기) 인쇄 자리 — 워크북 전 시트에서 라벨 탐색
say('')
say('=== search for gas / electric labels across ALL sheets ===')
const needles = ['가스', 'LPG', 'LNG', '전기', '발전기', '수전', '변전', '위험물', '보일러', '취사']
for (const [name, d] of data) {
  for (const [ref, v] of d.val) {
    const t = v.trim()
    if (!t || t.length > 60) continue
    if (needles.some(nd => t.includes(nd))) say(`${name}!${ref}\t${JSON.stringify(t)}`)
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, L.join('\n'), 'utf8')
console.log('wrote ' + OUT + ' lines=' + L.length)
