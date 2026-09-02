/** 현1 3-1 수량 표(합계·동별 행) 셀 배치 실측 — 라벨·수식·빈 셀 전부.
 *  _p4-hyeon1-literals와 같은 원시 XML 축(SheetJS 금지 D-8). 대상: 1~14행. */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'

const SHEET = process.argv[2] ?? '현1'
const MAXROW = Number(process.argv[3] ?? 14)

const zip = await JSZip.loadAsync(readFileSync('templates/report-workbook-full.xlsx'))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const relMap = new Map([...relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
const sheets = [...wbXml.matchAll(/<sheet[^>]*\sname="([^"]+)"[^>]*r:id="([^"]+)"/g)]
  .map(m => ({ name: m[1], path: 'xl/' + relMap.get(m[2])!.replace(/^\//, '').replace(/^xl\//, '') }))
const hit = sheets.find(s => s.name === SHEET)!

let shared: string[] = []
const ssFile = zip.file('xl/sharedStrings.xml')
if (ssFile) {
  const ss = await ssFile.async('string')
  shared = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''))
}
const dec = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, '&')

const xml = await zip.file(hit.path)!.async('string')
// 병합 범위도 본다 — 행 라벨·수량 칸이 몇 열 병합인지가 주입 좌표를 정한다
const merges = [...xml.matchAll(/<mergeCell ref="([A-Z]+\d+:[A-Z]+\d+)"\/>/g)].map(m => m[1])
  .filter(r => Number(/[A-Z]+(\d+)/.exec(r)![1]) <= MAXROW)
console.log('MERGES(<=' + MAXROW + '):', merges.join(' '))

for (const m of xml.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
  const attrs = m[1], body = m[2] ?? ''
  const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? '?'
  const rowNum = Number(/[A-Z]+(\d+)/.exec(ref)?.[1] ?? '999')
  if (rowNum > MAXROW) continue
  const t = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n'
  const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1]
  let text = ''
  if (t === 's') { const v = /<v>(\d+)<\/v>/.exec(body)?.[1]; if (v != null) text = shared[+v] ?? '' }
  else if (t === 'inlineStr') text = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')
  else text = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ''
  text = dec(text)
  if (!text.trim() && !f) continue
  const shown = text.replace(/\n/g, '\\n')
  console.log(`${ref}\t${f ? 'FORMULA:' + f : ''}${shown ? 'TEXT:' + JSON.stringify(shown) : ''}`)
}
