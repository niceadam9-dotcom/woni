/** 4단계 CellOrigin — 선언을 측정된 사실로 (2026-09-18, 소방계획서_50 §10-2b)
 *
 *  [1] 전수 — 앵커 전 필드가 입력처를 얻는다(하나라도 빠지면 「입력: ?」로 새는 칸이 생긴다).
 *  [2] 차분 — 픽스처에서 **한 원천만** 흔들고 buildFirePlanValues를 재실행해, 바뀐 필드가
 *      **정확히 그 원천으로 선언된 form**에만 속하는지 단언한다. 다른 form 필드가 함께
 *      바뀌면 선언(또는 값 배선)이 거짓말이다.
 *
 *  실행: npx tsx scripts/test-fire-plan-origins.mts */
import { FIRE_PLAN_ANCHORS } from '../src/lib/fire-plan-anchors.ts'
import { originOf } from '../src/lib/fire-plan-origins.ts'
import { buildFirePlanValues } from '../src/lib/fire-plan-xlsx-values.ts'

let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

/* ══════════════════ [1] 전수 — 모든 앵커 필드가 입력처를 얻는다 ══════════════════ */
console.log('[1] 전수 가드')
const missing = FIRE_PLAN_ANCHORS.filter(a => !originOf(a.field, a.sheet))
check(`앵커 ${FIRE_PLAN_ANCHORS.length}개 전 필드가 origin을 얻는다`, missing.length === 0,
  missing.slice(0, 5).map(a => `${a.sheet}!${a.field}`).join(' · ') || `${FIRE_PLAN_ANCHORS.length}개`)
// 양성 — override가 실제로 물린다(전수만 보면 기본값만으로도 초록이라 공허)
check('override 표본 — 3.3은 1.2로 간다', originOf('evac3_0_zone', '3.3 피난인원현황')?.form === '1.2')
check('override 표본 — 2.9 방법 문구는 ch2로 간다', originOf('ext29_method_ground', '2.9 초기소화팀(진압반)')?.form === 'ch2')
check('기본값 표본 — 1.10.4는 대장의 절(1.10)로 간다',
  originOf('firehist_0_kind', '1.10.4 화재·비화재보 이력')?.form === '1.10')

/* ══════════════════ [2] 차분 — 한 원천만 흔들면 그 원천 선언만 바뀐다 ══════════════════ */
console.log('\n[2] 차분 검사')
const base = {
  buildingName: 'X', facilities: [], brigade: [], zones: [], hazards: [], forms: {},
} as never
const fieldSheet = new Map(FIRE_PLAN_ANCHORS.map(a => [a.field, a.sheet]))
const v0 = buildFirePlanValues(base)

function changedFields(over: Record<string, unknown>): string[] {
  const v1 = buildFirePlanValues({ ...(base as object), ...over } as never)
  return [...v1.keys()].filter(k => fieldSheet.has(k) && v0.get(k) !== v1.get(k))
}

const CASES: ReadonlyArray<readonly [string, Record<string, unknown>, string[]]> = [
  ['zones(구역)', { zones: [{ name: 'Z1', floor: '1층' }] }, ['1.2']],
  ['hazards(취약장소)', { hazards: [{ place: 'P', location: 'L', factors: [] }] }, ['1.2']],
  ['facilities(설비)', { facilities: ['비상방송설비', '자동화재속보설비'] }, ['1.4']],
  ['brigade(대원)', { brigade: [{ team: '비상연락팀', name: 'A', phone: '01000000000' }] }, ['ch2']],
  ['evacRoutes(경로)', { evacRoutes: [{ route: 'R', floor: '전층' }] }, ['ch3']],
  ['promoPlan(홍보 계획)', { forms: { promoPlan: { poster: [3] } } }, ['1.12']],
  ['brigadeTeams(팀별 문구)', { forms: { brigadeTeams: { extinguish: 'E문구', protect: 'P문구' } } }, ['ch2']],
  ['층수 원시값', { floorsAbove: 30, floorsBelow: 1 }, ['1.1']],
  // 1.15 개요가 1.10.4 이력과 함께 바뀐다 — 둘 다 1.10 선언이어야(fire115 override)
  ['fireHistory(화재이력)', { forms: { fireHistory: [{ kind: '화재', at: '2026-01-01', place: 'P', cause: 'C', action: 'A' }] } }, ['1.10']],
]
for (const [name, over, forms] of CASES) {
  const changed = changedFields(over)
  const wrong = changed.filter(f => !forms.includes(originOf(f, fieldSheet.get(f)!)?.form ?? '?'))
  check(`${name}만 흔들면 전부 ${forms.join('·')} 선언 (${changed.length}칸)`,
    changed.length > 0 && wrong.length === 0,
    wrong.slice(0, 5).map(f => `${f}→${originOf(f, fieldSheet.get(f)!)?.form}`).join(' · '))
}

console.log(`\n=== pass ${pass} / fail ${fail} ===`)
process.exit(fail ? 1 : 0)
