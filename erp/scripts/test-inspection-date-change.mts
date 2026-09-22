/** 점검일자 변경 가드 — 순수 단언 (2026-09-22)
 *  실행: npx tsx scripts/test-inspection-date-change.mts   — **서버·DB 불필요**
 *
 *  이 가드가 지키는 것은 「사용자가 불편한가」가 아니라 **제출한 서류와 ERP가 어긋나는가**다.
 *  2단계(배치신고)부터는 협회·소방서에 **이미 나간 날짜**가 있다. 기산일을 움직이면
 *  그 서류와 ERP가 갈라지고, 그 갈라짐은 인쇄물을 열어 보기 전까지 화면상 멀쩡해 보인다.
 *
 *  🚨 급소 둘:
 *    ① **빈 배열을 통과시키면 안 된다.** 단계를 못 받은 것을 「완료 0건」으로 읽으면
 *       조회 실패가 곧 「마음대로 옮겨도 됨」이 된다. 기울기는 닫는 쪽이다.
 *    ② **판정은 의무 축(전 단계)** 이다. 표시 축(불량 0이면 ⑤⑥ 숨김)으로 세면
 *       숨겨진 단계의 완료를 못 보고 통과시킨다 — 그래서 ⑤⑥만 완료인 표본을 일부러 넣는다.
 */
import { readFileSync } from 'node:fs'
import { dateChangeVerdict, type StepLite } from '../src/lib/inspection-date-change.ts'
import { codeOnly } from './_code-only.mts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean | (() => boolean), detail = '') => {
  let v: boolean
  try { v = typeof cond === 'function' ? cond() : cond }
  catch (e) { fail++; console.log(`  ❌ ${name} — 단언 중 예외: ${e instanceof Error ? e.message : String(e)}`); return }
  if (v) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** 6단계 표본 — done에 든 번호만 완료 */
const steps = (done: number[]): StepLite[] => [
  { step_num: 1, name_ko: '1단계: 점검일', status: done.includes(1) ? 'completed' : 'pending' },
  { step_num: 2, name_ko: '2단계: 배치확인서 보고서 작성', status: done.includes(2) ? 'completed' : 'pending' },
  { step_num: 3, name_ko: '3단계: 관계인 보고서 제출', status: done.includes(3) ? 'completed' : 'pending' },
  { step_num: 4, name_ko: '4단계: 소방서 보고서 제출 및 이행계획서 등록', status: done.includes(4) ? 'completed' : 'pending' },
  { step_num: 5, name_ko: '5단계: 보수·증빙', status: done.includes(5) ? 'completed' : 'pending' },
  { step_num: 6, name_ko: '6단계: 이행완료', status: done.includes(6) ? 'completed' : 'pending' },
]

console.log('— 허용되는 구간 (사용자 확정: 1단계만 완료면 허용)')
ok('아무것도 완료 안 됨 → 허용', dateChangeVerdict(steps([])).allowed)
ok('★ 1단계만 완료 → 허용 (정정이 거의 이 구간에서 일어난다)', dateChangeVerdict(steps([1])).allowed)
ok('허용일 때 사유는 없다', dateChangeVerdict(steps([1])).reason === undefined)
ok('허용일 때 blockedBy도 없다', dateChangeVerdict(steps([1])).blockedBy === undefined)

console.log('\n— 막히는 구간 (2단계 이상이 하나라도 완료)')
for (const n of [2, 3, 4, 5, 6]) {
  const v = dateChangeVerdict(steps([1, n]))
  ok(`${n}단계 완료 → 거부`, !v.allowed, JSON.stringify(v))
  ok(`${n}단계 완료 → blockedBy = ${n}`, v.blockedBy === n, String(v.blockedBy))
}

console.log('\n— ★ 막은 단계를 이름으로 말한다 (「안 된다」만 하면 무엇을 되돌릴지 모른다)')
{
  const v = dateChangeVerdict(steps([1, 2]))
  ok('사유에 단계 번호가 있다', !!v.reason?.includes('2단계'), v.reason)
  ok('사유에 단계 이름이 있다', !!v.reason?.includes('배치확인서'), v.reason)
  ok('사유가 왜 막는지를 말한다(제출 서류와 어긋남)', !!v.reason?.includes('서류'), v.reason)
}

console.log('\n— ★ 여럿이 완료면 **가장 이른** 단계를 짚는다')
{
  const v = dateChangeVerdict(steps([1, 3, 5, 6]))
  ok('3·5·6 완료 → blockedBy = 3 (가장 이른 것)', v.blockedBy === 3, String(v.blockedBy))
}

console.log('\n— ★ 표시 축으로 세면 뚫린다 — ⑤⑥만 완료인 표본이 막혀야 한다')
{
  // 불량 0이면 화면은 ⑤⑥을 숨긴다. 숨겨진 단계가 완료일 수 있고, 그걸 못 보면 통과시킨다.
  const v = dateChangeVerdict(steps([5]))
  ok('5단계만 완료(화면엔 안 보이는 축) → 거부', !v.allowed, JSON.stringify(v))
  ok('5단계만 완료 → blockedBy = 5', v.blockedBy === 5, String(v.blockedBy))
}

