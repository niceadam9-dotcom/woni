/** 판정자 G-A — S0-1b 부록: LibreOffice가 **어느 키를** 바꾸는지 키별로 분해한다.
 *  27.json S0-1b의 desc는 "header/footer를 0.3in → 0.511811in으로 정규화한다.
 *  left/right/top/bottom은 보존"이라고 단언한다. 그 단언을 실측으로 검증한다. */
import JSZip from 'jszip'
import XLSX from 'xlsx'
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = 'F:/AI/ERP/erp/보고서 갑지.xls'
const CONV = 'F:/AI/ERP/erp/.judge27g/conv/보고서 갑지.xlsx'
const OUT = 'F:/AI/ERP/erp/.judge27g/a-marginbreak.txt'
const KEYS = ['left', 'right', 'top', 'bottom', 'header', 'footer'] as const

const zip = await JSZip.loadAsync(new Uint8Array(readFileSync(CONV)))
const wbXml = await zip.file('xl/workbook.xml')!.async('string')
const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
const rel = new Map([...relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]))
const files = new Map<string, string>()
for (const m of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
  const t = rel.get(m[2]) ?? ''
  files.set(m[1], t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`)
}
const orig = XLSX.read(readFileSync(SRC), { cellStyles: true })

const lines: string[] = []
const changed: Record<string, number> = {}
const same: Record<string, number> = {}
for (const k of KEYS) { changed[k] = 0; same[k] = 0 }
const rows: string[] = []
for (const [name, path] of files) {
  const o = (orig.Sheets[name] as Record<string, unknown>)?.['!margins'] as Record<string, number> | undefined
  if (!o) continue
  const xml = await zip.file(path)!.async('string')
  const pm = /<pageMargins([^>]*)\/>/.exec(xml)?.[1] ?? ''
  const g = Object.fromEntries([...pm.matchAll(/(\w+)="([^"]+)"/g)].map(x => [x[1], Number(x[2])])) as Record<string, number>
  const diffs = KEYS.filter(k => Math.abs((g[k] ?? NaN) - o[k]) >= 1e-9)
  for (const k of KEYS) (diffs.includes(k) ? changed : same)[k]++
  rows.push(`${name.padEnd(10)} 바뀐키=${diffs.join(',') || '(없음)'}`)
}
lines.push('=== LibreOffice .xls→.xlsx 변환이 인쇄여백의 어느 키를 바꾸는가 (26시트) ===')
lines.push('')
lines.push('키별 변경 시트 수 (원본 대비):')
for (const k of KEYS) lines.push(`  ${k.padEnd(7)} 변경 ${String(changed[k]).padStart(2)}시트 · 불변 ${String(same[k]).padStart(2)}시트`)
lines.push('')
lines.push(`총 어긋난 (시트,키) 쌍 = ${Object.values(changed).reduce((a, b) => a + b, 0)}`)
lines.push('')
lines.push('27.json S0-1b desc 단언 검증:')
const hfAll = changed.header + changed.footer
const lrtbAll = changed.left + changed.right + changed.top + changed.bottom
lines.push(`  "header/footer를 정규화한다"            -> ${hfAll > 0 ? '참' : '거짓'} (header ${changed.header}/26 · footer ${changed.footer}/26 시트 변경)`)
lines.push(`  "left/right/top/bottom은 보존"          -> ${lrtbAll === 0 ? '참' : '거짓'} (실측 ${lrtbAll}개 (시트,키) 쌍이 변경됨)`)
lines.push(`  "0.3in -> 0.511811in"                  -> 원본 header 고유값이 8종이라 '0.3'은 26시트 중 ${Object.values(orig.SheetNames).filter(s => { const m = (orig.Sheets[s] as Record<string, unknown>)['!margins'] as Record<string, number> | undefined; return m && Math.abs(m.header - 0.3) < 1e-9 }).length}시트뿐. 산출은 전 시트가 0.511811로 획일화됨`)
lines.push('')
lines.push('원본 header 고유값: ' + [...new Set(orig.SheetNames.map(s => ((orig.Sheets[s] as Record<string, unknown>)['!margins'] as Record<string, number> | undefined)?.header).filter(v => v !== undefined))].join(', '))
lines.push('원본 footer 고유값: ' + [...new Set(orig.SheetNames.map(s => ((orig.Sheets[s] as Record<string, unknown>)['!margins'] as Record<string, number> | undefined)?.footer).filter(v => v !== undefined))].join(', '))
lines.push('')
lines.push('시트별 바뀐 키:')
lines.push(...rows.map(r => '  ' + r))
lines.push('')
lines.push('※ 이미 0.511811인 시트(위임장/계약서 계열)는 header/footer가 우연히 불변 —')
lines.push('   "변환본에 0.511811이 있으면 미복원"이라는 식의 판정은 오탐/누락 양쪽으로 틀린다.')
writeFileSync(OUT, lines.join('\n') + '\n', 'utf8')
console.log('WROTE', OUT)
