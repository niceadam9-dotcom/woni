/** 잠정 기산점 — 「사용승인일을 아직 못 받은 고객」을 찾을 수 있는가 (2026-09-22 사용자 요청)
 *
 *  ## 왜 생겼나
 *  사용자 신고: 「달력에서 미래 날짜로 고객등록이 안 된다」. 파 보니 등록은 되고 있었고,
 *  **짚은 날짜에 안 앉을 뿐**이었다 — `resolveAnchor`가 사용승인일을 먼저 쓰기 때문이다.
 *  실측(스테이징): 점검일자·사용승인일 둘 다 있는 252명 중 **164명(65%)이 사용승인일에 밀렸고**,
 *  90명은 아예 달이 달랐다(예: 점검일자 2026-09-21 → 실제 1차 2026-12-02).
 *
 *  사용자 확정: **사용승인일 기준이 맞다.** 그러면 남는 문제는 「법정 기산점을 아직 못 받은
 *  고객」을 아무도 찾을 수 없다는 것이다 — 실측 55명(활성 308명의 18%, 최근 50명 중 28%).
 *
 *  ## 🚨 이 검사가 지키는 핵심 — 같은 이름이 **두 상황**을 덮고 있었다
 *  `anchorSourceLabel`은 둘 다 「점검일자」라고 부르는데 뜻이 정반대다:
 *   · `plan_anchor_manual=true` (87명) — 사람이 **일부러** 고른 예외. **확정**이다.
 *   · `manual=false` + 사용승인일 없음 (55명) — 법정 축을 못 구해 떠밀려 온 폴백. **잠정**이다.
 *  이 둘을 가르는 것이 `isProvisionalAnchor`의 전부다. `source`만 봐도, `use_approval_date`만
 *  봐도 갈리지 않는다.
 *
 *  ## ⚠ 잠정이어도 **일정은 막지 않는다**
 *  정기·종합·작동은 그대로 생성된다. 막으면 그 고객이 아무 일정도 못 받아 더 나빠진다 —
 *  사용승인일을 **못 내는** 건물이 실재한다(군부대·쉼터 등 건축물대장 조회 실패 건).
 *  바뀌는 것은 이름표뿐이고, 사용승인일이 들어오면 기존 `anchorChanged` 경로가 법정 자리로
 *  자동 재배치한다(이미 시작된 점검은 불가침).
 *
 *  실행: npx tsx scripts/test-provisional-anchor.mts   (DB·브라우저 불필요 — 순수 + 소스)
 */
// @ts-expect-error mjs 헬퍼
import { check, summary } from './_e2e-helpers.mjs'
import { readFileSync } from 'node:fs'
import { codeOnly, strippedStats } from './_code-only.mts'
import { isProvisionalAnchor, resolveAnchor, anchorSourceLabel } from '../src/lib/plan-anchor'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const NEW = '../src/components/customers/customer-new-client.tsx'
const BADGE = '../src/components/customers/anchor-change-preview.tsx'
const EDIT = '../src/components/customers/edit-customer-info-client.tsx'
const LIST = '../src/lib/customer-list.ts'
const LISTPAGE = '../src/app/(dashboard)/customers/page.tsx'

for (const [label, path] of [['new', NEW], ['badge', BADGE], ['edit', EDIT], ['list', LIST], ['listpage', LISTPAGE]] as const) {
  const st = strippedStats(read(path))
  check(`⓪ codeOnly가 ${label}에서 실제로 물었다`, st.leftover === 0 && st.removed > 0, JSON.stringify(st))
}
const newCode = codeOnly(read(NEW))
const badgeCode = codeOnly(read(BADGE))
const editCode = codeOnly(read(EDIT))
const listCode = codeOnly(read(LIST))
const listPageCode = codeOnly(read(LISTPAGE))

const A = '2008-12-02'   // 사용승인일
const P = '2026-09-21'   // 점검일자

// ══ ① 순수 판정 ═══════════════════════════════════════════════════════════
/* 🚨 이 검사의 핵심 — **같은 '점검일자'인데 답이 갈린다** */
check('①🎯 사용승인일 없음 + manual=false = **잠정**(떠밀려 온 폴백 — 실측 55명)',
  isProvisionalAnchor({ use_approval_date: null, plan_anchor_date: P, plan_anchor_manual: false }) === true)
check('①🎯 사용승인일 없음 + manual=true = **잠정 아님**(사람이 고른 예외 — 실측 87명)',
  isProvisionalAnchor({ use_approval_date: null, plan_anchor_date: P, plan_anchor_manual: true }) === false)
