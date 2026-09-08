/** 주용도 표기 축(`purposeShort`) 확인 — 격자 교체가 진행 중이라 스위트가 붉으므로
 *  값 축만 **격자와 무관하게** 따로 세운다(일회성).
 *
 *  실행: npx tsx --conditions=react-server scripts/_probe-42-purpose.mts */
import { purposeShort, buildFirePlanValues } from '../src/lib/fire-plan-xlsx-values.ts'
import type { FirePlanGenData } from '../src/lib/fire-plan-template.ts'

const CASES: Array<string | null | undefined> = [
  '제2종근린생활시설', '제1종근린생활시설', '근린생활', '문화및집회시설', '단독주택', '', null,
]
for (const c of CASES) {
  console.log(`  입력=${JSON.stringify(c)}`.padEnd(34) + `→ ${JSON.stringify(purposeShort(c))}`)
}

const v = buildFirePlanValues({
  buildingName: '가상건물', purpose: '제2종근린생활시설', zones: [], brigade: [],
} as unknown as FirePlanGenData)

console.log('\n  ── 왕복 ──')
console.log(`  1.1 주용도(purpose)      = ${JSON.stringify(v.get('purpose'))}`)
console.log(`  표지 용도(cover_purpose) = ${JSON.stringify(v.get('cover_purpose'))}`)
