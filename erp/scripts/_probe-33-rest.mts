/** 3.3 피난인원현황 — 미배선 76칸 실측 (2026-09-18)
 *  실행: npx tsx --conditions=react-server scripts/_probe-33-rest.mts */
import { blankReport } from '../src/lib/fire-plan-blanks.ts'
import { sheetManifest } from '../src/lib/fire-plan-xlsx-manifest.ts'
import { FIRE_PLAN_ANCHORS } from '../src/lib/fire-plan-anchors.ts'

const S = '3.3 피난인원현황'
const rs = await blankReport([S], null)
const mine = FIRE_PLAN_ANCHORS.filter(a => a.sheet === S)
console.log(`슬롯 ${rs[0].slots} · 배선 ${rs[0].wired} · 미배선 ${rs[0].blanks.length}`)
console.log(`배선 열: ${[...new Set(mine.map(a => a.cell.replace(/\d+/g, '')))].join(' ')}`)
console.log('\n라벨:')
for (const [cell, lbl] of Object.entries(sheetManifest(S).labels)) console.log(`  ${cell} ${JSON.stringify(lbl.slice(0, 40))}`)
const byCol = new Map<string, number[]>()
for (const b of rs[0].blanks) {
  const col = b.ref.replace(/\d+/g, ''); const row = Number(/\d+/.exec(b.ref)![0])
  byCol.set(col, [...(byCol.get(col) ?? []), row])
}
console.log('\n미배선(열별 행):')
for (const [col, rows] of [...byCol.entries()].sort()) console.log(`  ${col}: ${rows.sort((a, b) => a - b).join(',')}`)
