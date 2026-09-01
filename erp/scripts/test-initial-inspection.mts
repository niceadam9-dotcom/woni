/** 최초점검 법령 판정 + 별지 3분기 체크 — **순수·무서버·무DB**
 *
 *  실행: npx tsx scripts/test-initial-inspection.mts
 *
 *  ## 이 검사가 고정하는 결함 둘
 *
 *  **F-1** 최초점검을 "이 ERP에 종합점검 이력이 0건인가"로 판정하고 있었다. 그건 *우리 DB에 언제
 *  등록했는가*를 잰 것이지 법령 축이 아니다 — 2009년 사용승인 건물을 새로 등록하면 별지 9호에
 *  `[√]최초점검`이 찍혔다(법정 서식 허위 기재). 법령은 **사용승인일부터 60일 이내**로 정한다.
 *
 *  **F-3** 별지 9호 3분기는 `inspection_type`만, 표지·공문 라벨은 `plan_type`을 봤다. 두 축이
 *  갈라져 **일반관리 고객의 별지 9호는 세 칸이 모두 빈칸**으로 나갔다(같은 묶음의 표지는 정확했다).
 *  운영 DB의 유일한 활성 고객(C003, 일반관리+종합)이 정확히 이 조합이다.
 *
 *  ## 돌연변이 대조군을 함께 둔 이유
 *  통과하는 단언과 **판별하는** 단언은 다르다. 아래 사례표가 각 축을 실제로 가르는지,
 *  판정을 일부러 망가뜨려 빨개지는 것까지 확인한다.
 */
import {
  isInitialByLaw, inspectionCheckboxes, inspectionTypeLabel, rowSubType,
  INITIAL_INSPECTION_DAYS, type SubType,
} from '../src/lib/inspection-round.ts'
import { daysBetween } from '../src/lib/kst-date.ts'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('— 최초점검 법령 판정 (사용승인일 + 60일)')

/** [사용승인일, 점검시작일, 행 점검종류, 기대값, 설명] */
type Case = [string | null, string | null, SubType, boolean, string]
const CASES: Case[] = [
  ['2009-01-15', '2009-01-15', '종합', true,  '당일(0일)'],
  ['2009-01-15', '2009-02-10', '종합', true,  '26일 — 기간 안'],
  ['2009-01-15', '2009-03-16', '종합', true,  '정확히 60일 — 경계 포함'],
  ['2009-01-15', '2009-03-17', '종합', false, '61일 — 경계 밖'],
  ['2009-01-15', '2009-01-14', '종합', false, '사용승인 하루 전 — 음수'],
  // ⭐ 이 건의 출발점이 된 질문 그대로: "사용승인 2009년 1월, 2026년 8월 점검"
  ['2009-01-15', '2026-08-27', '종합', false, '17년 뒤 점검 — 최초일 수 없다(회귀 방어선)'],
  ['2009-01-15', '2009-02-10', '작동', false, '작동점검은 종합의 하위 구분이 아니다'],
  [null,         '2026-08-27', '종합', false, '사용승인일 모름 — 켜지 않는다'],
  ['2009-01-15', null,         '종합', false, '점검일 모름 — 켜지 않는다'],
]

for (const [approval, start, sub, want, why] of CASES) {
  const got = isInitialByLaw(approval, start, sub)
  check(`${why} → ${want}`, got === want, `got=${got} (${approval} → ${start}, ${sub})`)
}

check(`법정 기간 상수가 60일`, INITIAL_INSPECTION_DAYS === 60, String(INITIAL_INSPECTION_DAYS))

// 2차는 rowSubType을 통과하면 무조건 '작동'이라 구조적으로 최초점검일 수 없다.
// 사용승인 다음 날짜를 줘도 켜지면 안 된다 — 2차만 따로 막는 게 아니라 축이 막는다.
check('종합 대상의 2차는 최초점검이 될 수 없다',
  isInitialByLaw('2009-01-15', '2009-01-20', rowSubType('종합', 2)) === false)
check('종합 대상의 1차는 기간 안이면 최초점검이다',
  isInitialByLaw('2009-01-15', '2009-01-20', rowSubType('종합', 1)) === true)

console.log('\n— 돌연변이 대조군 (판정을 망가뜨리면 사례표가 빨개지는가)')

