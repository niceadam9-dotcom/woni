/** 1.5.2 「구역」 2칸 재조사 (2026-09-18) — evacMaps[i].floor가 그 값인가
 *  실행: npx tsx --conditions=react-server scripts/_probe-152-zone.mts */
import { labelAt, sheetManifest } from '../src/lib/fire-plan-xlsx-manifest.ts'
import { blankReport } from '../src/lib/fire-plan-blanks.ts'

const S = '1.5.2 방화·제연구획 현황도'
const rs = await blankReport([S], null)
console.log(`슬롯 ${rs[0].slots} · 빈 슬롯 ${rs[0].blanks.map(b => b.ref).join(' ')}`)
for (const c of ['A1', 'A2', 'A3', 'AQ3', 'AW3', 'A4', 'A5', 'AQ5', 'AW5', 'A6']) {
  const lbl = sheetManifest(S).labels[c]
  console.log(`${c} ${lbl === undefined ? '(라벨 없음 — 빈 칸)' : JSON.stringify(labelAt(S, c))}`)
}
