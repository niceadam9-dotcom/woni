/** 점검계획 기산점 축 — **순수·무서버·무DB**
 *
 *  실행: npx tsx scripts/test-plan-anchor-axis.mts
 *
 *  법령은 종합점검 시기를 사용승인일이 속하는 달로 정하는데, 앱은 2026-07-14 이후 점검계획일만
 *  기산점으로 썼다. 그렇다고 그냥 뒤집으면 안 된다 — 스테이징 실측에서 두 날짜가 다 있는 246건 중
 *  **(월) 불일치가 88건(35.8%)**이고, 계획일이 `2026-01-08`·`-09`·`-13`처럼 순차로 깔린 걸 보면
 *  그 불일치는 썩음이 아니라 **방문을 열두 달로 분산한 운영 결정**이다.
 *
 *  그래서 고객별 축(`plan_anchor_manual`)으로 가른다. 이 검사가 지키는 것은 두 가지다:
 *   ① 마이그레이션 155가 **적용되기 전**에는 기산점이 한 칸도 안 움직인다(레거시 폴백)
 *   ② 적용 후에는 manual=false 고객만 법정 축(사용승인일)을 탄다
 *
 *  ①이 깨지면 코드를 배포하는 순간 전 고객의 연간 일정이 재배치된다 — 이 파일에서 가장 중요한 축이다.
 */
import { resolveAnchor, anchorChanged, anchorSourceLabel, type AnchorInput } from '../src/lib/plan-anchor.ts'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const APPROVAL = '2009-02-13'   // 운영 C003 케이엔몰 실값
const MANUAL   = '2026-08-27'   // 같은 고객의 점검계획일 — 월이 다르다(2월 vs 8월)
const FIRST    = '2025-05-06'

console.log('— ① 컬럼 미적용(레거시): 사용승인일은 기산점이 되지 않는다')

// 마이그레이션 전에는 plan_anchor_manual이 undefined로 들어온다. 이때 동작은 **현행 그대로**여야 한다.
const legacyMatrix: Array<[AnchorInput, string | null, string]> = [
  [{ use_approval_date: APPROVAL, plan_anchor_date: MANUAL }, MANUAL, '둘 다 있으면 점검계획일'],
  [{ use_approval_date: APPROVAL }, null, '사용승인일만 있으면 기산점 없음(계획 미생성)'],
  [{ use_approval_date: APPROVAL, firstInspectionStart: FIRST }, FIRST, '사용승인일은 건너뛰고 최초 점검일로'],
  [{ plan_anchor_date: MANUAL, firstInspectionStart: FIRST }, MANUAL, '점검계획일이 최초 점검일보다 우선'],
  [{}, null, '아무것도 없으면 null'],
]
for (const [input, want, why] of legacyMatrix) {
  const r = resolveAnchor(input)
  check(`${why} → ${want ?? 'null'}`, r.date === want, `got=${r.date} (source=${r.source})`)
}
// null을 명시해도 '컬럼 없음'과 같게 다뤄야 한다 — PostgREST는 미적용 컬럼을 undefined로, 적용 후
// 값이 안 채워진 행을 null로 준다. 둘을 다르게 다루면 백필 전 창에서 축이 갈린다.
check('plan_anchor_manual=null도 레거시로 다룬다',
  resolveAnchor({ use_approval_date: APPROVAL, plan_anchor_date: MANUAL, plan_anchor_manual: null }).date === MANUAL)

console.log('\n— ② 적용 후: manual=false 고객만 법정 축을 탄다')

check('manual=false → 사용승인일이 기산점',
  resolveAnchor({ use_approval_date: APPROVAL, plan_anchor_date: MANUAL, plan_anchor_manual: false }).date === APPROVAL)
check('manual=false, 사용승인일 없음 → 점검계획일로 폴백',
  resolveAnchor({ plan_anchor_date: MANUAL, plan_anchor_manual: false }).date === MANUAL)
check('manual=true → 사람이 정한 점검계획일을 계속 쓴다',
  resolveAnchor({ use_approval_date: APPROVAL, plan_anchor_date: MANUAL, plan_anchor_manual: true }).date === MANUAL)
check('manual=true, 점검계획일 없음 → 사용승인일로 폴백',
  resolveAnchor({ use_approval_date: APPROVAL, plan_anchor_manual: true }).date === APPROVAL)

console.log('\n— source 표기 (기산점이 어디서 왔는지 사람이 알 수 있어야 한다)')
check('source=approval', resolveAnchor({ use_approval_date: APPROVAL, plan_anchor_manual: false }).source === 'approval')
check('source=manual',   resolveAnchor({ plan_anchor_date: MANUAL }).source === 'manual')
check('source=first',    resolveAnchor({ firstInspectionStart: FIRST }).source === 'first')
check('source=null',     resolveAnchor({}).source === null)
check('라벨이 전 source에 대해 비지 않는다',
  (['approval', 'manual', 'first', null] as const).every(s => anchorSourceLabel(s).length > 0))

console.log('\n— divergent (월 불일치 배지)')
check('월이 다르면 divergent (2월 vs 8월)',
  resolveAnchor({ use_approval_date: APPROVAL, plan_anchor_date: MANUAL }).divergent === true)
check('월이 같으면 divergent 아님 (일자만 달라도)',
  resolveAnchor({ use_approval_date: '2009-02-13', plan_anchor_date: '2026-02-27' }).divergent === false)
check('한쪽이 없으면 divergent 아님 — 비교할 대상이 없다',
  resolveAnchor({ use_approval_date: APPROVAL }).divergent === false)
// divergent는 어느 축을 쓰든 '어긋나 있다'는 사실이므로 manual 값에 좌우되면 안 된다
check('divergent는 manual 값과 무관하다',
  [undefined, true, false].every(m =>
    resolveAnchor({ use_approval_date: APPROVAL, plan_anchor_date: MANUAL, plan_anchor_manual: m }).divergent === true))

