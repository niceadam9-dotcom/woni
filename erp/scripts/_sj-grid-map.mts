/** sj_계획서.xlsx 「소방안전관리계획 (3)」의 격자 지도 — 라벨 옆의 **값 칸**이 어디인지 실측한다.
 *  병합 영역을 전부 뽑아 행별로 늘어놓으면 '라벨 다음 병합'이 곧 값 자리다. 읽기 전용. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import * as XLSX from 'xlsx'

const HERE = dirname(fileURLToPath(import.meta.url))
const wb = XLSX.read(readFileSync(resolve(HERE, '../../erp_goal/_doc01/sj_계획서.xlsx')), { cellStyles: true, sheetStubs: true })
const name = '소방안전관리계획 (3)'
const ws = wb.Sheets[name]
const merges = ws['!merges'] ?? []
const cols = ws['!cols'] ?? []
const rows = ws['!rows'] ?? []

console.log(`[${name}] ${ws['!ref']} · 병합 ${merges.length} · 열정의 ${cols.length} · 행정의 ${rows.length}\n`)

console.log('── 열 폭 (0=A) ──')
console.log(cols.map((c, i) => `${XLSX.utils.encode_col(i)}:${c?.wch != null ? (+c.wch).toFixed(1) : (c?.wpx ?? '-')}`).join(' '))

console.log('\n── 행 높이 ──')
console.log(rows.map((r, i) => r?.hpt != null ? `${i + 1}:${(+r.hpt).toFixed(0)}` : null).filter(Boolean).join(' '))

console.log('\n── 병합 영역 (행 순) ──')
const val = (r: number, c: number) => {
  const cell = ws[XLSX.utils.encode_cell({ r, c })]
  return cell && cell.v !== undefined ? String(cell.v).replace(/\s+/g, ' ').trim() : ''
}
const sorted = [...merges].sort((a, b) => a.s.r - b.s.r || a.s.c - b.s.c)
let curRow = -1
for (const m of sorted) {
  if (m.s.r !== curRow) { curRow = m.s.r; process.stdout.write(`\n r${String(curRow + 1).padStart(2)} | `) }
  const a = XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })
  const b = XLSX.utils.encode_cell({ r: m.e.r, c: m.e.c })
  const v = val(m.s.r, m.s.c)
  process.stdout.write(`${a}:${b}${v ? `="${v.slice(0, 22)}"` : ''}  `)
}
console.log('\n')
