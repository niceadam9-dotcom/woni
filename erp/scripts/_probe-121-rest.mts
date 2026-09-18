/** 1.2.1 구역별 세부현황 — 미배선 109칸 실측 (2026-09-18)
 *  이미 40칸(zone_*)이 배선돼 있다. 남은 109칸이 무엇인지, PDF가 그 축을 인쇄하는지 본다.
 *  실행: npx tsx --conditions=react-server scripts/_probe-121-rest.mts */
import { blankReport } from '../src/lib/fire-plan-blanks.ts'
import { sheetManifest } from '../src/lib/fire-plan-xlsx-manifest.ts'
import { FIRE_PLAN_ANCHORS } from '../src/lib/fire-plan-anchors.ts'

const S = '1.2.1 구역별 세부현황'
const rs = await blankReport([S], null)
const mine = FIRE_PLAN_ANCHORS.filter(a => a.sheet === S)
console.log(`슬롯 ${rs[0].slots} · 배선 ${rs[0].wired} · 미배선 ${rs[0].blanks.length}`)
console.log(`배선된 칸: ${[...new Set(mine.map(a => a.cell.replace(/\d+/g, '')))].join(' ')} (열 기준)`)
console.log(`배선 행: ${[...new Set(mine.map(a => a.cell.replace(/[A-Z]/g, '')))].sort((a, b) => +a - +b).join(' ')}`)

const m = sheetManifest(S)
console.log('\n라벨(머리글):')
for (const [cell, lbl] of Object.entries(m.labels)) console.log(`  ${cell} ${JSON.stringify(lbl.slice(0, 40))}`)

const byCol = new Map<string, number[]>()
for (const b of rs[0].blanks) {
  const col = b.ref.replace(/\d+/g, ''); const row = Number(/\d+/.exec(b.ref)![0])
  byCol.set(col, [...(byCol.get(col) ?? []), row])
}
console.log('\n미배선 칸(열별 행 목록):')
for (const [col, rows] of [...byCol.entries()].sort()) {
  console.log(`  ${col}: ${rows.sort((a, b) => a - b).join(',')}`)
}
