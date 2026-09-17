/** 서식 2.4 개별임무카드 — 성명 칸·블록 머리 라벨 실측 (2026-09-18)
 *  CARD24_CELLS의 좌표(W9 등)·어간·labelCell(A3 등)이 실제 양식과 맞는지 눈으로 확인한다.
 *  실행: npx tsx --conditions=react-server scripts/_probe-card24-layout.mts */
import JSZip from 'jszip'
import { firePlanTemplate } from '../src/lib/fire-plan-template-cache.ts'
import { readSheetGrid, parseRef } from '../src/lib/xlsx-read-sheet.ts'
import { FP_SHEET, CARD24_CELLS } from '../src/lib/fire-plan-anchors.ts'

const t = await firePlanTemplate()
const zip = await JSZip.loadAsync(t.bytes)
const g = await readSheetGrid(zip, FP_SHEET.F2_4)

const at = (ref: string) => {
  const { row, col } = parseRef(ref)
  const c = g.cells.find(c => c.row === row && c.col === col)
  return c ? JSON.stringify(c.text ?? '') : '(칸 없음)'
}

console.log('=== CARD24_CELLS 검증 ===')
for (const [cell, stem, labelCell] of CARD24_CELLS) {
  console.log(`${stem.padEnd(6)} 성명칸 ${cell}=${at(cell)}  머리 ${labelCell}=${at(labelCell)}`)
}

console.log('\n=== 성명 칸 병합·테두리 상태 ===')
for (const ref of ['W9', 'W20', 'W31', 'W42', 'W53', 'W64', 'Q9']) {
  const { row, col } = parseRef(ref)
  const c = g.cells.find(x => x.row === row && x.col === col)
  console.log(ref, c ? JSON.stringify({ text: c.text, span: c.span, covered: c.covered }) : '(없음)')
}

console.log('\n=== 텍스트 있는 셀 전부 (행별) ===')
const byRow = new Map<number, string[]>()
for (const c of g.cells) {
  if (!c.text || !c.text.trim()) continue
  const arr = byRow.get(c.row) ?? []
  arr.push(`${c.ref}:${JSON.stringify(c.text.slice(0, 40))}`)
  byRow.set(c.row, arr)
}
for (const [row, arr] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(arr.join('  '))
}
