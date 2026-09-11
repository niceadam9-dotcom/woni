/** ⑤ 계획 기간·⑥ 완료일의 **총 이행기간 파생** — `lib/action-period-derive` (2026-09-10)
 *
 *  실행: npx tsx scripts/test-action-period-derive.mts
 *
 *  사용자 지시: 「완료일 입력 할 필요가 없는데… 총이행일 기간을 넣으면 될 것 같다」.
 *  칸을 지운 게 아니라 **손으로 치는 일**을 지웠다 — `action_completed_at`은 별지 11호
 *  「이행조치 일자」에 인쇄되고 ⑤ 단계 완료 판정이 그 칸 하나에 걸려 있어 비울 수 없다.
 *
 *  이 검사가 고정하는 것:
 *   ① ⑥ 완료일 = 총 이행기간 **종료일** (없으면 그 불량의 계획 종료일, 둘 다 없으면 **거절**)
 *   ② ⑤ 일괄 적용은 **빈 칸만** 채운다 (한쪽만 있는 행도 건드리지 않는다)
 *   ③ 그 규칙을 **실제로 부르는가** — 함수의 존재는 호출을 뜻하지 않는다
 *
 *  🚨 **음성 대조를 반드시 함께 둔다.** 이 축에서 가장 위험한 회귀는 「폴백이 오늘로 떨어지는 것」인데,
 *    그건 화면상 아무 문제가 없어 보이고 근거 없는 날짜가 소방서 제출 서식에 그대로 찍힌다.
 *    양성만 단언하면 오늘 폴백을 넣어도 초록으로 남는다.
 */
import { readFileSync } from 'node:fs'
import { completionDateFrom, isPlanFillTarget } from '../src/lib/action-period-derive.ts'