console.log('\n— 돌연변이 대조군')
// 가장 위험한 회귀: 레거시 폴백을 지워 마이그레이션 전에 사용승인일이 이기게 되는 것.
// 그 변이를 넣으면 위 ①의 첫 사례가 반드시 뒤집혀야 한다.
const mutantLegacyDropped = (c: AnchorInput) =>
  c.plan_anchor_manual === true ? (c.plan_anchor_date || null) : (c.use_approval_date || c.plan_anchor_date || null)
const flipped = legacyMatrix.filter(([input, want]) => mutantLegacyDropped(input) !== want).length
check(`변이 '레거시 폴백 제거'를 사례표가 잡는다 (${flipped}건)`, flipped > 0,
  '이 변이를 아무 사례도 못 가른다 — 마이그레이션 전 안전성이 검사되지 않고 있다')

const mutantIgnoreManual = (c: AnchorInput) => c.use_approval_date || c.plan_anchor_date || null
const flipped2 = [
  ...legacyMatrix.map(([i, w]) => [i, w] as const),
  [{ use_approval_date: APPROVAL, plan_anchor_date: MANUAL, plan_anchor_manual: true }, MANUAL] as const,
].filter(([input, want]) => mutantIgnoreManual(input) !== want).length
check(`변이 'manual 축 무시'를 사례표가 잡는다 (${flipped2}건)`, flipped2 > 0)

console.log('\n— 기산점 변경 판정 (재계산·확정 일정 팝업의 방아쇠)')

/** [설명, before, after, 기대] */
type ChCase = [string, AnchorInput, AnchorInput, boolean]
const CH: ChCase[] = [
  ['점검계획일 변경(레거시) → 움직인다',
    { plan_anchor_date: '2026-08-27' }, { plan_anchor_date: '2026-02-13' }, true],
  // ⭐ 이 건이 수리 대상이었다 — 종전 판정은 plan_anchor_date만 봐서 이걸 통째로 놓쳤다
  ['manual=false 고객의 사용승인일 변경 → 움직인다',
    { use_approval_date: '2009-02-13', plan_anchor_date: '2026-08-27', plan_anchor_manual: false },
    { use_approval_date: '2010-05-01', plan_anchor_date: '2026-08-27', plan_anchor_manual: false }, true],
  ['사용승인일 나중 입력(빈칸 → 값), manual=false → 움직인다',
    { use_approval_date: null, plan_anchor_date: '2026-08-27', plan_anchor_manual: false },
    { use_approval_date: '2009-02-13', plan_anchor_date: '2026-08-27', plan_anchor_manual: false }, true],
  // ⭐ 반대 방향도 정확해야 한다 — 예외 고객의 일정을 쓸데없이 흔들면 안 된다
  ['manual=true 고객의 사용승인일 변경 → 안 움직인다',
    { use_approval_date: '2009-02-13', plan_anchor_date: '2026-08-27', plan_anchor_manual: true },
    { use_approval_date: '2010-05-01', plan_anchor_date: '2026-08-27', plan_anchor_manual: true }, false],
  ['컬럼 미적용(레거시)에서 사용승인일 변경 → 안 움직인다 (기산점이 아니다)',
    { use_approval_date: '2009-02-13', plan_anchor_date: '2026-08-27' },
    { use_approval_date: '2010-05-01', plan_anchor_date: '2026-08-27' }, false],
  ['아무것도 안 바뀌면 → 안 움직인다',
    { use_approval_date: '2009-02-13', plan_anchor_date: '2026-08-27', plan_anchor_manual: false },
    { use_approval_date: '2009-02-13', plan_anchor_date: '2026-08-27', plan_anchor_manual: false }, false],
  ['manual=true 고객의 점검계획일 변경 → 움직인다',
    { use_approval_date: '2009-02-13', plan_anchor_date: '2026-08-27', plan_anchor_manual: true },
    { use_approval_date: '2009-02-13', plan_anchor_date: '2026-09-01', plan_anchor_manual: true }, true],
  ['manual=false 고객의 점검계획일 변경 → 안 움직인다 (사용승인일이 이긴다)',
    { use_approval_date: '2009-02-13', plan_anchor_date: '2026-08-27', plan_anchor_manual: false },
    { use_approval_date: '2009-02-13', plan_anchor_date: '2026-09-01', plan_anchor_manual: false }, false],
]
for (const [why, before, after, want] of CH) {
  check(`${why}`, anchorChanged(before, after) === want, `got=${anchorChanged(before, after)}`)
}

// 돌연변이 — 수리 **전**의 판정(plan_anchor_date만 비교)이 사례표에 걸리는가.
// 걸리지 않으면 이 사례표는 그 결함을 못 잡는다는 뜻이라 회귀 방어선이 못 된다.
const oldPredicate = (b: AnchorInput, a: AnchorInput) =>
  (a.plan_anchor_date ?? null) !== (b.plan_anchor_date ?? null)
const caught = CH.filter(([, b, a, want]) => oldPredicate(b, a) !== want).length
check(`변이 '점검계획일만 비교(수리 전)'를 사례표가 잡는다 (${caught}건)`, caught > 0,
  '이 변이를 아무 사례도 못 가른다 — 사용승인일 축이 검사되지 않고 있다')

// 대칭성 — 되돌리면 똑같이 '움직였다'로 나와야 한다(한 방향만 보면 정정이 절반만 반영된다)
const asym = CH.filter(([, b, a, want]) => anchorChanged(a, b) !== want).length
check('변경 판정이 방향에 무관하다(되돌림도 변경이다)', asym === 0, `${asym}건 비대칭`)

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
