/** 1회성 조사 — 「완료보고서」 시트 **전 셀** 덤프(소방계획서_43 S2 착수 전).
 *  rows 15~30만 보던 종전 프로브(_probe-42-done-sheet)가 B16의 표본 주소를 시야에 넣고도
 *  '앵커 후보'만 세느라 지나쳤다 — 축을 전 셀로 넓혀 동결 리터럴을 전수로 본다. */
import fs from 'node:fs'
import JSZip from 'jszip'

const SHEET = '완료보고서'
const zip = await JSZip.loadAsync(fs.readFileSync('templates/report-workbook-full.xlsx'))

const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const relTarget = new Map([...relsXml.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
const hit = [...wbXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"/g)].find(m => m[1] === SHEET)
if (!hit) throw new Error(`시트 '${SHEET}' 없음`)
const path = 'xl/' + (relTarget.get(hit[2]) ?? '').replace(/^\/?xl\//, '')

const shared: string[] = []
const ssFile = zip.file('xl/sharedStrings.xml')
if (ssFile) {
  const ss = await ssFile.async('string')
  for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    shared.push([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''))
  }
}
const unesc = (s: string) => s.replace(/&#10;/g, '\\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

const xml = await zip.file(path)!.async('string')
console.log(`${SHEET} → ${path} · sharedStrings ${shared.length}건\n`)

let literals = 0, formulas = 0
for (const c of xml.match(/<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g) ?? []) {
  const ref = c.match(/r="([A-Z]+\d+)"/)?.[1] ?? '?'
  const t = c.match(/ t="([^"]+)"/)?.[1] ?? 'n'
  const f = c.match(/<f[^>]*>([\s\S]*?)<\/f>/)?.[1]
  const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1]
  const isText = c.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)?.[1]
  let shown = ''
  if (t === 's' && v) shown = shared[Number(v)] ?? `#${v}`
  else if (t === 'inlineStr' && isText != null) shown = isText
  else if (v != null) shown = v
  if (!f && !shown) continue
  if (f) formulas++; else literals++
  console.log(`  ${ref.padEnd(5)} t=${t.padEnd(9)} ${f ? `f==${unesc(f)}`.padEnd(24) : ''.padEnd(24)} v="${unesc(shown)}"`)
}
console.log(`\n리터럴 ${literals}칸 · 수식 ${formulas}칸`)
