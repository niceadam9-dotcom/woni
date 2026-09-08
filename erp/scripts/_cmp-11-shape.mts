/** 리포 「1.1 건축물 일반현황」의 실제 모양 — B안 불일치가 내 정렬 탓인지 시트 탓인지 가른다. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import * as XLSX from 'xlsx'

const HERE = dirname(fileURLToPath(import.meta.url))
const wb = XLSX.read(readFileSync(resolve(HERE, '../templates/fire-plan-workbook.xlsx')), { sheetStubs: true })
const ws = wb.Sheets['1.1 건축물 일반현황']
const r = XLSX.utils.decode_range(ws['!ref']!)
const merges = ws['!merges'] ?? []
console.log(`범위 ${ws['!ref']} · 병합 ${merges.length}\n`)

const mergeAt = (R: number, C: number) => merges.find(m => m.s.r === R && m.s.c === C)
const covered = (R: number, C: number) => merges.find(m => R >= m.s.r && R <= m.e.r && C >= m.s.c && C <= m.e.c && !(m.s.r === R && m.s.c === C))

for (let R = r.s.r; R <= r.e.r; R++) {
  const out: string[] = []
  for (let C = r.s.c; C <= r.e.c; C++) {
    if (covered(R, C)) continue
    const a = XLSX.utils.encode_cell({ r: R, c: C })
    const cell = ws[a]
    const v = cell && cell.v !== undefined ? String(cell.v).replace(/\s+/g, ' ').trim() : ''
    const m = mergeAt(R, C)
    const span = m ? `(${m.e.r - m.s.r + 1}x${m.e.c - m.s.c + 1})` : ''
    out.push(`${a}${span}${v ? `="${v.slice(0, 26)}"` : '=∅'}`)
  }
  console.log(` r${String(R + 1).padStart(2)} | ${out.join('  ')}`)
}
