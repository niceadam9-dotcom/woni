/** sj_계획서.xlsx ↔ templates/fire-plan-workbook.xlsx 관계 실측 (읽기 전용).
 *  '와같이 만들어줘'의 대상이 이미 있는 것인지, 다른 것인지부터 가른다. */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import * as XLSX from 'xlsx'

const HERE = dirname(fileURLToPath(import.meta.url))
const SJ = resolve(HERE, '../../erp_goal/_doc01/sj_계획서.xlsx')
const TPL = resolve(HERE, '../templates/fire-plan-workbook.xlsx')

function summary(p: string, label: string) {
  if (!existsSync(p)) { console.log(`${label}: 없다`); return null }
  const wb = XLSX.read(readFileSync(p), { sheetStubs: true })
  console.log(`\n══ ${label} — 시트 ${wb.SheetNames.length}개`)
  for (const n of wb.SheetNames) {
    const ws = wb.Sheets[n]
    const ref = ws['!ref'] ?? ''
    const merges = (ws['!merges'] ?? []).length
    let filled = 0
    if (ref) {
      const r = XLSX.utils.decode_range(ref)
      for (let R = r.s.r; R <= r.e.r; R++) for (let C = r.s.c; C <= r.e.c; C++) {
        const c = ws[XLSX.utils.encode_cell({ r: R, c: C })]
        if (c && c.v !== undefined && String(c.v).trim() !== '') filled++
      }
    }
    console.log(`   ${n.padEnd(28)} ${ref.padEnd(12)} 값 ${String(filled).padStart(4)} · 병합 ${merges}`)
  }
  return wb
}

const sj = summary(SJ, 'sj_계획서.xlsx (사용자 목표 형식)')
summary(TPL, 'templates/fire-plan-workbook.xlsx (soban42 산출물)')

/* sj의 본체 시트 전체 덤프 — 라벨이 어디까지 있는지 */
if (sj) {
  const n = sj.SheetNames[sj.SheetNames.length - 1]
  const ws = sj.Sheets[n]
  console.log(`\n══ [${n}] 전체 값 셀`)
  const r = XLSX.utils.decode_range(ws['!ref']!)
  for (let R = r.s.r; R <= r.e.r; R++) {
    const out: string[] = []
    for (let C = r.s.c; C <= r.e.c; C++) {
      const a = XLSX.utils.encode_cell({ r: R, c: C })
      const c = ws[a]
      if (c && c.v !== undefined && String(c.v).trim() !== '') out.push(`${a}=${String(c.v).replace(/\s+/g, ' ').slice(0, 46)}`)
    }
    if (out.length) console.log(`  ${String(R + 1).padStart(3)}| ${out.join(' | ')}`)
  }
}
