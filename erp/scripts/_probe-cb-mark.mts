/** 렌더 차이로 상자 위치를 재기 위한 **표식본** 만들기.
 *
 *  글꼴 대체(상자는 SegoeUISymbol)·`fitToPage` 축소·`TJ` 자간 때문에 글자 폭을 모델로 맞출 수 없다.
 *  그래서 재지 않고 **그리는 주체에게 묻는다**: 표식본을 굽고 기준본과 픽셀을 뺀다.
 *
 *  🚨 표식은 **글자를 바꾸지 않고 색만 바꾼다**(서식 런). 처음엔 `□`→`■`로 바꿨는데 두 글자의
 *    전진 폭이 달라 **뒤 글자가 통째로 밀렸고**, 차이가 줄 전체로 번져 측정이 불가능했다
 *    (자기검사가 그걸 잡아 수치를 못 쓰게 막았다). 글리프·크기가 같아야 배치가 안 흔들린다.
 *
 *  실행: npx tsx scripts/_probe-cb-mark.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { FIRE_PLAN_MANIFEST } from '../src/lib/fire-plan-xlsx-manifest.ts'
import { firePlanCheckboxCells } from '../src/lib/fire-plan-checkbox-controls.ts'
import { multiBoxCells } from './_cb-targets.mts'

const HERE = import.meta.dirname
const T = process.env.TEMP ?? '/tmp'
const TPL = path.join(HERE, '..', 'templates', 'fire-plan-workbook.xlsx')
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

const bytes = new Uint8Array(readFileSync(TPL))
writeFileSync(path.join(T, 'cb-base.xlsx'), Buffer.from(bytes))

const zip = await JSZip.loadAsync(bytes)
const wb = await zip.file('xl/workbook.xml')!.async('string')
const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const tgt = new Map<string, string>()
for (const m of rels.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) tgt.set(m[1], m[2])
const partOf = new Map<string, string>(); const indexOf = new Map<string, number>()
let n = 0
for (const m of wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  const name = m[1].replace(/&amp;/g, '&')
  partOf.set(name, 'xl/' + tgt.get(m[2])!.replace(/^\/?xl\//, '')); indexOf.set(name, ++n)
}

const targetsOf = (sheet: string): string[] => {
  const set = new Set(firePlanCheckboxCells(sheet).map(c => c.cell))
  for (const c of multiBoxCells(sheet)) set.add(c.cell)
  return [...set]
}

/** `<t>글</t>` → 상자 글자만 빨간 런으로 감싼 `<r>` 열 */
function colorBoxes(text: string): string {
  const parts: string[] = []
  let buf = ''
  const flush = () => { if (buf) { parts.push(`<r><t xml:space="preserve">${esc(buf)}</t></r>`); buf = '' } }
  for (const ch of text) {
    if (/[□☐]/.test(ch)) {
      flush()
      parts.push(`<r><rPr><color rgb="FFFF0000"/></rPr><t xml:space="preserve">${esc(ch)}</t></r>`)
    } else buf += ch
  }
  flush()
  return parts.join('')
}

const sheetsWithMulti = FIRE_PLAN_MANIFEST.sheets.map(s => s.name).filter(s => multiBoxCells(s).length)
let marked = 0
for (const name of FIRE_PLAN_MANIFEST.sheets.map(s => s.name)) {
  const cells = targetsOf(name)
  if (!cells.length) continue
  const p = partOf.get(name)!
  let xml = await zip.file(p)!.async('string')
  for (const ref of cells) {
    const re = new RegExp(`<c r="${ref}"((?:[^>/]|/(?!>))*)>([\\s\\S]*?)</c>`)
    const m = re.exec(xml)
    if (!m) continue
    const tm = /<t[^>]*>([\s\S]*?)<\/t>/.exec(m[2])
    if (!tm) continue
    const text = unesc(tm[1])
    marked += (text.match(/[□☐]/g) ?? []).length
    const patched = m[0].replace(/<is>[\s\S]*?<\/is>/, () => `<is>${colorBoxes(text)}</is>`)
    xml = xml.replace(m[0], () => patched)
  }
  zip.file(p, xml)
}
writeFileSync(path.join(T, 'cb-marked.xlsx'), Buffer.from(await zip.generateAsync({ type: 'uint8array' })))

console.log(`표식(색만 바꿈) ${marked}개 상자`)
console.log(`  기준본 : ${path.join(T, 'cb-base.xlsx')}`)
console.log(`  표식본 : ${path.join(T, 'cb-marked.xlsx')}`)
console.log(`CB_SHOT_INDEX=${sheetsWithMulti.map(s => indexOf.get(s)).join(',')}`)
