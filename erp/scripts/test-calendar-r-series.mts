/** 점검달력 R3·R7·R8b — 「한 바퀴의 정본」 3종 (2026-09-22 사용자 요청)
 *
 *  R3  패널에 **1단계 점검기간** 한 줄(접힘)
 *  R7  한 바퀴가 끝난 회차를 **「종료됨」**으로
 *  R8b **1단계 칩 드래그**로 점검일자 이동 — 나머지 단계는 서버가 다시 깐다
 *
 *  ## 이 검사가 지키는 것 — 전부 **축**이다
 *  세 기능이 같은 함정 하나를 공유한다. 같은 점검에 단계 목록이 두 벌 돌아다닌다:
 *   · **의무 축**(`activeSteps.map` / `allStepsMap`) — 실제로 해야 하는 단계
 *   · **표시 축**(`visibleMap` / `stepsMap`) — 화면에 그릴 단계. 불량 0이면 ⑤⑥을 감춘다
 *  표시 축으로 세면 「4/4 = 100%」가 되는데 숨겨진 ⑤⑥이 미완일 수 있다. 그러면
 *   · R7은 **안 끝난 회차를 「종료됨」**으로 그리고,
 *   · R8b는 **이미 협회·소방서에 나간 날짜를 끌 수 있게** 한다.
 *  이 저장소에서 그 축 혼동은 이미 ⑤⑥이 분모에서 빠진 채 `status='completed'`가 **DB에
 *  기록된** 사고까지 갔다(`inspection-step-status`의 axisIncomplete 주석).
 *
 *  🚨 그래서 이 검사는 **순수 판정 + 배선**을 함께 묻는다. 판정 함수만 맞으면 소용없다 —
 *    사고는 늘 「맞는 함수에 틀린 축을 넘기는」 자리에서 났다.
 *
 *  ⚠ 소스 단언은 `codeOnly`로 주석을 걷고 한다. 이 저장소는 주석에 결함 내력을 길게 적는
 *    규약이라(위 머리말이 그 예다) 걷지 않으면 **코드를 지워도 초록**이 된다.
 *
 *  실행: npx tsx scripts/test-calendar-r-series.mts   (DB·브라우저 불필요 — 순수 + 소스)
 */
// @ts-expect-error mjs 헬퍼
import { check, summary } from './_e2e-helpers.mjs'
import { readFileSync } from 'node:fs'
import { codeOnly, strippedStats } from './_code-only.mts'
import { closedVerdict } from '../src/lib/inspection-closed'
import { canDragCalendarChip } from '../src/lib/calendar-drag'
import { daysFromRange, periodSummary } from '../src/lib/inspection-period'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const PAGE = '../src/app/(dashboard)/inspections/calendar/page.tsx'
const CLIENT = '../src/components/inspections/inspection-calendar-client.tsx'

// ══ 계측기 자기 검사 — 「걷어냈다고 믿는 것」과 「걷어낸 것」은 다르다 ═══════════════
for (const [label, path] of [['page', PAGE], ['client', CLIENT]] as const) {
  const st = strippedStats(read(path))
  check(`⓪ codeOnly가 ${label}에서 실제로 물었다 (남은 줄주석 0 · 지운 글자 >0)`,
    st.leftover === 0 && st.removed > 0, JSON.stringify(st))
}
const pageCode = codeOnly(read(PAGE))
const clientCode = codeOnly(read(CLIENT))

const step = (n: number, status: string, at: string | null = null) =>
  ({ step_num: n, status, completed_at: at })
const ALL6 = new Set([1, 2, 3, 4, 5, 6])
const PASS4 = new Set([1, 2, 3, 4])   // 점검표 모두 합격 — ⑤⑥은 해당없음
const MONTHLY = new Set([1])          // 정기는 유효 단계가 ① 하나(activeStepNums)

