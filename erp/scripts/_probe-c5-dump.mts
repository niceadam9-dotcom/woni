import { readFileSync } from 'fs'
import JSZip from 'jszip'
const OPERATOR = /승진|덕평|2020-01|772-3019|586-86|김흥준|김 흥 준|잿말길|772-2419/
for (const f of ['templates/report-workbook-full.xlsx', 'templates/fire-plan-workbook.xlsx']) {
  const zip = await JSZip.loadAsync(readFileSync(f))
  const dec = (s: string) => s.replace(/&#10;/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  const seen = new Map<string, string[]>()
  const add = (s: string, where: string) => { if (OPERATOR.test(s)) seen.set(s, [...(seen.get(s) ?? []), where]) }
  const ss = zip.file('xl/sharedStrings.xml')
  if (ss) { let i = 0; for (const si of (await ss.async('string')).match(/<si>[\s\S]*?<\/si>/g) ?? []) add(dec([...si.replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join('')), `si${i++}`) }
  for (const p of Object.keys(zip.files).filter(p => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))) {
    const xml = await zip.file(p)!.async('string')
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*t="inlineStr"[^>]*><is>([\s\S]*?)<\/is>/g)) add(dec([...m[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')), `${p.slice(14)}!${m[1]}(is)`)
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*t="str"[^>]*>[\s\S]*?<v>([\s\S]*?)<\/v>/g)) add(dec(m[2]), `${p.slice(14)}!${m[1]}(str)`)
  }
  console.log(`\n=== ${f} — 서로 다른 문자열 ${seen.size}`)
  for (const [s, w] of seen) console.log(`  ${JSON.stringify(s)}  ← ${w.slice(0, 4).join(',')}${w.length > 4 ? ` 외 ${w.length - 4}` : ''}`)
}
