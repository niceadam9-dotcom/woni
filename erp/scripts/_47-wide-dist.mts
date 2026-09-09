/** B-11 진단 — manifest gridTops[].cols에서 표 열 수를 역산한 wide 판정 vs v6 실측 orientation 대조.
 *  실행: npx tsx scripts/_47-wide-dist.mts [v6.xlsx]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import JSZip from 'jszip'

const HERE = dirname(fileURLToPath(import.meta.url))
const V6 = process.argv[2] ?? 'F:\\AI\\sjfire\\_강순기_형식비교\\강순기_소방계획서_v6.xlsx'

interface GT { table: number; top: number; rows: number; cols?: number[] }
interface MSheet { name: string; no: string | null; cols: number; gridTops: GT[] }
const manifest = JSON.parse(readFileSync(resolve(HERE, '../src/lib/fire-plan-xlsx-manifest.json'), 'utf8')) as { sheets: MSheet[] }

const calc = manifest.sheets.map(s => {
  const gts = s.gridTops ?? []
  const counts = gts.map(g => (g.cols ?? []).length - 1)
  const maxCols = counts.length ? Math.max(...counts) : 0
  return { name: s.name, maxCols, wide: maxCols >= 14 }
})
console.log(`manifest 판정: 가로 ${calc.filter(x => x.wide).length} · 세로 ${calc.filter(x => !x.wide).length}`)
console.log('가로 목록:', calc.filter(x => x.wide).map(x => `${x.name}(${x.maxCols})`).join(', '))

const zip = await JSZip.loadAsync(readFileSync(V6))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const names = [...wbXml.matchAll(/<sheet name="([^"]+)"/g)].map(x => x[1])
const land: string[] = []
for (let i = 0; i < names.length; i++) {
  const x = await zip.file(`xl/worksheets/sheet${i + 1}.xml`)!.async('string')
  if (/orientation="landscape"/.test(x)) land.push(names[i])
}
console.log(`\nv6 실측: 가로 ${land.length} · 세로 ${names.length - land.length}`)
console.log('v6 가로 목록:', land.join(', '))

const calcSet = new Set(calc.filter(x => x.wide).map(x => x.name))
const onlyCalc = calc.filter(x => x.wide && !land.includes(x.name)).map(x => x.name)
const onlyV6 = land.filter(n => !calcSet.has(n))
console.log('\n차이(계산에만):', onlyCalc.length ? onlyCalc.join(', ') : '없음')
console.log('차이(v6에만):', onlyV6.length ? onlyV6.join(', ') : '없음')
console.log(onlyCalc.length === 0 && onlyV6.length === 0 ? '✅ 집합 일치' : '❌ 집합 불일치')