console.log('\n— ★ 빈 배열은 허용이 아니다 (조회 실패를 「완료 0건」으로 읽으면 안 된다)')
{
  const v = dateChangeVerdict([])
  ok('단계 0건 → 거부', !v.allowed)
  ok('단계 0건 → 사유가 「불러오지 못했다」로 말한다', !!v.reason?.includes('불러오지'), v.reason)
  ok('단계 0건 → blockedBy는 없다(막은 단계가 아니라 못 잰 것)', v.blockedBy === undefined)
}

console.log('\n— 경계')
{
  ok('이름이 없어도 번호로 말한다', () => {
    const v = dateChangeVerdict([
      { step_num: 1, status: 'completed' },
      { step_num: 2, status: 'completed' },
    ])
    return !v.allowed && !!v.reason?.includes('2단계')
  })
  ok('overdue는 완료가 아니다 (막지 않는다)', () => {
    const s = steps([1]).map(x => (x.step_num === 2 ? { ...x, status: 'overdue' } : x))
    return dateChangeVerdict(s).allowed
  })
  ok('순서가 뒤섞여 들어와도 가장 이른 것을 짚는다', () => {
    const s = [...steps([1, 2, 4])].reverse()
    return dateChangeVerdict(s).blockedBy === 2
  })
}

console.log('\n— 배선 — 판정이 **한 벌**이고, 서버가 **거르기 전 축**으로 잰다')
{
  const page = codeOnly(readFileSync(new URL('../src/app/(dashboard)/inspections/calendar/page.tsx', import.meta.url), 'utf8'))
  const client = codeOnly(readFileSync(new URL('../src/components/inspections/inspection-calendar-client.tsx', import.meta.url), 'utf8'))
  const actions = codeOnly(readFileSync(new URL('../src/app/(dashboard)/inspections/plan-date-actions.ts', import.meta.url), 'utf8'))

  ok('달력 서버가 dateChangeVerdict를 들여온다', /import\s*\{[^}]*dateChangeVerdict/.test(page))
  ok('★ 판정에 **거르기 전** allStepsMap을 넘긴다 (표시 축 stepsMap이 아니다)',
    /dateChange:\s*dateChangeVerdict\(\s*allStepsMap\.get/.test(page),
    page.match(/dateChange:\s*dateChangeVerdict\([^\n]*/)?.[0] ?? '(없음)')
  ok('음성 — 표시 축(stepsMap)으로 판정하지 않는다',
    !/dateChangeVerdict\(\s*stepsMap\.get/.test(page))
  ok('allStepsMap이 isStepVisible **앞**에서 채워진다 (뒤면 거른 것만 담긴다)', () => {
    const push = page.indexOf('allStepsMap.get(s.inspection_id)!.push(s)')
    const skip = page.indexOf('if (!isStepVisible(')
    return push > 0 && skip > 0 && push < skip
  })

  ok('서버 액션도 같은 판정식을 쓴다', /import\s*\{[^}]*dateChangeVerdict/.test(actions))
  // 🚨 앵커 없이 `const verdict = …` 를 찾으면 **미리보기 함수의 같은 두 줄**에 걸린다
  //   (변이 M6가 그렇게 뚫었다 — 적용 함수의 거부를 지웠는데 초록이었다).
  //   반드시 `changeInspectionDateAction` **안쪽**을 물어야 한다.
  {
    const changeFn = actions.slice(actions.indexOf('export async function changeInspectionDateAction'))
    ok('★ changeInspectionDateAction이 **저장 전에** 판정하고 거부한다',
      changeFn.length > 0
        && /const verdict = dateChangeVerdict\(steps\)/.test(changeFn)
        && /if \(!verdict\.allowed\) return \{ error: verdict\.reason/.test(changeFn)
        && changeFn.indexOf('if (!verdict.allowed) return') < changeFn.indexOf('syncInspectionVisitDate'),
      changeFn ? '적용 함수 안에서 거부가 사라졌거나 동기화 뒤로 밀렸다' : '(함수를 못 찾음)')
  }
  ok('★ 마감일을 스스로 계산하지 않고 resolveStepDates를 쓴다',
    /changeInspectionDateAction[\s\S]*?resolveStepDates\(admin, newDate\)/.test(actions))
  ok('★ 단계·방문일 동기화를 기존 정본 함수로 한다',
    /syncInspectionStepDates\(admin, inspectionId, dates\)/.test(actions)
    && /syncInspectionVisitDate\(admin, inspectionId, newDate\)/.test(actions))
  ok('없는 곳을 가리키던 안내가 고쳐졌다 (점검 상세 → 점검달력)',
    !/날짜는 점검 상세에서 변경해주세요/.test(actions) && /점검달력에서 그 회차를 열고/.test(actions))

  ok('패널이 서버가 준 dateChange로 가린다', /selectedInspection\.dateChange\?\.allowed/.test(client))
  ok('음성 — 클라이언트가 steps로 다시 세지 않는다',
    !/dateChangeVerdict\(/.test(client) && !/step_num\s*>=\s*2/.test(client))
  ok('막혔을 때 **사유를 그 자리에 적는다**', /anchor-date-blocked/.test(client)
    && /selectedInspection\.dateChange\?\.reason/.test(client))
  ok('미리보기를 서버에 묻는다(화면에서 마감일을 흉내 내지 않는다)',
    /previewInspectionDateChangeAction\(/.test(client))
  ok('표식 — 왕복 검사용 testid', /data-testid=["']anchor-date-edit["']/.test(client)
    && /data-testid=["']anchor-date-modal["']/.test(client))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
