/** 독립 판정자 A — C-1(결과열을 C로 고정) 사각이 추출기에서 실제로 붉어지는가. 읽기 전용. */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { extractDonorItemMap, readCells } from '../src/lib/xlsx-donor-itemmap-extract.ts'
import { allDonorSheets } from '../src/lib/xlsx-donors.ts'

const zip = await JSZip.loadAsync(readFileSync('templates/report-workbook-full.xlsx'))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const relMap = new Map([...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(x => [x[1], x[2]]))
const dn = new Set(allDonorSheets())
const sheets: Array<{ name: string; xml: string }> = []
for (const x of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  if (!dn.has(x[1])) continue
  sheets.push({ name: x[1], xml: await zip.file('xl/' + relMap.get(x[2])!.replace(/^\/?xl\//, ''))!.async('string') })
}

// 옥3(J열 시트)의 「점검결과」 헤더를 J에서 C로 옮긴다 = C-1 사각 재현
const c = sheets.map(s => ({ name: s.name, xml: s.xml }))
const tgt = c.find(s => s.name === '옥3')!
const val = readCells(tgt.xml).val
const head = [...val].find(([, v]) => v.trim() === '점검결과')![0]
const row = head.replace(/^[A-Z]+/, '')
console.log(`옥3 「점검결과」 헤더 실제 좌표 = ${head}`)
// J헤더 문구를 지우고 같은 행 C에 심는다
tgt.xml = tgt.xml
  .replace(new RegExp(`(<c r="${head}"[^>]*><is><t[^>]*>)점검결과(</t>)`), `$1@@X@@$2`)
  .replace(new RegExp(`(<c r="C${row}"[^>]*><is><t[^>]*>)([\\s\\S]*?)(</t>)`), `$1점검결과$3`)
const ex = extractDonorItemMap(c)
const f2 = ex.failures.filter(f => f.startsWith('F-2') && f.includes('옥3'))
const f5 = ex.failures.filter(f => f.startsWith('F-5') && f.includes('옥3'))
console.log(`결과열 옥3 = ${ex.resultCols['옥3']} (변이 후)`)
console.log(`F-2 옥3 ${f2.length}건 · F-5 옥3 ${f5.length}건 · 총 실패 ${ex.failures.length}`)
console.log(f2.length + f5.length > 0
  ? 'OK   C-1 사각(결과열 C 고정)은 추출기에서 붉어진다'
  : 'FAIL C-1 사각이 조용히 통과한다')
console.log(`표본: ${ex.failures.slice(0, 3).join(' | ')}`)