// ══ R7 ① 순수 판정 ════════════════════════════════════════════════════════
{
  const done6 = [1, 2, 3, 4, 5, 6].map(n => step(n, 'completed', `2026-09-1${n}T00:00:00Z`))
  const v = closedVerdict(done6, ALL6)
  check('R7① 의무 6단계 전부 완료 = 종료됨', v.closed === true)
  check('R7① 종료 시각 = **가장 늦게** 완료된 의무 단계', v.closedAt === '2026-09-16T00:00:00Z', String(v.closedAt))
  check('R7① 남은 단계 0', v.remaining === 0)
}
{
  const five = [1, 2, 3, 4, 5].map(n => step(n, 'completed')).concat([step(6, 'pending')])
  const v = closedVerdict(five, ALL6)
  check('R7① 하나라도 미완이면 종료가 아니다', v.closed === false)
  check('R7① 남은 수를 말한다', v.remaining === 1)
}
/* 🚨 이 검사의 핵심 — 「모두 합격」 회차. 의무 축이 ①~④이므로 ⑤⑥이 pending이어도 종료다.
   반대로 **의무 축을 ALL6으로 잘못 넘기면** 같은 회차가 영원히 안 끝난다(달력 4/6 사고). */
{
  const rows = [1, 2, 3, 4].map(n => step(n, 'completed')).concat([step(5, 'pending'), step(6, 'pending')])
  check('R7① 모두 합격(⑤⑥ 해당없음) — ①~④만 끝나면 종료됨', closedVerdict(rows, PASS4).closed === true)
  check('R7① 같은 회차라도 의무 축이 ALL6이면 종료가 아니다(축이 답을 바꾼다)',
    closedVerdict(rows, ALL6).closed === false)
}
/* 🚨 **표시 축을 넘기면 거짓 종료가 되는가** — 이 검사가 존재하는 이유.
   불량이 있는(의무=ALL6) 회차인데 화면이 표시 축 4개만 들고 판정하면 「종료됨」이 된다. */
{
  const visibleOnly = [1, 2, 3, 4].map(n => step(n, 'completed'))   // stepsMap(표시 축)이 주는 모양
  check('R7① 표시 축 4행만 넘기면 **거짓 종료**가 된다 — 그래서 호출부가 의무 축을 넘겨야 한다',
    closedVerdict(visibleOnly, PASS4).closed === true)
  const obligation = visibleOnly.concat([step(5, 'pending'), step(6, 'pending')])
  check('R7① 같은 회차를 의무 축으로 넘기면 「아직」이라고 옳게 답한다',
    closedVerdict(obligation, ALL6).closed === false)
}
check('R7① 정기(의무=①뿐) — ①만 끝나면 종료됨', closedVerdict([step(1, 'completed')], MONTHLY).closed === true)
/* ⚠ 기울기 — 못 잰 것은 「끝났다」가 아니다 */
check('R7① 단계 0건은 종료가 아니다(「없음」을 「완료 0건」으로 읽지 않는다)',
  closedVerdict([], ALL6).closed === false)
check('R7① 단계 0건은 remaining도 말하지 않는다(판정 자체를 못 한 것)',
  closedVerdict([], ALL6).remaining === undefined)
check('R7① 의무 집합이 비면 종료가 아니다(재료가 어긋났다는 뜻)',
  closedVerdict([step(1, 'completed')], new Set<number>()).closed === false)
check('R7① 의무 축을 안 주면 **받은 단계 전부**를 의무로 본다(모르면 참 — 조용히 빠지지 않게)',
  closedVerdict([step(1, 'completed'), step(2, 'pending')]).closed === false)
check('R7① overdue는 완료가 아니다', closedVerdict([step(1, 'overdue')], MONTHLY).closed === false)
check('R7① completed_at이 전부 비어도 종료는 말한다(시각만 null — 지어내지 않는다)',
  (() => { const v = closedVerdict([step(1, 'completed', null)], MONTHLY); return v.closed === true && v.closedAt === null })())

