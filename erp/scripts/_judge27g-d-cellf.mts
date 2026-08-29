/** 판정자 D — 좌표 몇 개의 <f>/<v>를 원시 XML에서 그대로 보여 준다(오독 방지용 확인 도구).
 *  실행: npx tsx scripts/_judge27g-d-cellf.mts <xlsx> <시트!셀> [시트!셀 …] */
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(process.argv[2])))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const rels = new Map<string, string>()
for (const m of relXml.matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g))
  rels.set(m[1], 'xl/' + m[2].replace(/^\/?xl\//, '').replace(/^\.\//, ''))
const part = new Map<string, string>()
for (const m of wbXml.matchAll(/<sheet\b[^>]*\/>/g)) {
  const nm = /name="([^"]*)"/.exec(m[0])?.[1], rid = /r:id="([^"]*)"/.exec(m[0])?.[1]
  if (nm && rid && rels.has(rid)) part.set(unesc(nm), rels.get(rid)!)
}
for (const arg of process.argv.slice(3)) {
  const [sheet, ref] = arg.split('!')
  const p = part.get(sheet)
  if (!p) { console.log(`${arg}: 시트 없음`); continue }
  const xml = await zip.file(p)!.async('string')
  const m = new RegExp(`<c r="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`).exec(xml)
  console.log(`${arg}: ${m ? m[0].slice(0, 200) : '(셀 없음)'}`)
}
