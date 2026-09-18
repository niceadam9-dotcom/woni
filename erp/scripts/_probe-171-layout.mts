/** 1.7.1 소방안전관리자 선임현황 — 미배선 91칸 실측 (2026-09-18)
 *  슬롯 93 중 2칸만 배선돼 있다. 무엇이 남았는지, ERP 축이 닿는지 본다.
 *  실행: npx tsx --conditions=react-server scripts/_probe-171-layout.mts */
import { blankReport } from '../src/lib/fire-plan-blanks.ts'
import { sheetManifest, labelAt } from '../src/lib/fire-plan-xlsx-manifest.ts'
import { FIRE_PLAN_ANCHORS } from '../src/lib/fire-plan-anchors.ts'

const S = '1.7.1 소방안전관리자 선임현황'
const rs = await blankReport([S], null)
console.log(`슬롯 ${rs[0].slots} · 배선 ${rs[0].wired} · 상자 ${rs[0].boxes}`)
console.log(`이미 배선된 앵커: ${FIRE_PLAN_ANCHORS.filter(a => a.sheet === S).map(a => `${a.cell}=${a.field}`).join(' ')}`)

const m = sheetManifest(S)
console.log('\n라벨 전부:')
for (const [cell, lbl] of Object.entries(m.labels)) {
  console.log(`  ${cell} ${JSON.stringify(lbl.slice(0, 44))}`)
}
console.log(`\n빈 슬롯 ${rs[0].blanks.length}칸: ${rs[0].blanks.map(b => b.ref).sort().join(' ')}`)
void labelAt
