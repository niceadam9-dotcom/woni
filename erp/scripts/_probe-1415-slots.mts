/** 1.14.2·1.15 — 빈 슬롯·상자 좌표 실측 (2026-09-18)
 *  promoLog·recoveryLog 축이 ERP·PDF에 이미 있음을 확인했다. 엑셀 양식의 어느 칸이
 *  슬롯인지 짚어 배선 가능성(모양 맞음/안 맞음)을 가린다.
 *  실행: npx tsx --conditions=react-server scripts/_probe-1415-slots.mts */
import { blankReport } from '../src/lib/fire-plan-blanks.ts'

const SHEETS = ['1.14.2 화재예방 및 홍보 결과', '1.15 피해 복구', '1.5.2 방화·제연구획 현황도', '1.3 건축물 위치·운영현황', '3.6 피난약자 유형별 방법', '1.11.2 소방훈련·교육 세부계획', '1.11.4 결과기록부 뒷쪽']
const rs = await blankReport(SHEETS, null)
for (const r of rs) {
  console.log(`\n══ ${r.sheet} — 슬롯 ${r.slots} · 상자 ${r.boxes}`)
  for (const b of r.blanks) console.log(`   ${b.kind.padEnd(8)} ${b.ref}  ${JSON.stringify(b.label ?? '')}`)
}

/* 1.14.2 — A3·A5가 사진 지면인지 행 높이로 가린다(큰 높이 = 사진 자리) */
import JSZip from 'jszip'
import { firePlanTemplate } from '../src/lib/fire-plan-template-cache.ts'
import { readSheetGrid } from '../src/lib/xlsx-read-sheet.ts'
const t = await firePlanTemplate()
const zip = await JSZip.loadAsync(t.bytes)
for (const [name, rows] of [['1.14.2 화재예방 및 홍보 결과', [2, 3, 4, 5]], ['1.11.4 결과기록부 뒷쪽', [11, 12, 13, 14, 15]]] as const) {
  const g = await readSheetGrid(zip, name)
  console.log(`\n${name} 행 높이(pt): ` + rows.map(r => `${r}행=${g.rowHeights[r - 1] ?? 0}`).join(' · '))
  for (const r of rows) {
    const spans = g.cells.filter(c => c.row === r - 1 && c.span).map(c => `${c.ref}(${c.span!.rows}행×${c.span!.cols}열)`)
    if (spans.length) console.log(`  ${r}행 병합: ${spans.join(' ')}`)
  }
}
