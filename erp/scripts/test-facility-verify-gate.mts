/** 1.4 확인 여부 게이트 — 경고와 완료 보류 (소방계획서_49 §5-1·§6, 2026-09-11)
 *
 *  🚨 등재 이유: 관문을 **ⓑ경고만**으로 정했으므로(사용자 확정) 경고는 지나칠 수 있다.
 *  그러면 「점검표를 전부 ／로만 채운 회차」는 따라잡기도 안 돌아(／는 트리거가 아니다)
 *  대장이 빈 채로 남고, **분모가 0이라 안전장치가 동시에 침묵**한다.
 *  그 회차를 잡는 그물은 **완료 보류 한 층뿐**이다 — 그래서 이 판정이 틀리면 아무도 안 잡는다.
 *
 *  핵심은 「막는가」가 아니라 **「막으면 안 될 때 안 막는가」**:
 *   [C] 확인일이 있으면 설비가 0건이어도 안 막는다 ← 가장 중요(§8의 2번)
 *   [D] 일부만 미확인(다동)이면 안 막는다 — 되돌릴 길이 화면에 없다
 *
 *  실행: npx tsx --conditions=react-server scripts/test-facility-verify-gate.mts */
import { readFileSync } from 'node:fs'
import g from '../src/lib/facility-verify-gate.ts'

const { facilityVerifyState, shouldWarnFacilitiesUnverified, shouldHoldForFacilitiesUnverified } =
  g as unknown as typeof import('../src/lib/facility-verify-gate.ts')

let pass = 0, fail = 0
const ok = (c: boolean, m: string, d = '') => { if (c) { pass++; console.log(`  ✅ ${m}`) } else { fail++; console.log(`  ❌ ${m}  ${d}`) } }

const B = (...v: Array<string | null>) => v.map(x => ({ facilities_verified_at: x }))
const st = (...v: Array<string | null>) => facilityVerifyState(B(...v))

console.log('── A. 세기 ──')
ok(st(null).unverified === 1 && st(null).total === 1, '1동 미확인')
ok(st('2026-09-01').unverified === 0, '확인일이 있으면 미확인 아님')
ok(st(null, '2026-09-01').total === 2 && st(null, '2026-09-01').unverified === 1, '2동 중 1동 미확인')
ok(st().total === 0, '건물이 없으면 0')

console.log('\n── B. 경고 — 하나라도 미확인이면 알린다 ──')
ok(shouldWarnFacilitiesUnverified(st(null)) === true, '🎯 1동 미확인 → 경고')
ok(shouldWarnFacilitiesUnverified(st(null, '2026-09-01')) === true, '일부만 미확인이어도 경고')
ok(shouldWarnFacilitiesUnverified(st('2026-09-01')) === false, '🚨 (음성) 확인했으면 경고 안 함')
ok(shouldWarnFacilitiesUnverified(st()) === false, '🚨 (음성) 건물이 없으면 경고 안 함')

console.log('\n── C. 완료 보류 — 전부 미확인일 때만 ──')
ok(shouldHoldForFacilitiesUnverified(st(null)) === true, '🎯 1동 전부 미확인 → 보류')
ok(shouldHoldForFacilitiesUnverified(st(null, null)) === true, '2동 전부 미확인 → 보류')
ok(shouldHoldForFacilitiesUnverified(st('2026-09-01')) === false,
  '🎯🚨 (음성) **확인만 눌렀으면 설비가 0건이어도 안 막는다** — 설비 없는 건물이 영영 못 끝내면 안 된다')
ok(shouldHoldForFacilitiesUnverified(st(null, '2026-09-01')) === false,
  '🚨 (음성) 일부만 미확인(다동)이면 안 막는다 — 되돌릴 길이 화면에 없다')
ok(shouldHoldForFacilitiesUnverified(st()) === false,
  '🚨 (음성) 건물이 0동이면 안 막는다 — 확인할 대상이 없는데 막으면 영영 못 끝낸다')

console.log('\n── D. 경고와 보류의 관계 ──')
// 보류는 경고의 부분집합이어야 한다 — 「막는데 안 알린다」가 되면 사용자가 이유를 못 찾는다
for (const s of [st(null), st(null, null), st(null, '2026-09-01'), st('2026-09-01'), st()]) {
  if (shouldHoldForFacilitiesUnverified(s)) {
    ok(shouldWarnFacilitiesUnverified(s), `🚨 막으면 반드시 알린다 (${s.unverified}/${s.total})`)
  }
}

console.log('\n── E. 배선 — 보류가 실제로 걸리는가 ──')
/* 🚨 이 절이 이 검사의 존재 이유 절반이다. 처음엔 기존 `holdCompletion`에 `{ required: 0 }`을
   넘겨 대신하려 했는데, 그쪽 판정이 `required > 0`이라 **조용히 보류가 안 걸렸을 것**이다.
   사유가 다르면 축도 따로 둬야 한다 — 그게 실제로 그렇게 돼 있는지 소스로 센다. */
const codeOnly = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !/^\s*\/\//.test(l) && !/^\s*import\s/.test(l)).join('\n')
const sync = codeOnly(readFileSync(new URL('../src/lib/inspection-step-sync.ts', import.meta.url), 'utf8'))

ok(/shouldHoldForFacilitiesUnverified\(/.test(sync), '🎯 동기화가 이 판정을 실제로 부른다')
ok(/holdFacilitiesUnverified/.test(sync), '🎯 보류 축이 별도 인자로 전달된다')
ok(/holdCompletion\.required > 0\) \|\| !!holdFacilitiesUnverified/.test(sync),
  '🚨 두 사유가 **OR**로 합쳐진다 — 한쪽이 0이어도 다른 쪽이 막는다')
ok(!/holdCompletion: holdCompletion \?\? \(/.test(sync),
  '🚨 (음성) `{ required: 0 }`으로 대신하지 않는다 — 그러면 보류가 안 걸린다')
ok(/facilityVerifyState\(/.test(sync), '판정 재료를 순수 함수로 만든다(규칙을 다시 적지 않는다)')
// 비용 게이트 — 매 저장마다 건물을 조회하면 안 된다
ok(/allActiveDone && insp\.status !== 'completed' && isSpecial/.test(sync),
  '🚨 완료 임박 + 자체점검일 때만 조회한다(비용 게이트)')

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} 통과`)
process.exit(fail === 0 ? 0 : 1)
