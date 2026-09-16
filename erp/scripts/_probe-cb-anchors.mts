/** 한 시트의 컨트롤 앵커를 그대로 찍는다 — 잘려 그려지는 컨트롤의 정체를 보려고. */
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { firePlanCheckboxCells } from '../src/lib/fire-plan-checkbox-controls.ts'

const file = process.argv[2] ?? path.join(process.env.TEMP ?? '/tmp', 'fireplan-prod.xlsx')
const want = process.argv[3] ?? '1.6.1'
const z = await JSZip.loadAsync(new Uint8Array(readFileSync(file)))
const wb = await z.file('xl/workbook.xml')!.async('string')
const rl = await z.file('xl/_rels/workbook.xml.rels')!.async('string')
const t = new Map<string, string>()
for (const m of rl.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) t.set(m[1], m[2])
const hit = [...wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)]
  .find(m => m[1].replace(/&amp;/g, '&').startsWith(want))!
const sheet = hit[1].replace(/&amp;/g, '&')
const part = 'xl/' + t.get(hit[2])!.replace(/^\/?xl\//, '')
const rel = await z.file(part.replace(/worksheets\/([^/]+)$/, 'worksheets/_rels/$1.rels'))!.async('string')
const vml = await z.file('xl/drawings/' + /Target="\.\.\/drawings\/(vmlDrawing\d+\.vml)"/.exec(rel)![1])!.async('string')
const anc = [...vml.matchAll(/<x:Anchor>([^<]*)<\/x:Anchor>/g)].map(m => m[1].replace(/\s+/g, ''))
const sty = [...vml.matchAll(/margin-left:([\d.]+)pt;margin-top:([\d.]+)pt;width:([\d.]+)pt;height:([\d.]+)pt/g)]
const xml = await z.file(part)!.async('string')
const dim = /<dimension ref="([^"]+)"/.exec(xml)?.[1]
const cells = firePlanCheckboxCells(sheet)
console.log(`${sheet}  컨트롤 ${cells.length} · dimension ${dim}`)
cells.forEach((c, i) => {
  const a = anc[i].split(',').map(Number)
  console.log(`  ${String(i).padStart(2)} ${(c.cell + '#' + c.boxIndex).padEnd(9)} `
    + `from(col ${a[0]},off ${a[1]} · row ${a[2]},off ${a[3]})  to(col ${a[4]},off ${a[5]} · row ${a[6]},off ${a[7]})  `
    + `L/T/W/H ${sty[i] ? sty[i].slice(1).join(' / ') : '?'}`)
})
