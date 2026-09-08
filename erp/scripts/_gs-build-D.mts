/** D안 — 리포 구조(1 hwp열 = 1 엑셀열) + **원본 치수를 열 폭으로 명시**.
 *
 *  A안(sj 71열)도 B안(리포 10열)도 열 폭이 하나도 정의돼 있지 않아, 칸 비율이 '병합이 몇 칸을
 *  먹는가'로만 정해진다(양자화). 그런데 양식 hwpx에는 `hp:cellSz`로 **실제 치수**가 들어 있다.
 *  열 폭·행 높이를 그 값으로 박으면 양자화 오차가 사라진다 — 미세 격자를 손으로 만들 이유가 없다.
 *
 *  실행: npx tsx scripts/_gs-build-D.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import JSZip from 'jszip'
import { parseTables, columnEdges, rowHeights, hwpToPx, pxToColWidth, hwpToPt } from '../src/lib/hwpx-table.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const HWPX = resolve(HERE, '../../erp_goal/_Data/양식-placeholder.hwpx')
const SRC = 'F:\\AI\\sjfire\\_강순기_형식비교\\B_리포형식_강순기_서식1.1.xlsx'
const OUT = 'F:\\AI\\sjfire\\_강순기_형식비교\\D_치수명시_강순기_서식1.1.xlsx'
const SHEET = '1.1 건축물 일반현황'

const zipF = await JSZip.loadAsync(readFileSync(HWPX))
const tables = parseTables(await zipF.file('Contents/section0.xml')!.async('string'))
const t = tables.find(x => x.cells.some(c => c.text.replace(/\s/g, '').includes('도로명주소')))!

const edges = columnEdges(t)
const widths = Array.from({ length: t.colCnt }, (_, i) => edges[i + 1] - edges[i])
const heights = rowHeights(t)
console.log(`양식 서식1.1: ${t.rowCnt}행×${t.colCnt}열`)
console.log('열 폭(HWPUNIT): ' + widths.join(' '))
console.log('열 폭(엑셀):   ' + widths.map(w => pxToColWidth(hwpToPx(w)).toFixed(2)).join(' '))
console.log('행 높이(pt):   ' + heights.map(h => hwpToPt(h).toFixed(1)).join(' '))

/* ── 시트 XML에 <cols> 주입 + 행 ht 지정 ── */
const zip = await JSZip.loadAsync(readFileSync(SRC))
const wbx = await zip.file('xl/workbook.xml')!.async('string')
const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const sm = [...wbx.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/g)].find(m => m[1] === SHEET)!
const rm = [...rels.matchAll(/Id="([^"]*)"[^>]*Target="([^"]*)"/g)].find(m => m[1] === sm[2])!
const xmlName = 'xl/' + rm[2].replace(/^\/?xl\//, '')
let xml = await zip.file(xmlName)!.async('string')

/* 배너 3행(제1장·서식1.1·※)이 앞에 있으므로 표 본체는 4행부터다 */
const BANNER = 3

const colsXml = '<cols>' + widths.map((w, i) => {
  const excel = Math.max(1.5, pxToColWidth(hwpToPx(w)))
  return `<col min="${i + 1}" max="${i + 1}" width="${excel.toFixed(2)}" customWidth="1"/>`
}).join('') + '</cols>'

if (/<cols>[\s\S]*?<\/cols>/.test(xml)) xml = xml.replace(/<cols>[\s\S]*?<\/cols>/, colsXml)
else xml = xml.replace(/(<sheetData)/, `${colsXml}$1`)
console.log(`\n<cols> ${widths.length}열 주입`)

/* 행 높이 — 배너 뒤로 밀어 적용 */
let rowsSet = 0
for (let i = 0; i < heights.length; i++) {
  const r = BANNER + i + 1
  const pt = Math.max(12, hwpToPt(heights[i]))
  const re = new RegExp(`<row r="${r}"([^>]*)>`)
  const m = xml.match(re)
  if (!m) continue
  let attrs = m[1].replace(/\s*ht="[^"]*"/, '').replace(/\s*customHeight="[^"]*"/, '')
  xml = xml.replace(re, `<row r="${r}"${attrs} ht="${pt.toFixed(1)}" customHeight="1">`)
  rowsSet++
}
console.log(`행 높이 ${rowsSet}행 지정`)

zip.file(xmlName, xml)
/* 렌더용으로 이 시트만 남긴다 */
const all = [...wbx.matchAll(/<sheet\b[^>]*\/>/g)].map(m => m[0])
const keep = all.find(s => s.includes(`name="${SHEET}"`))!
let w2 = wbx
for (const s of all) if (s !== keep) w2 = w2.replace(s, '')
w2 = w2.replace(/activeTab="\d+"/, 'activeTab="0"')
zip.file('xl/workbook.xml', w2)

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
console.log(`\n✅ → ${OUT}`)
