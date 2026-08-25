/** 현황 시트 특정 행 전수 덤프(열 A~AZ) — 마크칸·라벨·판정칸 좌표 실측 */
import XLSX from 'xlsx'
import { readFileSync } from 'node:fs'

const wb = XLSX.read(readFileSync(process.argv[2] ?? 'templates/report-workbook.xlsx'), { cellFormula: true })
const ws = wb.Sheets[process.argv[3] ?? '현황']
const rows = (process.argv[4] ?? '6-13').split(',').flatMap(r => {
  const [a, b] = r.split('-').map(Number)
  return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i)
})
for (const r of rows) {
  const out: string[] = []
  for (const k of Object.keys(ws)) {
    if (k.startsWith('!')) continue
    const p = XLSX.utils.decode_cell(k)
    if (p.r + 1 !== r) continue
    const c = ws[k] as XLSX.CellObject
    const v = String(c.v ?? '').trim()
    if (!v && !c.f) continue
    out.push(`${k}=${c.f ? `{${c.f}}` : ''}${JSON.stringify(v)}`)
  }
  out.sort((a, b) => {
    const ca = XLSX.utils.decode_cell(a.split('=')[0]).c
    const cb = XLSX.utils.decode_cell(b.split('=')[0]).c
    return ca - cb
  })
  console.log(`행 ${r}: ${out.join('  ')}`)
}
