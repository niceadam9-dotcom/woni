/** 「등록했는데 단계가 없다」를 없애는 축 — 순수 + 배선 단언 (2026-09-22)
 *  실행: npx tsx scripts/test-past-anchor.mts   — **서버·DB 불필요**
 *
 *  ## 무엇이 걸려 있나
 *  점검일자가 **과거·오늘**이면 1차 점검이 즉시 시작돼 달력에 1~4단계가 생긴다.
 *  **미래**면 계획 항목만 생기고 단계는 점검 당일에 열린다(`applyPastAnchorInspection`).
 *
 *  달력에서 날짜를 짚어 등록할 수 있게 되면서 **미래 날짜를 고를 문이 열렸다.** 그런데
 *  종전에는 그 결과가 화면으로 올라오지 않았다 — 호출부가 `applied.applied`를 버렸고
 *  `createCustomerAction` 반환에도 없었다. 그 상태로 「1~4단계가 생겼습니다」를 띄우면
 *  **제품이 거짓말을 한다.**
 *
 *  🚨 급소 셋:
 *    ① 경계는 **오늘 포함**(`<=`). 오늘 점검하고 그날 등록하는 것이 가장 흔한 흐름이다.
 *    ② 판정식이 **한 벌**이어야 한다 — 폼(클라이언트)과 서버가 같은 함수를 봐야
 *       「생긴다고 했는데 안 생기는」 어긋남이 안 생긴다.
 *    ③ 그래서 그 함수는 **순수 모듈**(plan-anchor)에 있어야 한다.
 *       `inspection-start`는 `next/cache`를 들여와 클라이언트가 못 쓴다(tsc는 0인데 런타임이 깨진다).
 */
import { readFileSync } from 'node:fs'
import { isPastAnchor } from '../src/lib/plan-anchor.ts'
import { codeOnly } from './_code-only.mts'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean | (() => boolean), detail = '') => {
  let v: boolean
  try { v = typeof cond === 'function' ? cond() : cond }
  catch (e) { fail++; console.log(`  ❌ ${name} — 단언 중 예외: ${e instanceof Error ? e.message : String(e)}`); return }
  if (v) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('— ① 경계 3점 (오늘은 **참**)')
ok('어제 → 과거다', isPastAnchor('2026-09-21', '2026-09-22'))
ok('★ 오늘 → 과거다 (가장 흔한 흐름: 점검하고 그날 등록)', isPastAnchor('2026-09-22', '2026-09-22'))
ok('내일 → 과거가 아니다', !isPastAnchor('2026-09-23', '2026-09-22'))
ok('해 넘김도 문자열 비교로 옳다(ISO)', isPastAnchor('2025-12-31', '2026-01-01') && !isPastAnchor('2027-01-01', '2026-12-31'))

console.log('\n— ③ 판정식이 **순수 모듈**에 있다 (클라이언트가 쓸 수 있어야 한다)')
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
{
  const anchor = read('../src/lib/plan-anchor.ts')
  ok('★ plan-anchor가 서버 전용 모듈을 들여오지 않는다',
    !/from ['"]next\/(cache|headers)['"]|server-only/.test(anchor))
  ok('isPastAnchor가 거기에 있다', /export function isPastAnchor/.test(anchor))
  const start = read('../src/lib/inspection-start.ts')
  ok('★ 서버도 같은 함수를 쓴다 (사본을 만들지 않았다)',
    /import \{ isPastAnchor \} from '@\/lib\/plan-anchor'/.test(start)
    && /if \(!isPastAnchor\(anchorDate, todayKst\(\)\)\) return \{ applied: false \}/.test(start))
  ok('음성 — inspection-start에 판정식이 다시 인라인되지 않았다',
    !/anchorDate > todayKst\(\)/.test(start))
}

console.log('\n— ② 결과가 화면까지 올라온다')
{
  const actions = codeOnly(read('../src/app/(dashboard)/customers/actions.ts'))
  const form = codeOnly(read('../src/components/customers/customer-new-client.tsx'))
  const client = codeOnly(read('../src/components/inspections/inspection-calendar-client.tsx'))

  ok('★ 헬퍼가 applied를 **버리지 않고** 돌려준다',
    /return \{ anchorApplied: applied\.applied, startedInspectionId: applied\.inspectionId \}/.test(actions))
  ok('★ createCustomerAction이 그 값을 반환한다',
    /anchorApplied: planResult\.anchorApplied/.test(actions)
    && /startedInspectionId: planResult\.startedInspectionId/.test(actions))
  ok('★ 미래 경로에서도 달력이 revalidate된다 (계획 칩이 바로 보여야 한다)', () => {
    const fn = actions.slice(actions.indexOf('async function _autoCreatePlanItemsForNewCustomer'))
    const rev = fn.indexOf("revalidatePath('/inspections/calendar')")
    const guard = fn.indexOf('if (applied.applied)')
    return rev > 0 && guard === -1        // applied일 때만 도는 가드가 없어야 한다
  })
  ok('폼이 서버 값을 그대로 넘긴다 (다시 판정하지 않는다)',
    /anchorApplied: result\.anchorApplied === true/.test(form))
  ok('★ 등록 전 안내가 **같은 순수 함수**로 판정한다',
    /!isPastAnchor\(form\.plan_anchor_date, todayKst\(\)\)/.test(form))
  ok('안내는 막지 않는다 — 제출 버튼 조건에 날짜 축이 없다',
    !/requiredOk[^\n]*isPastAnchor|isPastAnchor[^\n]*requiredOk/.test(form))

  ok('★ 달력 띠가 서버 값으로 두 갈래를 가른다', /created\.anchorApplied \?/.test(client))
  ok('시작된 경우 — **화면을 떠나지 않고** 그 회차 패널을 연다',
    /created-open-step1[\s\S]{0,300}?setSelectedInspectionId\(created\.startedInspectionId!\)/.test(client))
  ok('계획만 생긴 경우 — 그 날짜 데이 패널을 연다',
    /created-open-plan[\s\S]{0,300}?setDayPanelDate\(created\.anchorDate\)/.test(client))
  ok('음성 — 달력이 날짜를 다시 비교해 추측하지 않는다',
    !/isPastAnchor/.test(client))
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