check('①🎯 두 상황의 라벨이 **같다**(그래서 라벨만으로는 못 가른다 — 이 함수가 있는 이유)',
  anchorSourceLabel(resolveAnchor({ use_approval_date: null, plan_anchor_date: P, plan_anchor_manual: false }).source)
  === anchorSourceLabel(resolveAnchor({ use_approval_date: null, plan_anchor_date: P, plan_anchor_manual: true }).source))

check('① 사용승인일 있음 + manual=false = 잠정 아님(법정 축이 실제로 쓰인다)',
  isProvisionalAnchor({ use_approval_date: A, plan_anchor_date: P, plan_anchor_manual: false }) === false)
check('① 사용승인일 있음 + manual=true = 잠정 아님(예외지만 사람 결정이다)',
  isProvisionalAnchor({ use_approval_date: A, plan_anchor_date: P, plan_anchor_manual: true }) === false)
/* ⚠ 기산점이 **아예 없으면** 계획도 안 생긴다 — 그건 잠정이 아니라 「없음」이다(다른 축) */
check('① 기산점 자체가 없으면 잠정이 아니다(「없음」과 「잠정」은 다른 상태)',
  isProvisionalAnchor({ use_approval_date: null, plan_anchor_date: null, plan_anchor_manual: false }) === false)
check('① 최초 점검일만 있어도 잠정이다(법정 축이 아닌 채 굴러간다)',
  isProvisionalAnchor({ use_approval_date: null, plan_anchor_date: null, plan_anchor_manual: false, firstInspectionStart: P }) === true)
/* 🚨 레거시(컬럼 미적용) — `!use_approval_date`로 물으면 **여기서 틀린다**.
   그 환경의 resolveAnchor는 사용승인일이 있어도 점검일자를 쓴다: 법정 날짜를 손에 쥐고도
   안 쓰는 상태를 「정상」이라 말하게 된다. 묻는 것은 보유가 아니라 **무엇이 실제로 쓰이는가**다. */
check('①🚨 레거시(manual=undefined) + 사용승인일 있음 = **잠정**(가지고도 안 쓴다)',
  isProvisionalAnchor({ use_approval_date: A, plan_anchor_date: P }) === true)
check('①🚨 그 상태의 실제 기산점이 정말 점검일자인가(위 단언의 전제 확인)',
  resolveAnchor({ use_approval_date: A, plan_anchor_date: P }).source === 'manual')
check('① 레거시 + manual=true는 여전히 잠정 아님',
  isProvisionalAnchor({ use_approval_date: A, plan_anchor_date: P, plan_anchor_manual: true }) === false)

// ══ ② 등록 폼 — 어느 칸이 이기는지 **입력 중에** 말하는가 ═══════════════════
check('② 등록 폼이 잠정 안내를 낸다', newCode.includes('new-anchor-provisional'))
check('② 사용승인일이 있으면 법정 기산점이라고 말한다', newCode.includes('new-anchor-legal'))
check('② 두 안내가 **배타**다(같은 조건의 양 갈래 — 둘 다 뜨거나 둘 다 안 뜨면 거짓말)',
  /isCompleteDate\(form\.use_approval_date\)\s*\?\s*\([\s\S]{0,600}?new-anchor-legal[\s\S]{0,600}?\)\s*:\s*\([\s\S]{0,800}?new-anchor-provisional/.test(newCode))
check('② 잠정 안내가 「일정은 그대로 생성된다」를 말한다(막힌 줄 알면 사용자가 멈춘다)',
  /new-anchor-provisional[\s\S]{0,700}?그대로 생성/.test(newCode))
check('② 잠정 안내가 「나중에 넣으면 재배치」를 말한다(그래야 고칠 이유가 생긴다)',
  /new-anchor-provisional[\s\S]{0,700}?재배치/.test(newCode))
/* ⛔ 막지 않는다 — 사용승인일을 못 내는 건물이 실재한다(군부대·쉼터) */
check('②⛔ 사용승인일을 **저장 차단 조건으로 쓰지 않는다**',
  !/setError\([^)]*사용승인일/.test(newCode))

// ══ ③ 고객 화면 배지 ══════════════════════════════════════════════════════
check('③ 배지가 잠정을 받는다', /provisional\?*:\s*boolean/.test(badgeCode))
check('③ 배지가 잠정을 그린다', badgeCode.includes('anchor-provisional'))
check('③ 잠정과 divergent는 **다른 축**이다(둘을 한 조건으로 합치지 않았다)',
  /provisional\s*&&/.test(badgeCode) && /divergent\s*&&/.test(badgeCode))
check('③ 고객 수정 화면이 배지에 잠정을 넘긴다',
  /provisional=\{isProvisionalAnchor\(anchorInput\)\}/.test(editCode))
check('③ 판정을 화면에서 다시 적지 않는다(공용 함수를 부른다)',
  editCode.includes('isProvisionalAnchor(') && !/source\s*!==\s*'approval'/.test(editCode))

// ══ ④ 목록 — 열지 않고 찾을 수 있는가 ═══════════════════════════════════════
check('④ 목록이 잠정을 계산해 싣는다', listCode.includes('provisionalAnchor:'))
check('④ 판정은 공용 함수 한 벌 — 목록이 자기 식으로 다시 세지 않는다',
  listCode.includes('isProvisionalAnchor(') && !/!\w*\.?use_approval_date\s*&&/.test(listCode.split('provisionalAnchor:')[1] ?? ''))
check('④ 판정 재료(plan_anchor_manual)를 실제로 조회한다 — 안 실으면 항상 레거시로 읽힌다',
  /select\(`?[^`]*plan_anchor_manual/.test(listCode))
check('④ 「잠정 기산점만」 필터가 있다', /f\.inc === 'approval'/.test(listCode))
check('④ 그 필터가 provisionalAnchor로 거른다',
  /f\.inc === 'approval'\)\s*return items\.filter\(i => i\.provisionalAnchor\)/.test(listCode))
