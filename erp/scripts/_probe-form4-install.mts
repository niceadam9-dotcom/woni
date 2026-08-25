/** 별지 4호 1쪽(현황 시트) 설치 체크칸 ↔ 라벨 ↔ 판정 수식 실측 — 배선 전 매핑 근거 */
import XLSX from 'xlsx'
import { readFileSync } from 'node:fs'
import { MARK_RE } from '../src/lib/xlsx-anchors.ts'

const file = process.argv[2] ?? 'templates/report-workbook.xlsx'
const sheetName = process.argv[3] ?? '현황'
const wb = XLSX.read(readFileSync(file), { cellFormula: true })
const ws = wb.Sheets[sheetName]
if (!ws) { console.error(`시트 없음: ${sheetName}`); process.exit(1) }

const dec = XLSX.utils.decode_cell
const enc = XLSX.utils.encode_cell
const cells = Object.keys(ws).filter(k => !k.startsWith('!'))

// ① 마크 든 리터럴 셀(설치 체크칸 후보) + 같은 행 오른쪽 3칸 텍스트
console.log(`=== [1] ${sheetName} 마크 리터럴 칸 ===`)
const markCells: string[] = []
for (const k of cells) {
  const c = ws[k] as XLSX.CellObject
  if (c.f) continue
  const v = String(c.v ?? '')
  if (!MARK_RE.test(v)) continue
  markCells.push(k)
  const p = dec(k)
  const neigh: string[] = []
  for (let d = 1; d <= 4; d++) {
    const n = ws[enc({ c: p.c + d, r: p.r })] as XLSX.CellObject | undefined
    if (n?.v !== undefined && String(n.v).trim()) { neigh.push(`${enc({ c: p.c + d, r: p.r })}="${String(n.v).trim()}"`); break }
  }
  console.log(`${k}\t${JSON.stringify(v)}\t${neigh.join(' ')}`)
}
console.log(`  총 ${markCells.length}칸`)

// ② 그 칸을 참조하는 수식 셀(판정 칸)
console.log(`\n=== [2] 판정 수식(마크 칸 참조) ===`)
const markSet = new Set(markCells)
let n = 0
const byRef = new Map<string, string[]>()
for (const s of wb.SheetNames) {
  const w = wb.Sheets[s]
  for (const k of Object.keys(w)) {
    if (k.startsWith('!')) continue
    const f = String((w[k] as XLSX.CellObject).f ?? '')
    if (!f) continue
    for (const m of f.matchAll(/(?:'?([^'!=,()"]+)'?!)?(\$?[A-Z]{1,3}\$?\d{1,5})/g)) {
      const sh = m[1] ?? s
      const cell = m[2].replace(/\$/g, '')
      if (sh !== sheetName || !markSet.has(cell)) continue
      const arr = byRef.get(cell) ?? []
      arr.push(`${s}!${k}`)
      byRef.set(cell, arr)
      n++
    }
  }
}
for (const [cell, users] of [...byRef].sort()) {
  console.log(`${sheetName}!${cell} ← ${users.length}칸: ${users.slice(0, 8).join(', ')}${users.length > 8 ? ' …' : ''}`)
}
console.log(`  참조 총 ${n}건 · 씨앗 ${byRef.size}칸`)

// ③ 마크 칸을 참조하는 수식의 형태 샘플
console.log(`\n=== [3] 수식 형태 샘플 ===`)
const seen = new Set<string>()
for (const [, users] of byRef) {
  for (const u of users) {
    const [s, k] = u.split('!')
    const f = String((wb.Sheets[s][k] as XLSX.CellObject).f ?? '')
    const shape = f.replace(/[A-Z]{1,3}\d{1,5}/g, '#')
    if (seen.has(shape)) continue
    seen.add(shape)
    console.log(`${u}\t${f}`)
  }
}
