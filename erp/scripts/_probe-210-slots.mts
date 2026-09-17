/** 2.10 피난유도팀 — 슬롯 26·상자 13 좌표 실측 (2026-09-18)
 *  기존 축 재사용 배선의 사전 실측: 어느 칸이 슬롯/상자인지, 상자 라벨 자구는 무엇인지.
 *  실행: npx tsx --conditions=react-server scripts/_probe-210-slots.mts */
import JSZip from 'jszip'
import { blankReport } from '../src/lib/fire-plan-blanks.ts'
import { firePlanTemplate } from '../src/lib/fire-plan-template-cache.ts'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'
import { sheetManifest } from '../src/lib/fire-plan-xlsx-manifest.ts'

for (const SHEET of ['2.10 피난유도팀', '2.9 초기소화팀(진압반)', '2.11 응급구조팀']) {
  const rs = await blankReport([SHEET], null)
  console.log(`\n══════════ ${SHEET} — 슬롯 ${rs[0].slots} · 상자 ${rs[0].boxes}`)
  console.log('빈 슬롯: ' + rs[0].blanks.map(b => b.ref).sort().join(' '))
  const m = sheetManifest(SHEET)
  console.log('상자칸(manifest.boxes):')
  for (const [cell, n] of Object.entries(m.boxes)) {
    console.log(`  ${cell} ×${n}  라벨=${JSON.stringify((m.labels[cell] ?? '').slice(0, 50))}`)
  }
}

/* 병합 구조 — 값이 실릴 칸의 크기 확인 (2.10만) */
const t = await firePlanTemplate()
const zip = await JSZip.loadAsync(t.bytes)
const g = await readSheetGrid(zip, '2.10 피난유도팀')
console.log('\n2.10 병합(빈 칸만):')
for (const c of g.cells) {
  if (!c.span || (c.text ?? '').trim()) continue
  console.log(`  ${c.ref} (${c.span.rows}행×${c.span.cols}열)`)
}