check('④ 화면 드롭다운에 그 선택지가 있다', /<option value="approval">/.test(listPageCode))
check('④ 목록 행에 잠정 칩이 붙는다', listPageCode.includes('customer-row-provisional'))
check('④ 칩이 **서버가 준 값**을 읽는다(행에서 다시 세지 않는다)',
  /\{c\.provisionalAnchor && \(/.test(listPageCode))

// ══ ⑤ 달력 입구 — 패널을 안 열어도 등록할 수 있는가 ═════════════════════════
const CAL = '../src/components/inspections/inspection-calendar-client.tsx'
const calCode = codeOnly(read(CAL))
check('⑤ 달력 **칸**에 등록 입구가 있다(종전엔 데이 패널 안에만 있었다)',
  calCode.includes('calendar-cell-new-customer'))
check('⑤ 그 입구가 날짜를 그대로 넘긴다', /calendar-cell-new-customer[\s\S]{0,500}?openNewCustomer\(iso\)/.test(calCode))
/* 🚨 전파를 안 끊으면 칸 클릭이 데이 패널까지 같이 연다 */
check('⑤ 전파를 끊는다(칸 클릭과 겹치지 않게)',
  /calendar-cell-new-customer[\s\S]{0,500}?stopPropagation\(\)[\s\S]{0,60}?preventDefault\(\)/.test(calCode))
/* ⚠ 숨기면 호버 없는 환경에선 없는 것과 같다 — 흐리게 두되 **늘 있다** */
check('⑤ 흐리게 두되 숨기지 않는다(opacity-0가 아니다)',
  /calendar-cell-new-customer[\s\S]{0,600}?opacity-40/.test(calCode)
  && !/calendar-cell-new-customer[\s\S]{0,600}?opacity-0/.test(calCode))
check('⑤ 뜻으로 찾을 수 있다(aria-label)', /calendar-cell-new-customer[\s\S]{0,200}?aria-label=/.test(calCode))
check('⑤ 권한이 없으면 안 그린다', /canCreateCustomer && \([\s\S]{0,400}?calendar-cell-new-customer/.test(calCode))
/* 데이 패널 버튼은 이 줄에서 **유일한 채움**이어야 뜻이 산다 */
check('⑤ 데이 패널 등록 버튼이 채움색이다',
  /daypanel-new-customer[\s\S]{0,900}?bg-brand text-white/.test(calCode))
check('⑤ 형제 버튼(사전안내)은 테두리 그대로다 — 채움이 둘이면 강조가 죽는다',
  !/calendar-sms-day[\s\S]{0,600}?bg-brand text-white/.test(calCode))
/* ⛔ R8b 드래그와 충돌하는 슬롯 선택은 여전히 끄고 간다 */
check('⑤⛔ onSelectSlot은 켜지 않았다(칸 버튼으로 푼다)', !/onSelectSlot=/.test(calCode))

summary()
