/** 갑지 전 시트 × 앵커 배선 커버리지 실측 — 어느 시트가 몇 칸 배선됐고 어느 시트가 0칸인지.
 *  추가로 시트별 '입력 성격 칸'(마크 [  ] / write-in 괄호 슬롯) 수를 세어 미배선 규모를 가늠한다. */
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { ANCHORS } from '../src/lib/xlsx-anchors.ts'

const zip = await JSZip.loadAsync(readFileSync('templates/report-workbook-full.xlsx'))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const relMap = new Map([...relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
const sheets = [...wbXml.matchAll(/<sheet[^>]*\sname="([^"]+)"[^>]*r:id="([^"]+)"(?:[^>]*state="([^"]+)")?/g)]
  .map(m => ({ name: m[1], path: 'xl/' + relMap.get(m[2])!.replace(/^\//, '').replace(/^xl\//, ''), state: m[3] ?? 'visible' }))

let shared: string[] = []
const ssFile = zip.file('xl/sharedStrings.xml')
if (ssFile) {
  const ss = await ssFile.async('string')
  shared = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''))
}

const anchorsBySheet = new Map<string, number>()
for (const a of ANCHORS) anchorsBySheet.set(a.sheet, (anchorsBySheet.get(a.sheet) ?? 0) + 1)

console.log('시트명\t상태\t앵커수\t마크칸\t슬롯칸\t수식칸\t문자칸')
for (const s of sheets) {
  const xml = await zip.file(s.path)!.async('string')
  let marks = 0, slots = 0, formulas = 0, texts = 0
  for (const m of xml.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1], body = m[2] ?? ''
    if (/<f[ >]/.test(body)) { formulas++; continue }
    const t = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n'
    let text = ''
    if (t === 's') { const v = /<v>(\d+)<\/v>/.exec(body)?.[1]; if (v != null) text = shared[+v] ?? '' }
    else if (t === 'inlineStr') text = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')
    if (!text.trim()) continue
    texts++
    if (/\[\s*[√✓✔]?\s*\]/.test(text)) marks++
    if (/[(（][ 　]*[)）]/.test(text)) slots++
  }
  console.log(`${s.name}\t${s.state}\t${anchorsBySheet.get(s.name) ?? 0}\t${marks}\t${slots}\t${formulas}\t${texts}`)
}
