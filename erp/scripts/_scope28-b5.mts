/** Phase 3 착수 실측 — 계획서·완료보고서의 반복 행 표와 B5 스포크 사슬을 **원시 XML**로 확인한다.
 *  탐색 에이전트가 '완료보고서!B5는 빈 셀'이라 보고했으나 판정자 A·B는 폐포 8칸에 그 셀을
 *  포함시켰다 — 결론이 충돌하면 요약을 합치지 말고 원본을 읽는다.
 *  실행: node node_modules\tsx\dist\cli.mjs scripts\_scope28-b5.mts */
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
const cells = async (sheet: string) => {
  const xml = await zip.file(sheets.get(sheet)!)!.async('string')
  const map = new Map<string, { f?: string; v?: string; t?: string; text: string }>()
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = /r="([A-Z]+\d+)"/.exec(m[1] ?? '')?.[1]; if (!ref) continue
    const inner = m[2] ?? ''
    const f = /<f[^>]*>([\s\S]*?)<\/f>/.exec(inner)?.[1]
    const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
    const ty = /\st="([^"]+)"/.exec(m[1] ?? '')?.[1]
    const text = ty === 's' && v !== undefined ? (sst[Number(v)] ?? '') : (/<is>[\s\S]*?<\/is>/.test(inner)
      ? [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('') : (v ?? ''))
    map.set(ref, { f, v, t: ty, text })
  }
  return { xml, map }
}

for (const s of ['계획서', '완료보고서']) {
  const { xml, map } = await cells(s)
  OUT.push(`\n===== ${s} (${sheets.get(s)}) · 셀 ${map.size} =====`)
  const merges = [...xml.matchAll(/<mergeCell ref="([^"]+)"/g)].map(m => m[1])
  OUT.push(`병합 ${merges.length}건`)
  // B5 사슬
  for (const ref of ['B5', 'A3', 'B12', 'B19']) {
    const c = map.get(ref)
    OUT.push(`  ${s}!${ref} → ${c ? `t=${c.t ?? '-'} f=${c.f ?? '(없음)'} v=${c.v ?? '-'} text='${c.text}'` : '(셀 XML 부재)'}`)
  }
  // 반복 행 후보 — 값/수식 있는 행을 전부 나열
  const rows = new Map<number, string[]>()
  for (const [ref, c] of map) {
    const r = Number(/\d+/.exec(ref)![0])
    if (!c.text && !c.f) continue
    if (!rows.has(r)) rows.set(r, [])
    rows.get(r)!.push(`${ref}${c.f ? `{=${c.f}}` : ''}='${c.text.slice(0, 22)}'`)
  }
  OUT.push(`  -- 내용 있는 행 --`)
  for (const r of [...rows.keys()].sort((a, b) => a - b))
    OUT.push(`   r${r}: ${rows.get(r)!.slice(0, 6).join(' | ')}`)
}
writeFileSync('F:/AI/ERP/_scope28-b5.txt', OUT.join('\n') + '\n', 'utf8')
console.log(OUT.join('\n'))
