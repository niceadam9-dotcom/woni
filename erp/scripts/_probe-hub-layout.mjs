/** 소방계획서_27 — 개요(허브) 시트 전 셀 덤프. 앵커 맵 설계의 원천 자료.
 *  실행: node scripts/_probe-hub-layout.mjs */
import XLSX from 'xlsx'
import { readFileSync } from 'node:fs'

const wb = XLSX.read(readFileSync('F:/AI/ERP/erp/보고서 갑지.xls'), { cellFormula: true })
const ws = wb.Sheets['개요']
console.log('범위:', ws['!ref'])
const range = XLSX.utils.decode_range(ws['!ref'])
for (let r = range.s.r; r <= range.e.r; r++) {
  const cells = []
  for (let c = range.s.c; c <= range.e.c; c++) {
    const ref = XLSX.utils.encode_cell({ r, c })
    const cell = ws[ref]
    if (!cell || cell.v === undefined || cell.v === '') continue
    cells.push(`${ref}=${JSON.stringify(cell.v)}${cell.f ? `[f:${cell.f}]` : ''}`)
  }
  if (cells.length) console.log(`행${r + 1}: ${cells.join(' · ')}`)
}
// 병합 정보 — 라벨/값 칸의 실제 경계 파악용
console.log('\n병합(처음 40):')
for (const m of (ws['!merges'] ?? []).slice(0, 40))
  console.log(`  ${XLSX.utils.encode_range(m)}`)
