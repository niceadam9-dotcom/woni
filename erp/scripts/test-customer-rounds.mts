/** 현재 회차 판정 검사 — `src/lib/customer-rounds.ts`.
 *
 *  이 규칙은 종전에 `plan-annex-section.tsx`(클라이언트 컴포넌트) 안에 묻혀 있어 **아무도
 *  단언하지 못했다**. 2026-09-21 [보고서] 탭이 같은 회차의 [별지 엑셀]을 내주게 되면서 꺼냈고,
 *  꺼낸 김에 못 박는다 — 두 탭이 **서로 다른 회차**를 고르면 사용자는 받은 파일이 1차인지
 *  2차인지 화면만 보고는 알 수 없다(조용한 오배송).
 *
 *  🚨 가장 중요한 단언은 [3]이다. 「최근 완료」 갈래가 빠지면 **점검을 끝낸 직후 엑셀 버튼이
 *    사라진다**(서림사 실사고). 그 갈래는 평소에 안 보이므로 검사가 아니면 재발을 못 막는다.
 *
 *  ⭐ `today`를 인자로 받게 만든 덕에 시계를 쥐고 잰다 — 종전처럼 함수가 시계를 읽으면
 *    「예정일이 지났는가」 단언이 실행 날짜에 따라 초록·빨강을 오간다.
 *
 *  실행: npx tsx scripts/test-customer-rounds.mts
 */
import { currentRoundOf, roundLabel, downloadableInspectionId, todayKst } from '../src/lib/customer-rounds.ts'
import type { CustomerRound } from '../src/app/(dashboard)/reports/docs-actions.ts'

let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${detail}`) }
}

/** 최소 회차 — 검사에 필요한 축만 채운다(나머지는 판정이 보지 않는다) */
function round(p: Partial<CustomerRound> & Pick<CustomerRound, 'year' | 'sequenceNum' | 'state'>): CustomerRound {
  return {
    planType: 'special_종합', planItemId: null, plannedDate: null, docs: null, docsLite: null, ...p,
  } as CustomerRound
}
const withDocs = (r: CustomerRound, inspectionId: string) =>
  ({ ...r, docs: { inspectionId } as CustomerRound['docs'] }) as CustomerRound

const TODAY = '2026-09-21'

console.log('\n[1] 진행 중 회차가 최우선')
{
  const inprog = round({ year: 2026, sequenceNum: 1, state: 'in_progress', plannedDate: '2026-06-10' })
  const planned = round({ year: 2026, sequenceNum: 2, state: 'planned', plannedDate: '2026-01-01' })
  // planned가 날짜상 더 앞서도 **진행 중**이 이긴다 — 입력하던 것을 빼앗지 않는다
  const got = currentRoundOf([planned, inprog], TODAY)
  check('진행 중이 예정보다 우선', got === inprog, `got=${got && roundLabel(got)}`)
}

console.log('\n[2] 시기가 도래한 미시작만 고른다')
{
  const due = round({ year: 2026, sequenceNum: 1, state: 'planned', plannedDate: '2026-09-01' })
  check('예정일 ≤ 오늘 → 고른다', currentRoundOf([due], TODAY) === due)

  const future = round({ year: 2026, sequenceNum: 2, state: 'planned', plannedDate: '2026-12-01' })
  // 미래뿐이면 ④ 갈래로 떨어져 **그래도** 그 회차가 나온다(신규 고객의 진입점)
  check('미래 미시작만 있으면 그 회차가 진입점', currentRoundOf([future], TODAY) === future)
  // 🎯 경계: 오늘과 같은 날은 「도래」다(미만이 아니라 이하).
  // 🚨 **미시작 회차 하나만 놓고 재면 이 단언은 거짓 초록이다** — ② 갈래가 안 걸려도 ④ 폴백이
  //   `planned[0]`으로 **같은 회차**를 돌려주기 때문이다(변이 R2 `<=`→`<`가 생존해서 잡았다).
  //   ②와 ④를 가르려면 **③이 집어갈 완료 회차**를 같이 둬야 한다: 경계가 `<=`면 오늘 예정인
  //   미시작이 이기고, `<`로 좁히면 ③이 이겨 완료 회차가 나온다 — 그제야 두 갈래가 갈린다.
  const exact = round({ year: 2026, sequenceNum: 2, state: 'planned', plannedDate: TODAY })
  const doneRival = withDocs(round({ year: 2026, sequenceNum: 1, state: 'completed', plannedDate: '2026-03-01' }), 'INS-RIVAL')
  const atBoundary = currentRoundOf([doneRival, exact], TODAY)
  check('예정일 == 오늘도 도래로 친다(완료 회차를 제치고)',
    atBoundary === exact, `got=${atBoundary && roundLabel(atBoundary)}`)
}

console.log('\n[3] 🚨 최근 완료 — 이게 빠지면 점검 직후 엑셀 버튼이 사라진다')
{
  const done = withDocs(round({ year: 2026, sequenceNum: 1, state: 'completed', plannedDate: '2026-09-01' }), 'INS-DONE')
  const future = round({ year: 2026, sequenceNum: 2, state: 'planned', plannedDate: '2026-12-01' })
  const got = currentRoundOf([done, future], TODAY)
  check('완료 직후 + 다음 회차는 미래 → 완료 회차를 문서 대상으로', got === done, `got=${got && roundLabel(got)}`)
  check('그 회차로 엑셀을 받을 수 있다', downloadableInspectionId(got) === 'INS-DONE')
}

console.log('\n[4] 받을 수 있는가 — 미시작은 산출물이 없다')
{
  const planned = round({ year: 2026, sequenceNum: 1, state: 'planned', plannedDate: '2026-09-01' })
  check('미시작 회차는 inspectionId가 없다(버튼 대신 안내)', downloadableInspectionId(planned) === null)
  check('회차 자체가 없으면 null', downloadableInspectionId(null) === null)
  check('빈 목록이면 현재 회차 없음', currentRoundOf([], TODAY) === null)
}

console.log('\n[5] 회차 이름 — 두 탭이 같은 글로 부른다')
{
  check('종합', roundLabel(round({ year: 2026, sequenceNum: 1, state: 'planned' })) === '2026년 1차 (종합)')
  check('작동', roundLabel(round({ year: 2026, sequenceNum: 2, state: 'planned', planType: 'special_작동' })) === '2026년 2차 (작동)')
  // 레거시 자체점검은 planType이 null — 괄호를 **비워 두지 않고 아예 안 그린다**
  check('레거시(planType null)는 괄호를 안 그린다',
    roundLabel(round({ year: 2025, sequenceNum: 1, state: 'completed', planType: null })) === '2025년 1차')
}

console.log('\n[6] 계측기 자기 검사')
{
  check('todayKst가 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(todayKst()), todayKst())
  // 음성 — 판정이 아무거나 집어 오지 않는가(완료뿐이고 docs도 없으면 고를 게 없다)
  const doneNoDocs = round({ year: 2025, sequenceNum: 1, state: 'completed', plannedDate: '2025-06-01' })
  check('완료인데 docs가 없으면 고르지 않는다', currentRoundOf([doneNoDocs], TODAY) === null)
}

console.log(`\n=== pass ${pass} / fail ${fail} ===`)
process.exit(fail ? 1 : 0)