let pass = 0, fail = 0
function ok(cond: boolean, label: string, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`) }
}

const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const ACTIONS = src('../src/app/(dashboard)/inspections/defect-actions.ts')
const GRID = src('../src/components/inspections/defect-grid.tsx')
const CARD = src('../src/components/inspections/inspection-defects-client.tsx')
const count = (hay: string, needle: string) => hay.split(needle).length - 1
/** 이름 있는 최상위 함수 **본문 안**만 본다 — 파일 어딘가에 있다는 것과 이 경로가 부른다는 것은 다르다
 *  (같은 파일의 형제 함수에 매치돼 통과하던 검사가 4차 판정에서 무더기로 뚫렸다). */
function inFn(source: string, name: string): string {
  const at = source.indexOf(`export async function ${name}(`)
  if (at < 0) return ''
  const end = source.indexOf('\n}\n', at)
  return end < 0 ? source.slice(at) : source.slice(at, end)
}

const PERIOD_END = '2026-08-15'
const PLAN_END = '2026-09-30'
const TODAY = new Date().toISOString().slice(0, 10)

console.log('── A. ⑥ 완료일은 총 이행기간 종료일에서 온다 ──')
{
  ok(completionDateFrom(PERIOD_END, PLAN_END) === PERIOD_END,
    '기간 종료일이 있으면 그것을 쓴다', completionDateFrom(PERIOD_END, PLAN_END))
  // 🚨 음성 — 계획 종료일이 이겨 버리면 문서에 엉뚱한 날짜가 찍힌다(우선순위가 뒤집힌 것)
  ok(completionDateFrom(PERIOD_END, PLAN_END) !== PLAN_END,
    '(음성) 계획 종료일이 기간 종료일을 이기지 않는다', `계획=${PLAN_END}`)

  ok(completionDateFrom('', PLAN_END) === PLAN_END,
    '기간이 없으면 그 불량의 계획 종료일로 내려간다', completionDateFrom('', PLAN_END))
  ok(completionDateFrom(null, null) === '',
    '둘 다 없으면 빈 값 — 호출부가 거절해야 한다', `"${completionDateFrom(null, null)}"`)

  /* 🚨🚨 이 차수에서 가장 중요한 음성 대조.
     폴백을 오늘로 두면 기간을 정하지 않은 회차에서도 체크가 통하고, 근거 없는 날짜가
     별지 11호 「이행조치 일자」에 찍힌다 — 육안으로는 정상으로 보인다. */
  ok(completionDateFrom(null, null) !== TODAY,
    '(음성) 오늘 날짜로 떨어지지 않는다', `오늘=${TODAY}`)
  ok(completionDateFrom('', '') !== TODAY, '(음성) 빈 문자열에서도 오늘이 아니다')

  // 시각이 붙은 값(DB DATE가 문자열로 올 때)도 날짜만 남는다 — 그대로 두면 서식에 시각이 찍힌다
  ok(completionDateFrom('2026-08-15T00:00:00+09:00') === '2026-08-15', '시각이 붙어도 날짜만 쓴다')
  ok(completionDateFrom('  2026-08-15  ') === '2026-08-15', '앞뒤 공백을 흘리지 않는다')
  // 공백만 있는 값은 '있는 값'이 아니다 — 그렇게 세면 계획 종료일 폴백이 막힌다
  ok(completionDateFrom('   ', PLAN_END) === PLAN_END, '공백뿐인 기간은 없는 것으로 보고 내려간다')
}

console.log('\n── B. ⑤ 일괄 적용은 빈 칸만 채운다 ──')
{
  ok(isPlanFillTarget({ action_start: null, action_end: null }) === true, '둘 다 비면 대상')
  ok(isPlanFillTarget({}) === true, '칸 자체가 없어도 대상')
  ok(isPlanFillTarget({ action_start: '   ', action_end: '' }) === true, '공백뿐이면 대상')

  ok(isPlanFillTarget({ action_start: '2026-08-01', action_end: '2026-08-20' }) === false,
    '둘 다 있으면 건너뛴다 — 손으로 정한 일정을 덮지 않는다')
  /* 🚨 음성 — 「종료일만 보고」 판정하는 구현이면 여기서 true가 나온다. 그러면 빈 종료일만
     채워져 시작(9/30) > 종료(8/15)로 **기간이 뒤집히고** 저장 경로가 통째로 거절한다. */
  ok(isPlanFillTarget({ action_start: '2026-09-30', action_end: null }) === false,
    '(음성) 시작일만 있는 행도 건너뛴다 — 한쪽만 채우면 기간이 뒤집힌다')
  ok(isPlanFillTarget({ action_start: null, action_end: '2026-08-15' }) === false,
    '(음성) 종료일만 있는 행도 건너뛴다')
}

console.log('\n── C. 서버가 그 규칙을 실제로 부르는가 (배선) ──')
{
  const complete = inFn(ACTIONS, 'setDefectCompletionAction')
  ok(complete.length > 0, 'setDefectCompletionAction이 있다')
  /* 🚨 2026-09-11 계약 반전 — ⑤ 「기간 일괄 적용」은 **폐지됐다**(불량별 계획 기간 입력 자체가
     사라졌다 — 기간은 ④ 총 이행기간 하나다). 종전 이 자리의 양성 단언을 음성으로 갈아끼운다:
     이 액션이 되살아나면 「불량 행에 기간 복사본을 쓰는」 경로가 되돌아온 것이다. */
  ok(inFn(ACTIONS, 'applyActionPeriodToPlansAction').length === 0,
    '(음성) applyActionPeriodToPlansAction이 폐지됐다 — 기간 복사 경로가 없다')

  ok(complete.includes('completionDateFrom('), '⑥ 완료 경로가 파생 규칙을 부른다')

  /* 🚨 오늘 날짜를 만드는 코드가 완료 경로에 있으면 위 A의 음성 대조가 무의미해진다 —
     규칙은 ''를 돌려주는데 호출부가 거기서 오늘을 채워 넣으면 결과는 같기 때문이다. */
  for (const bad of ['new Date(', 'Date.now(', 'toISOString(']) {
    ok(!complete.includes(bad), `(음성) ⑥ 완료 경로에 오늘 날짜 생성이 없다: ${bad}`)
  }
  ok(/return \{ error: '총 이행기간이 아직 없습니다/.test(complete),
    '기간도 계획 종료일도 없으면 저장을 거절한다')

  // 칸을 지운 게 아니다 — 값은 여전히 들어가야 ⑤ 판정·별지 11호·갑지 엑셀이 산다
  ok(complete.includes('action_completed_at'), '완료일 칸에 여전히 값을 쓴다(칸을 없앤 게 아니다)')
  ok(complete.includes('action_completed_at: null'), '해제하면 null로 되돌린다 — ⑤도 함께 열린다')
  ok(count(ACTIONS, 'syncStepsAndRevalidate') >= 5, '새 경로도 단계 동기화를 부른다', String(count(ACTIONS, 'syncStepsAndRevalidate')))

  /* ⚠ 기간의 결정(수기>자동)과 파싱을 스스로 하면 문서와 갈린다 — `resolveActionPeriod`가 원천이다
     (별지 10·11호 PDF·갑지 엑셀이 타는 그 결정자. 파싱은 그 안의 manualActionPeriod가 한다).
     종전 단언은 splitRange 직접 호출을 물었는데, 액션이 더 위 계층(resolveActionPeriod)으로
     재배선되면서(6197d5c) 과녁이 옮겨졌다 — 단언도 그 계층을 본다. */
  ok(ACTIONS.includes('resolveActionPeriod('), '기간 결정은 resolveActionPeriod 공용을 쓴다(문서와 같은 결정자)')
  ok(!/\.split\(['"]\s*~/.test(ACTIONS), '(음성) 구분자를 직접 쪼개지 않는다')
}

console.log('\n── D. ⑥ 화면이 날짜 칸을 기본으로 그리지 않는가 (배선) ──')
{
  ok(GRID.includes('type="checkbox"'), '⑥ 기본 칸이 체크박스다')
  ok(GRID.includes('조치 완료`}'), '체크박스에 불량별 이름표가 붙는다(접근성·검사 앵커)')
  ok(GRID.includes('setDefectCompletionAction('), '체크가 전용 액션을 부른다')
  ok(GRID.includes('>완료</th>'), '열 제목이 「완료」다')
  // 🚨 음성 — 제목이 '완료일'로 돌아오면 손으로 치는 칸이 되돌아온 것이다
  ok(!GRID.includes('>완료일</th>'), '(음성) 열 제목이 「완료일」로 되돌아가지 않았다')

  /* 완료일 DateInput은 **접이식 안에만** 남는다. 밖으로 나오면 '쳐야 하는 칸'으로 읽혀
     이 차수가 없앤 일이 그대로 되돌아온다(예외 창구이지 기본 창구가 아니다). */
  const det = GRID.slice(GRID.indexOf('<details'), GRID.indexOf('</details>'))
  ok(det.includes('완료일'), '완료일 DateInput은 「날짜 수정」 접이식 안에 있다')
  ok(count(GRID, '완료일`}') === 1, '완료일 DateInput은 하나뿐이다(밖에 남은 사본이 없다)', String(count(GRID, '완료일`}')))

  ok(GRID.includes('getActionPeriodAction('), '표가 총 이행기간을 스스로 읽는다(부모 prop이 낡는 자리)')
  ok(GRID.includes('총 이행기간이 아직 없습니다'), '기간이 없으면 무엇을 먼저 해야 하는지 말한다')
  /* 🚨 2026-09-11 계약 반전 — ⑤의 계획 기간 열·[빈 칸에 일괄 적용]이 폐지됐다(중복 입력).
     되살아나면 「두 자리에서 기간을 고치는」 상태로 돌아간 것이다. */
  ok(!GRID.includes('applyActionPeriodToPlansAction('), '(음성) ⑤ 일괄 적용 배선이 없다')
  ok(!GRID.includes('계획 기간</th>'), '(음성) ⑤에 계획 기간 열이 없다')
  ok(!GRID.includes('계획 시작일`}'), '(음성) ⑤에 불량별 시작일 입력이 없다')
  ok(!GRID.includes('계획 종료일`}'), '(음성) ⑤에 불량별 종료일 입력이 없다')
}

