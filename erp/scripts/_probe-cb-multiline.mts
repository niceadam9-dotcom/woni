/** 여러 줄 상자 칸의 기하를 **템플릿에서 실측**한다 — 왜 지금 미적용인지, 무엇을 알아야 달 수 있는지.
 *
 *  실행: npx tsx scripts/_probe-cb-multiline.mts
 */
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { FIRE_PLAN_MANIFEST, sheetManifest } from '../src/lib/fire-plan-xlsx-manifest.ts'

const HERE = import.meta.dirname
const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(
  path.join(HERE, '..', 'templates', 'fire-plan-workbook.xlsx'))))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const tgt = new Map<string, string>()
for (const m of relsXml.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) tgt.set(m[1], m[2])
const partOf = new Map<string, string>()
for (const m of wbXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  partOf.set(m[1].replace(/&amp;/g, '&'), 'xl/' + tgt.get(m[2])!.replace(/^\/?xl\//, ''))
}

const styles = await zip.file('xl/styles.xml')!.async('string')
const xfs = [...(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '')
  .matchAll(/<xf\b[\s\S]*?(?:\/>|<\/xf>)/g)].map(m => m[0])
const fonts = [...(/<fonts[^>]*>([\s\S]*?)<\/fonts>/.exec(styles)?.[1] ?? '')
  .matchAll(/<font>[\s\S]*?<\/font>/g)].map(m => m[0])

type Row = {
  sheet: string; cell: string; lines: number; boxes: number; boxesPerLine: number[]
  merge: string; mergeRows: number; mergePx: number; rowsPx: number[]
  vAlign: string; hAlign: string; wrap: boolean; indent: string; fontPt: string
}
const rows: Row[] = []

for (const s of FIRE_PLAN_MANIFEST.sheets) {
  const man = sheetManifest(s.name)
  const xml = await zip.file(partOf.get(s.name)!)!.async('string')
  const defPx = Math.floor(Number(/<sheetFormatPr[^>]*defaultRowHeight="([\d.]+)"/.exec(xml)?.[1] ?? 15) * 4 / 3)
  const rowPx = new Map<number, number>()
  for (const m of xml.matchAll(/<row r="(\d+)"([^>]*)>/g)) {
    const ht = /ht="([\d.]+)"/.exec(m[2])?.[1]
    if (ht) rowPx.set(Number(m[1]), Math.floor(Number(ht) * 4 / 3))
  }
  const mergeOf = new Map<string, { ref: string; end: number }>()
  for (const m of xml.matchAll(/<mergeCell ref="([A-Z]+(\d+):[A-Z]+(\d+))"\/>/g)) {
    mergeOf.set(m[1].split(':')[0], { ref: m[1], end: Number(m[3]) })
  }

  for (const cell of Object.keys(man.boxes)) {
    const label = man.labels[cell]
    if (label === undefined || !label.includes('\n')) continue
    if (!/[□☐]/.test(label.trim()[0] ?? '')) continue
    const row1 = Number(/\d+$/.exec(cell)![0])
    const mg = mergeOf.get(cell)
    const end = mg?.end ?? row1
    const rp: number[] = []
    for (let r = row1; r <= end; r++) rp.push(rowPx.get(r) ?? defPx)

    const sIdx = Number(new RegExp(`<c r="${cell}"[^>]*\\ss="(\\d+)"`).exec(xml)?.[1] ?? 0)
    const xf = xfs[sIdx] ?? ''
    const al = /<alignment[^>]*\/>/.exec(xf)?.[0] ?? ''
    const fid = Number(/fontId="(\d+)"/.exec(xf)?.[1] ?? 0)
    const lines = label.split('\n')
    rows.push({
      sheet: s.name, cell, lines: lines.length,
      boxes: [...label.matchAll(/[□☐]/g)].length,
      boxesPerLine: lines.map(l => [...l.matchAll(/[□☐]/g)].length),
      merge: mg?.ref ?? '(없음)', mergeRows: end - row1 + 1,
      mergePx: rp.reduce((a, b) => a + b, 0), rowsPx: rp,
      vAlign: /vertical="([^"]+)"/.exec(al)?.[1] ?? '(기본=bottom)',
      hAlign: /horizontal="([^"]+)"/.exec(al)?.[1] ?? '(기본)',
      wrap: /wrapText="1"/.test(al),
      indent: /indent="(\d+)"/.exec(al)?.[1] ?? '0',
      fontPt: /<sz val="([\d.]+)"/.exec(fonts[fid] ?? '')?.[1] ?? '?',
    })
  }
}

console.log(`여러 줄 · 상자 선두 칸: ${rows.length}개 · 상자 ${rows.reduce((a, r) => a + r.boxes, 0)}개\n`)
for (const r of rows) {
  console.log(`${r.sheet} ${r.cell}  줄${r.lines}(상자${r.boxesPerLine.join('/')})  `
    + `병합 ${r.merge}(${r.mergeRows}행 ${r.mergePx}px [${r.rowsPx.join('+')}])  `
    + `v=${r.vAlign} h=${r.hAlign} wrap=${r.wrap} indent=${r.indent} ${r.fontPt}pt`)
}

const g = (k: (r: Row) => string) => {
  const m = new Map<string, number>()
  for (const r of rows) m.set(k(r), (m.get(k(r)) ?? 0) + 1)
  return [...m].map(([v, n]) => `${v}×${n}`).join(' · ')
}
console.log(`\n세로정렬: ${g(r => r.vAlign)}`)
console.log(`가로정렬: ${g(r => r.hAlign)}`)
console.log(`줄바꿈:   ${g(r => String(r.wrap))}`)
console.log(`들여쓰기: ${g(r => r.indent)}`)
console.log(`글자크기: ${g(r => r.fontPt)}`)
console.log(`줄 수:    ${g(r => String(r.lines))}`)
console.log(`한 줄에 상자 하나뿐인 칸: ${rows.filter(r => r.boxesPerLine.every(n => n <= 1)).length}`)
console.log(`줄마다 정확히 상자 하나: ${rows.filter(r => r.boxesPerLine.every(n => n === 1)).length}`)
console.log(`첫 줄만 상자 하나(나머지 0): ${rows.filter(r => r.boxesPerLine[0] === 1 && r.boxesPerLine.slice(1).every(n => n === 0)).length}`)
console.log(`\n한 줄에 쓸 수 있는 세로 여유(병합px / 줄수):`)
for (const r of rows) console.log(`  ${(r.mergePx / r.lines).toFixed(1)}px  ${r.sheet} ${r.cell}`)
