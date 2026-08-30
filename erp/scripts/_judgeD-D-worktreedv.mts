/** 판정자 D — 타 세션이 재빌드 중인 작업트리 자산에서 「현황」 판정칸 dv 어휘를 다시 본다(읽기 전용) */
import fs from 'node:fs'
import JSZip from 'jszip'

const zip = await JSZip.loadAsync(fs.readFileSync('templates/report-workbook-full.xlsx'))
const wb = await zip.file('xl/workbook.xml')!.async('string')
const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const rel = new Map<string, string>()
for (const m of rels.matchAll(/<Relationship\s([^>]*)\/>/g)) {
  const i = /Id="([^"]+)"/.exec(m[1])?.[1]; const t = /Target="([^"]+)"/.exec(m[1])?.[1]
  if (i && t) rel.set(i, t.replace(/^\/?xl\//, '').replace(/^\.\.\//, ''))
}
let f = ''
for (const m of wb.matchAll(/<sheet\s([^>]*?)\/>/g)) {
  const n = /name="([^"]*)"/.exec(m[1])?.[1]
  if (n === '현황') f = 'xl/' + rel.get(/r:id="([^"]+)"/.exec(m[1])?.[1] ?? '')
}
const x = await zip.file(f)!.async('string')
for (const d of x.matchAll(/<dataValidation\s([^>]*?)(\/>|>([\s\S]*?)<\/dataValidation>)/g)) {
  const raw = /<formula1>([\s\S]*?)<\/formula1>/.exec(d[3] ?? '')?.[1] ?? ''
  const f1 = raw.replace(/&quot;/g, '"')
  if (!/○/.test(f1)) continue
  console.log('WORKTREE 현황 dv formula1 = ' + JSON.stringify(f1)
    + '  cp=' + [...f1].map(c => c.codePointAt(0)!.toString(16)).join(','))
}