console.log('\n── E. 이웃 표면(① 불량 카드)도 같은 규약인가 ──')
{
  /* 🚨 지적받은 표면만 고치면 **같은 형태의 이웃이 남는다**. 완료일을 쓰는 화면은 둘이고
     (⑤⑥ 불량표 · ① 불량 카드), 한쪽만 체크로 바꾸면 다른 쪽에서 여전히 손으로 치게 된다 —
     그리고 그렇게 들어간 날짜가 같은 칸에 실려 같은 서식에 인쇄된다. */
  ok(CARD.includes('setDefectCompletionAction('), '① 카드도 완료 체크 액션을 부른다')
  ok(CARD.includes('type="checkbox"'), '① 카드에 체크박스가 있다')
  ok(CARD.includes('조치 완료`}'), '① 카드 체크박스에 불량별 이름표가 붙는다')
  ok(!CARD.includes('조치완료일'), '(음성) 「조치완료일」 손입력 라벨이 사라졌다')

  /* ⚠ 이 카드는 [저장]이 **바뀐 칸만** 보낸다(F-27). 체크가 서버에 직접 쓰고 기준선을 안 옮기면
     그 뒤 [저장]이 **낡은 날짜를 되돌려 보낸다** — 되돌림은 화면에 아무 신호도 남기지 않는다. */
  ok(/syncedRef\.current = \{ \.\.\.syncedRef\.current, date: next \}/.test(CARD),
    '체크 저장이 부분 송신 기준선(syncedRef)도 함께 옮긴다')
  ok(CARD.includes('donePending'), '① 카드도 낙관 반영을 한다(누른 직후 체크가 풀리지 않게)')
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} 통과`)
process.exit(fail === 0 ? 0 : 1)
