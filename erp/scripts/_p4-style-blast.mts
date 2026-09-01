/** 현5 14칸이 쓰는 xf를 **다른 시트가 공유하는지** — wrapText를 켤 때의 파급 범위.
 *  공유한다면 그 xf를 고치는 대신 **복제 xf 신설 후 재지정**해야 한다(남의 시트 렌더를 안 바꾸려면).
 *  ⚠ 셀 정규식 자기닫힘 분기 필수.
 */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'

const TARGET = new Set([336, 337, 339, 340, 342, 343])

const zip = await JSZip.loadAsync(readFileSync('templates/report-workbook-full.xlsx'))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const relMap = new Map([...relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
const sheets = [...wbXml.matchAll(/<sheet[^>]*\sname="([^"]+)"[^>]*r:id="([^"]+)"/g)]
  .map(m => ({ name: m[1], path: 'xl/' + relMap.get(m[2])!.replace(/^\//, '').replace(/^xl\//, '') }))

const usage = new Map<number, Map<string, number>>()
for (const s of sheets) {
  const xml = await zip.file(s.path)!.async('string')
  for (const c of xml.matchAll(/<c\s([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)) {
    const st = /s="(\d+)"/.exec(c[1])?.[1]
    if (!st) continue
    const n = +st
    if (!TARGET.has(n)) continue
    if (!usage.has(n)) usage.set(n, new Map())
    const per = usage.get(n)!
    per.set(s.name, (per.get(s.name) ?? 0) + 1)
  }
}

console.log('xf   total  by sheet')
console.log('-'.repeat(60))
for (const n of [...TARGET].sort((a, b) => a - b)) {
  const per = usage.get(n) ?? new Map()
  const total = [...per.values()].reduce((a, b) => a + b, 0)
  const others = [...per.entries()].filter(([sh]) => sh !== '현5')
  const desc = [...per.entries()].map(([sh, c]) => `${sh}:${c}`).join('  ')
  const flag = others.length ? '  <== SHARED with other sheets' : '  (현5 only)'
  console.log(`${String(n).padEnd(5)}${String(total).padStart(5)}  ${desc}${flag}`)
}