type Pred = (a: string | null, b: string | null, s: SubType) => boolean
const inWindow = (a: string, b: string) => { const d = daysBetween(a, b); return d >= 0 && d <= 60 }
const MUTANTS: Array<[string, Pred]> = [
  ['상한(60일) 제거', (a, b, s) => s === '종합' && !!a && !!b && daysBetween(a, b) >= 0],
  ['음수 차단 제거',  (a, b, s) => s === '종합' && !!a && !!b && daysBetween(a, b) <= 60],
  ['작동 차단 제거',  (a, b, _s) => !!a && !!b && inWindow(a, b)],
  ['사용승인일 무시', (_a, _b, s) => s === '종합'],
  ['경계 off-by-one', (a, b, s) => s === '종합' && !!a && !!b && (() => { const d = daysBetween(a, b); return d >= 0 && d < 60 })()],
]
for (const [name, mutant] of MUTANTS) {
  const caught = CASES.filter(([a, b, s, want]) => mutant(a, b, s) !== want).length
  check(`변이 '${name}' 를 사례표가 잡는다 (${caught}건)`, caught > 0,
    '이 변이를 아무 사례도 못 가른다 — 사례표가 그 축을 안 보고 있다')
}

console.log('\n— 별지 3분기 체크 (작동 / 종합(최초, 그 밖의))')

/** [inspection_type, is_initial, plan_type, 켜져야 하는 칸, 설명] */
type CkCase = [string | null, boolean, string | null, 'op' | 'initial' | 'compEtc', string]
const CK: CkCase[] = [
  ['작동',     false, 'special_작동', 'op',      '작동 1차'],
  ['종합',     false, 'special_종합', 'compEtc', '그 밖의 종합점검'],
  ['종합',     true,  'special_종합', 'initial', '최초점검'],
  ['작동',     true,  'special_작동', 'op',      '작동이면 is_initial이 켜져 있어도 작동'],
  // ⭐ F-3 반례 — 운영 유일 활성 고객(C003 케이엔몰)의 조합. 종전엔 세 칸이 모두 빈칸이었다.
  ['일반관리', false, 'special_작동', 'op',      '일반관리 고객의 작동점검 (F-3 반례)'],
  ['일반관리', true,  'special_종합', 'initial', '일반관리 고객의 최초 종합점검 (F-3 반례)'],
  ['일반관리', false, 'special_종합', 'compEtc', '일반관리 고객의 그 밖의 종합점검 (F-3 반례)'],
  ['최초',     false, null,           'initial', '레거시 inspection_type=최초'],
]

for (const [itype, init, ptype, want, why] of CK) {
  const c = inspectionCheckboxes(itype, init, ptype)
  const on = c.ckOp ? 'op' : c.ckInitial ? 'initial' : 'compEtc'
  const count = [c.ckOp, c.ckInitial, c.ckCompEtc].filter(Boolean).length
  check(`${why} → ${want}`, on === want, `got=${on} (${itype}/${init}/${ptype})`)
  check(`  └ 정확히 한 칸만 켜진다`, count === 1, `켜진 칸 ${count}개`)
}

// ⭐ 구조적 방어선 — 라벨 축과 체크박스 축이 **모든 조합에서** 같은 답을 내는가.
// F-3의 원인은 두 축이 서로 다른 컬럼을 본 것이었다. 조합을 전수로 돌려 다시 갈라지면 즉시 빨개진다.
const TYPES = ['작동', '종합', '일반관리', '최초', null]
const PLANS = ['special_작동', 'special_종합', 'monthly', 'event', null]
let mismatched = 0, combos = 0
for (const t of TYPES) for (const p of PLANS) for (const init of [true, false]) {
  combos++
  const label = inspectionTypeLabel(t, init, p)
  const c = inspectionCheckboxes(t, init, p)
  const fromCk = c.ckOp ? '작동점검' : c.ckInitial ? '최초점검' : '종합점검'
  if (label !== fromCk) { mismatched++; console.log(`     · 어긋남 ${t}/${p}/${init}: 라벨=${label} 체크=${fromCk}`) }
}
check(`라벨 축과 체크박스 축이 전 조합에서 일치 (${combos}조합)`, mismatched === 0, `${mismatched}건 어긋남`)

// 위 단언이 공허하지 않은가 — 조합 수가 실제로 채워졌는지 본다(0조합이면 무엇이든 통과한다)
check(`조합 모집단이 비어 있지 않다`, combos === TYPES.length * PLANS.length * 2, String(combos))

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail === 0 ? 0 : 1)