// ══ R7 ② 배선 — 서버가 **의무 축**을 넘기는가 ═══════════════════════════════
check('R7② page가 closedVerdict를 부른다', pageCode.includes('closedVerdict('))
/* 🚨 개수가 아니라 **인자**를 묻는다. `closedVerdict(stepsMap...)`로 바뀌면 여기가 빨개져야 한다 */
check('R7② 1인자가 allStepsMap(**거르기 전** 의무 축)이다',
  /closedVerdict\(\s*allStepsMap\.get\(insp\.id\)\s*\?\?\s*\[\]/.test(pageCode))
/* ⚠ `[^)]*`로 쓰면 안 된다 — 1인자 안의 `get(insp.id)` 닫는 괄호를 못 넘어 **멀쩡한 제품이
   빨갛게** 나온다(이 검사를 처음 돌렸을 때 실제로 그랬다). 두 인자를 통째로 적어 묻는다. */
check('R7② 2인자가 activeCal.map(의무)이다 — visibleMap(표시)이 아니다',
  /closedVerdict\(\s*allStepsMap\.get\(insp\.id\)\s*\?\?\s*\[\]\s*,\s*activeCal\.map\.get\(insp\.id\)\s*\)/.test(pageCode))
check('R7② 표시 축(stepsMap·visibleMap)을 closedVerdict에 넘기지 않는다',
  !/closedVerdict\([^)]*(stepsMap|visibleMap)/.test(pageCode))
/* 화면이 판정을 **다시 세지 않는가** — 서버가 준 값만 읽어야 한다 */
check('R7② 화면은 서버가 준 closed를 읽기만 한다(steps로 다시 세지 않는다)',
  clientCode.includes('closed?.closed') && !/closed:\s*.*steps\.filter/.test(clientCode))
check('R7② 「종료됨」 표식이 화면에 있다', clientCode.includes('종료됨'))
check('R7② 패널 배지 표식(daypanel-closed)', clientCode.includes('daypanel-closed'))
check('R7② 데이 패널 목록 표식(daypanel-row-closed)', clientCode.includes('daypanel-row-closed'))

// ══ R8b ① 순수 판정 ═══════════════════════════════════════════════════════
const OK = { allowed: true }
const NO = { allowed: false }
check('R8b① 1단계 칩 + 서버가 허용 = 끌린다',
  canDragCalendarChip({ kind: 'step', stepNum: 1, dateChange: OK }, true) === true)
/* 🚨 사용자 확정(2026-09-22): **드래그는 1단계만**. 나머지는 서버가 자동 재계산한다 */
for (const n of [2, 3, 4, 5, 6]) {
  check(`R8b① ${n}단계 칩은 안 끌린다(마감일은 점검일자에서 파생되는 값)`,
    canDragCalendarChip({ kind: 'step', stepNum: n, dateChange: OK }, true) === false)
}
check('R8b① 서버가 막으면(2단계 이상 완료) 1단계여도 안 끌린다',
  canDragCalendarChip({ kind: 'step', stepNum: 1, dateChange: NO }, true) === false)
/* ⚠ 판정을 못 받은 칩을 **열어 주지 않는다** — 모르면 닫는 쪽으로 기운다 */
check('R8b① dateChange가 없으면 안 끌린다(모름을 허용으로 읽지 않는다)',
  canDragCalendarChip({ kind: 'step', stepNum: 1 }, true) === false)
check('R8b① dateChange가 null이어도 안 끌린다',
  canDragCalendarChip({ kind: 'step', stepNum: 1, dateChange: null }, true) === false)
check('R8b① 권한이 없으면 1단계여도 안 끌린다(끌린 뒤 서버가 거절하는 화면을 만들지 않는다)',
  canDragCalendarChip({ kind: 'step', stepNum: 1, dateChange: OK }, false) === false)
/* 종전 경로가 그대로인가 — 내가 안 건드린 것을 단언한다 */
check('R8b① 미시작 정기 계획 칩은 종전대로 끌린다',
  canDragCalendarChip({ kind: 'plan', planType: 'monthly', planStatus: 'confirmed' }, true) === true)
check('R8b① 폐지된 planned 상태도 받아 준다(과거 행에서 칩이 조용히 안 잡히지 않게)',
  canDragCalendarChip({ kind: 'plan', planType: 'monthly', planStatus: 'planned' }, true) === true)
check('R8b① 완료된 정기 계획은 안 끌린다',
  canDragCalendarChip({ kind: 'plan', planType: 'monthly', planStatus: 'completed' }, true) === false)
/* 🚨 사용자 확정 — 자체점검은 **일부러 제외**한다(날짜 적용 = 점검 개시) */
for (const t of ['special_종합', 'special_작동', 'event']) {
  check(`R8b① ${t} 계획 칩은 안 끌린다(정기만)`,
    canDragCalendarChip({ kind: 'plan', planType: t, planStatus: 'confirmed' }, true) === false)
}
check('R8b① 일별 집계 칩(plan-group)은 안 끌린다(무엇이 옮겨졌는지 말할 수 없다)',
  canDragCalendarChip({ kind: 'plan-group', planType: 'monthly', planStatus: 'confirmed' }, true) === false)
check('R8b① kind가 없으면 안 끌린다', canDragCalendarChip({ stepNum: 1, dateChange: OK }, true) === false)

// ══ R8b ② 배선 ════════════════════════════════════════════════════════════
check('R8b② 달력이 판정 모듈을 쓴다(인라인으로 다시 짜지 않는다)',
  clientCode.includes('canDragCalendarChip') && clientCode.includes("from '@/lib/calendar-drag'"))
check('R8b② draggableAccessor가 그 함수 하나로 답한다',
  /draggableAccessor\s*=\s*useCallback\(\s*\(event[^)]*\)\s*=>\s*canDragCalendarChip\(/.test(clientCode))
/* 🚨 단계 칩에 kind·dateChange가 **실제로 실리는가**. 이게 빠지면 판정은 맞는데 칩이 안 잡힌다
   (종전에 kind가 타입에만 있고 안 실려 있었다 — 그 부류의 재발 방어) */
check('R8b② 단계 이벤트에 kind:\'step\'이 실린다', /kind:\s*'step'\s*as\s*const/.test(clientCode))
check('R8b② 단계 이벤트에 서버 판정(dateChange)이 실린다', /dateChange:\s*insp\.dateChange/.test(clientCode))
check('R8b② 단계 이벤트에 현재 점검일자가 실린다', /inspectionStartDate:\s*insp\.inspection_start_date/.test(clientCode))
/* 드롭이 **R8a 경로**로 가는가 — 새 서버 액션을 만들지 않았다는 단언 */
check('R8b② 드롭이 R8a 미리보기 모달을 연다', clientCode.includes('openDateChangeAt('))
check('R8b② 미리보기는 서버(previewInspectionDateChangeAction)가 계산한다',
  clientCode.includes('previewInspectionDateChangeAction('))
check('R8b② 저장은 R8a 액션 그대로(changeInspectionDateAction)',
  clientCode.includes('changeInspectionDateAction('))
/* ⚠ 미리보기 조회가 **id를 인자로** 받는가 — 상태에서 읽으면 드롭 경로가 통째로 건너뛰어진다 */
check('R8b② 미리보기 본체가 id를 인자로 받는다(드롭 시 상태는 아직 이전 값이다)',
  /fetchDateChangePreview\s*=\s*useCallback\(\s*\(id:\s*string,\s*to:\s*string\)/.test(clientCode))
/* 호출부가 **둘**이어야 한다: 입력칸(previewDateChange)과 드롭(openDateChangeAt).
   선언(`= useCallback`)과 의존성 배열(`, fetchDateChangePreview]`)은 `(`가 안 붙어 안 세어진다. */
check('R8b② 입력칸·드롭이 **같은** 미리보기 함수를 쓴다(두 벌이면 한쪽만 고쳐져 갈라진다)',
  (clientCode.match(/fetchDateChangePreview\(/g) ?? []).length === 2,
  String((clientCode.match(/fetchDateChangePreview\(/g) ?? []).length))
/* ⛔ 빈 칸 드래그는 켜지 않는다 — onEventDrop 제스처와 충돌 */
check('R8b② onSelectSlot을 켜지 않았다', !/onSelectSlot=/.test(clientCode))
/* 1단계 드롭은 **같은 달 제약이 없다**(해오름 9/12→9/18 같은 달 넘는 정정이 실재한다).
   ⚠ 「'step' 근처에 '같은 달'이 없다」로 물으면 안 된다 — 바로 뒤 정기 분기의 alert이 걸려
     멀쩡한 제품이 빨개진다. 물어야 하는 건 거리가 아니라 **순서**다: 단계 분기가
     `openDateChangeAt` 뒤 `return`으로 **빠져나간 다음**에 같은 달 가드가 온다. */
{
  const iStep = clientCode.indexOf("r.kind === 'step'")
  const iOpen = clientCode.indexOf('openDateChangeAt(', iStep)
  const iRet = clientCode.indexOf('return', iOpen)
  const iMonth = clientCode.indexOf('같은 달 안에서만', iStep)
  check('R8b② 1단계 드롭은 같은 달 가드 **앞에서** 빠져나간다',
    iStep > -1 && iOpen > iStep && iRet > iOpen && iMonth > iRet,
    JSON.stringify({ iStep, iOpen, iRet, iMonth }))
}
/* 🚨 위 순서 단언만으로는 **분기가 안 끝나도** 통과한다 — `return`을 지우면 뒤따르는 정기
   분기의 `if (to === from) return`이 대신 잡혀 순서가 그대로 성립한다. 그러면 드롭 한 번에
   점검일자 모달과 계획 이동 팝업이 **둘 다** 뜬다. 분기가 `openDateChangeAt` → `return` →
   `}`로 **닫히는지**를 직접 묻는다(변이 M10이 이 줄을 세운다). */
check('R8b② 단계 분기가 openDateChangeAt 뒤 return으로 **닫힌다**(정기 분기로 흘러내리지 않는다)',
  /openDateChangeAt\([^)]*\)\s*\n\s*return\s*\n\s*\}/.test(clientCode))

// ══ R3 ① 순수 — 일수는 기간에서 센다, 저장값과 맞대 본다 ═══════════════════════
check('R3① 종료일이 없으면 당일(1일)', daysFromRange('2026-09-14', null) === 1)
check('R3① 9/14~9/18은 5일(양끝 포함 — 별지 9호와 같은 셈법)',
  daysFromRange('2026-09-14', '2026-09-18') === 5)
{
  const s = periodSummary('2026-09-14', '2026-09-18', 5)
  check('R3① 다일은 범위로 적는다', s.text === '2026-09-14 ~ 2026-09-18 · 5일', s.text)
  check('R3① 일치하면 어긋남이 아니다', s.mismatch === false)
}
check('R3① 당일은 「당일」로 적는다(9/14 ~ 9/14은 소음)',
  periodSummary('2026-09-14', null, 1).text === '2026-09-14 · 당일')
/* 🚨 이 검사의 R3쪽 핵심 — **실측된 결함 모양 그대로**(기간 5일 · 저장값 1일).
   여기가 초록이면 화면은 5일이라 말하고 별지 9호는 1일을 인쇄한다. */
{
  const s = periodSummary('2026-09-14', '2026-09-18', 1)
  check('R3① 기간 5일인데 저장값이 1이면 **어긋남을 말한다**', s.mismatch === true)
  check('R3① 본문은 **기간에서 센 값**을 쓴다(저장값을 따라가지 않는다)', s.days === 5)
  check('R3① 저장값도 함께 내보낸다(화면이 둘을 나란히 보여줄 수 있게)', s.storedDays === 1)
}
check('R3① 저장값이 없으면 어긋났다고 말하지 않는다(비교할 근거가 없다)',
  periodSummary('2026-09-14', '2026-09-18', null).mismatch === false)
check('R3① 시작일이 없으면 —', periodSummary(null, null, 1).text === '—')

// ══ R3 ② 배선 ═════════════════════════════════════════════════════════════
check('R3② 서버가 종료일·일수를 싣는다',
  pageCode.includes('inspection_end_date') && pageCode.includes('inspection_days'))
check('R3② select 문에 두 칸이 들어 있다',
  /\.select\('id, customer_id, inspection_type, plan_type, year, sequence_num, inspection_start_date, inspection_end_date, inspection_days,/.test(pageCode))
/* 🚨 「periodMismatch가 소스에 있는가」로 물으면 안 된다 — 식별자만 남기고 `= false`로 바꿔도
   초록이다(변이 M14가 그렇게 뚫었다). 셈과 판정을 **순수 함수로 밀어내고** 값은 위 ①이 센다.
   여기서는 화면이 그 함수를 쓰는지, 자기 손으로 다시 세지 않는지만 묻는다. */
check('R3② 화면이 셈을 **공용 함수에 맡긴다**',
  clientCode.includes('periodSummary(') && clientCode.includes("from '@/lib/inspection-period'"))
check('R3② 화면이 어긋남을 **직접 계산하지 않는다**(판정 두 벌 금지)',
  !/const\s+periodMismatch\s*=/.test(clientCode) && !/periodStoredDays\s*!==\s*periodDays/.test(clientCode))
check('R3② 어긋남을 화면이 **실제로 읽는다**(계산만 하고 안 쓰면 소용없다)',
  /period\.mismatch/.test(clientCode))
check('R3② 어긋나면 화면에 말한다(접힌 채로도 보이는 표식)',
  clientCode.includes('daypanel-period-mismatch'))
check('R3② 점검기간 줄 표식(daypanel-period)', clientCode.includes('daypanel-period'))
/* 접힘이 기본인가 — <details>에 open이 붙어 있으면 「접힌 한 줄」이 아니다.
   ⚠ testid **뒤**만 보면 안 된다: `<details open data-testid=...>`처럼 앞에 붙으면 못 잡는다
     (변이 M16이 정확히 그 자리로 빠져나갔다). 여는 태그 전체를 떼어 내 속성으로 묻는다. */
{
  const tag = clientCode.match(/<details[^>]*daypanel-period[^>]*>/)?.[0] ?? ''
  check('R3② 점검기간 줄이 <details>로 접힌다', tag !== '', tag)
  check('R3② 기본이 접힘이다(여는 태그에 open 속성이 없다)',
    tag !== '' && !/\bopen\b/.test(tag), tag)
}

summary()
