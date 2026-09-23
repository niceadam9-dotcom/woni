/** 소방계획서 3장 — 부분 저장값에서 화면이 죽지 않는가 (2026-09-23)
 *  실행: npx tsx scripts/test-evac-plan-normalize.mts   — 서버·DB 불필요
 *
 *  결함: `plan-ch3.tsx`가 `plan.routes.map`에서 TypeError로 죽었다. 스테이징 저장값 6건이
 *  `{ procedure, evacMethod, falseAlarm }` **세 키만** 가진 모양이었다(routes·assembly·mapImage 없음).
 *  여기서는 **그 실제 모양**을 값으로 넣어 돌린다 — 모양만 보는 소스 단언은 값이 빈 채로도 초록이다.
 */
import { readFileSync } from 'node:fs'
import { normalizeEvacPlan, normalizeVulnerable, normalizeTraining } from '../src/lib/evac-plan-normalize.ts'
import { codeOnly } from './_code-only.mts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('— 실제 부분 저장 모양 (스테이징 6건)')
{
  const partial = { procedure: '절차', evacMethod: '대피', falseAlarm: '비화재' } as never
  const p = normalizeEvacPlan(partial)
  ok('★ routes가 빈 배열이 된다 — .map이 죽지 않는다', Array.isArray(p.routes) && p.routes.length === 0, JSON.stringify(p.routes))
  ok('assembly는 빈 문자열(제어 입력이 undefined가 되지 않게)', p.assembly === '')
  ok('mapImage는 null', p.mapImage === null)
  ok('★ 있던 값은 그대로 — 절차·대피방법·비화재보', p.procedure === '절차' && p.evacMethod === '대피' && p.falseAlarm === '비화재')
}

console.log('\n— 온전한 저장값·빈 값·이상한 값')
{
  const full = { procedure: 'a', routes: [{ floor: '1', route: 'r', guide: 'g', equip: 'e' }], assembly: '주차장', mapImage: 'x.png' }
  const p = normalizeEvacPlan(full)
  ok('온전한 값은 바뀌지 않는다', JSON.stringify(p) === JSON.stringify(full), JSON.stringify(p))
  const n = normalizeEvacPlan(null)
  ok('null → 기본값', n.procedure === '' && n.routes.length === 0 && n.assembly === '' && n.mapImage === null)
  const bad = normalizeEvacPlan({ routes: 'oops' as never, procedure: 3 as never })
  ok('배열 자리에 배열 아닌 값 → 빈 배열 · 문자열 자리에 숫자 → 빈 문자열', bad.routes.length === 0 && bad.procedure === '')
}

console.log('\n— 피난약자(같은 부류의 위험)')
{
  const v = normalizeVulnerable({ none: true } as never)
  ok('plans·counts가 빠져도 채운다', Array.isArray(v.plans) && v.plans.length === 0 && typeof v.counts === 'object' && v.none === true)
  ok('null → 기본값', normalizeVulnerable(null).none === false)
  ok('counts가 배열이면 객체로', !Array.isArray(normalizeVulnerable({ counts: [] as never }).counts))
}

console.log('\n— 1.11 훈련·교육 (같은 부류 — 스테이징 3건 `{details, scenario, scenarioType}`만)')
{
  const partial = { details: [{ name: '소방훈련' }], scenario: '시나리오', scenarioType: '주택형' } as never
  const t = normalizeTraining(partial)
  ok('★ headcount가 채워진다 — t.headcount[k]가 죽지 않는다',
    t.headcount.worker === '' && t.headcount.resident === '' && t.headcount.brigade === '', JSON.stringify(t.headcount))
  ok('월 선택·기록이 빈 배열', t.eduMonths.length === 0 && t.drillMonths.length === 0 && t.records.length === 0)
  ok('★ 있던 값(details·scenario·scenarioType)은 그대로', t.details.length === 1 && t.scenario === '시나리오' && t.scenarioType === '주택형')
  const full = normalizeTraining({ headcount: { worker: '3', resident: '', brigade: '5' }, eduMonths: [3], drillMonths: [9],
    details: [], scenario: '', scenarioType: '', records: [], photos: [] })
  ok('온전한 값은 그대로', full.headcount.worker === '3' && full.eduMonths[0] === 3 && full.drillMonths[0] === 9)
}

console.log('\n— 배선: 화면이 정규화를 **거쳐서** 읽는다')
ok('★ 1.11 초기값이 normalizeTraining을 거친다',
  /useState<TrainingSection>\(\(\) => normalizeTraining\(initial\)\)/.test(
    codeOnly(readFileSync(new URL('../src/components/customers/plan-form111.tsx', import.meta.url), 'utf8'))))
{
  const src = codeOnly(readFileSync(new URL('../src/components/customers/plan-ch3.tsx', import.meta.url), 'utf8'))
  ok('★ plan 초기값이 normalizeEvacPlan을 거친다', /useState<EvacPlanSection>\(\(\) => normalizeEvacPlan\(initialPlan\)\)/.test(src))
  ok('★ vul 초기값이 normalizeVulnerable을 거친다', /useState<VulnerableSection>\(\(\) => normalizeVulnerable\(initialVulnerable\)\)/.test(src))
  ok('음성 — `initialPlan ??` 직접 폴백이 남아 있지 않다', !/initialPlan \?\?/.test(src))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
