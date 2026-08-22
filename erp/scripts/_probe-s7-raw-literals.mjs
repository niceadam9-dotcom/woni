// S7-1·2 통문자열 원문 실측 — 주입값 조립은 이 원문과 자구 일치해야 한다
import XLSX from 'xlsx'
import { readFileSync } from 'node:fs'
const wb = XLSX.read(readFileSync('templates/report-workbook.xlsx'), { cellStyles: true })
const dump = (s, c) => {
  const cell = wb.Sheets[s]?.[c]
  console.log(`${s}!${c}`, JSON.stringify(cell?.v ?? null))
}
dump('보고서', 'A2')
dump('보고서', 'B9')
dump('보고서', 'B10')
dump('보고서', 'B11')
dump('보고서', 'C13')
dump('보고서', 'C17')
dump('보고서', 'D17')
dump('보고서', 'E17')
dump('정보', 'B5')
// 새 앵커 셀 XML 실재 여부 (없는 셀 삽입 불가 — S0-5 축)
import JSZip from 'jszip'
const zip = await JSZip.loadAsync(readFileSync('templates/report-workbook.xlsx'))
const wbXml = await zip.file('xl/workbook.xml').async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string')
const rel = new Map([...relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
const fileOf = new Map()
for (const m of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) fileOf.set(m[1], `xl/${rel.get(m[2])}`)
const targets = [
  ['개요', ['C1', 'D1', 'B18', 'B20',
    ...[2, 3, 4, 5, 6, 7, 8].flatMap(n => [`B${n}`, `C${n}`, `D${n}`, `E${n}`])]],
  ['보고서', ['A2', 'B9', 'B10', 'B11', 'C13', 'C17', 'D17', 'E17']],
  ['정보', ['B5']],
]
for (const [sheet, cells] of targets) {
  const xml = await zip.file(fileOf.get(sheet)).async('string')
  const absent = cells.filter(c => !new RegExp(`<c r="${c}"[ />]`).test(xml))
  console.log(`${sheet}: ${cells.length}칸 중 XML 부재`, absent.length ? absent.join(',') : '0')
}
