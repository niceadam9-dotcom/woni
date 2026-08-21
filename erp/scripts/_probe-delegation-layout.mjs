/** 소방계획서_27 — 위임장·공문 시트 셀 덤프 (앵커 라벨 실측용)
 *  실행: node scripts/_probe-delegation-layout.mjs */
import XLSX from 'xlsx'
import { readFileSync } from 'node:fs'

const wb = XLSX.read(readFileSync('F:/AI/ERP/erp/보고서 갑지.xls'), { cellFormula: true })
for (const name of ['위임장', '공문', '계약서']) {
  const ws = wb.Sheets[name]
  console.log(`\n━━ ${name} (${ws['!ref']}) ━━`)
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      const ref = XLSX.utils.encode_cell({ r, c })
      const cell = ws[ref]
      if (!cell || cell.v === undefined || String(cell.v).trim() === '') continue
      cells.push(`${ref}=${JSON.stringify(cell.v)}${cell.f ? `[f:${cell.f}]` : ''}`)
    }
    if (cells.length) console.log(`  ${cells.join(' · ')}`)
  }
}
