/** S9-1 착수 견적 — 계획서가 의존하는 `현5`(별지 4호 불량 세부) 7행의 실제 구조.
 *  계획서!C12~C24{=현5!A4..A10}(설비명) · H12~H24{=현5!C4..C10}(이행조치 내용)이 유일한 의존점이다.
 *  S9-1 전체(현황·현1~현5)가 아니라 **이 7행만**이 Phase 3의 선행 조건인지 가른다.
 *  실행: node node_modules\tsx\dist\cli.mjs scripts\_scope29-hyeon5.mts */
import JSZip from 'jszip'
import { readFileSync, writeFileSync } from 'node:fs'

const zip = await JSZip.loadAsync(new Uint8Array(readFileSync('templates/report-workbook-full.xlsx')))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const rid = new Map([...relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
const sheets = new Map<string, string>()
for (const m of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  const t = rid.get(m[2]); if (t) sheets.set(m[1], 'xl/' + t.replace(/^\/?xl\//, ''))
}
const sst = [...(await zip.file('xl/sharedStrings.xml')!.async('string')).matchAll(/<si>([\s\S]*?)<\/si>/g)]
  .map(m => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''))

const OUT: string[] = []
const dump = async (sheet: string, maxRow: number) => {
  const path = sheets.get(sheet)
  if (!path) { OUT.push(`\n===== ${sheet} — 시트 없음 =====`); return }
  const xml = await zip.file(path)!.async('string')
  OUT.push(`\n===== ${sheet} (${path}) · 병합 ${[...xml.matchAll(/<mergeCell ref="/g)].length}건 =====`)
  const rows = new Map<number, string[]>()
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = /r="([A-Z]+\d+)"/.exec(m[1] ?? '')?.[1]; if (!ref) continue
    const r = Number(/\d+/.exec(ref)![0]); if (r > maxRow) continue
    const inner = m[2] ?? ''
    const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(inner)?.[1]
    const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
    const ty = /\st="([^"]+)"/.exec(m[1] ?? '')?.[1]
    const text = ty === 's' && v !== undefined ? (sst[Number(v)] ?? '')
      : (inner.includes('<is>') ? [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('') : (v ?? ''))
    if (!text && !f) continue
    if (!rows.has(r)) rows.set(r, [])
    rows.get(r)!.push(`${ref}${f ? `{=${f}}` : ''}${text ? `='${text.slice(0, 28)}'` : ''}`)
  }
  for (const r of [...rows.keys()].sort((a, b) => a - b))
    OUT.push(`  r${r}: ${rows.get(r)!.slice(0, 8).join(' | ')}`)
}

await dump('현5', 14)
await dump('개요', 10)
// 계획서가 보는 정확한 좌표만 따로 못박는다
const h5 = await zip.file(sheets.get('현5')!)!.async('string')
OUT.push('\n----- 계획서가 참조하는 14칸 -----')
for (const ref of ['A4','A5','A6','A7','A8','A9','A10','B4','B5','B6','B7','B8','B9','B10','C4','C5','C6','C7','C8','C9','C10']) {
  const m = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`).exec(h5)
  const inner = m?.[2] ?? ''
  const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(inner)?.[1]
  const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
  const ty = /\st="([^"]+)"/.exec(m?.[1] ?? '')?.[1]
  const text = ty === 's' && v !== undefined ? sst[Number(v)] : (inner.includes('<is>')
    ? [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('') : v)
  OUT.push(`  현5!${ref} → ${m ? `f=${f ?? '(없음)'} v=${v ?? '-'} text='${text ?? ''}'` : '❌ 셀 XML 부재(삽입 불가)'}`)
}
writeFileSync('F:/AI/ERP/_scope29-hyeon5.txt', OUT.join('\n') + '\n', 'utf8')
console.log(OUT.join('\n'))
