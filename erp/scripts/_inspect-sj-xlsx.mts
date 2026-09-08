/** sj_계획서.xlsx 구조 훑기 — 「이 형식대로 만들어줘」의 그 형식이 무엇인지 실측한다.
 *  읽기 전용. 실행: npx tsx scripts/_inspect-sj-xlsx.mts */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import * as XLSX from 'xlsx'

const HERE = dirname(fileURLToPath(import.meta.url))
const P = resolve(HERE, '../../erp_goal/_doc01/sj_계획서.xlsx')
if (!existsSync(P)) { console.log('없다:', P); process.exit(1) }

const wb = XLSX.read(readFileSync(P), { cellStyles: true, cellNF: true, sheetStubs: true })
console.log(`시트 ${wb.SheetNames.length}개\n`)

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]
  const ref = ws['!ref'] ?? '(빈 시트)'
  const merges = ws['!merges'] ?? []
  const cols = ws['!cols'] ?? []
  const rows = ws['!rows'] ?? []
  const r = XLSX.utils.decode_range(ref === '(빈 시트)' ? 'A1' : ref)
  let filled = 0
  for (let R = r.s.r; R <= r.e.r; R++) {
    for (let C = r.s.c; C <= r.e.c; C++) {
      const c = ws[XLSX.utils.encode_cell({ r: R, c: C })]
      if (c && c.v !== undefined && String(c.v).trim() !== '') filled++
    }
  }
  console.log(`━━ [${name}]  범위 ${ref} · 값셀 ${filled} · 병합 ${merges.length} · 열폭 ${cols.length} · 행높이 ${rows.length}`)

  // 앞쪽 내용 미리보기 — 행 단위로 (열 위치 표기)
  const maxR = Math.min(r.e.r, r.s.r + 39)
  for (let R = r.s.r; R <= maxR; R++) {
    const cells: string[] = []
    for (let C = r.s.c; C <= Math.min(r.e.c, r.s.c + 25); C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C })
      const c = ws[addr]
      if (c && c.v !== undefined && String(c.v).trim() !== '') {
        cells.push(`${addr}=${String(c.v).replace(/\s+/g, ' ').slice(0, 40)}`)
      }
    }
    if (cells.length) console.log(`   ${String(R + 1).padStart(3)}| ${cells.join(' | ')}`)
  }
  if (r.e.r > maxR) console.log(`   … (${r.e.r - maxR}행 더)`)
  console.log()
}
