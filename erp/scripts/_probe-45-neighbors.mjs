/** 소방계획서_45 §S13 — 「모두 합격이면 ⑤⑥ 해당없음」 축의 **이웃 규약** 정적 검사.
 *
 *  ⭐이 파일이 있는 이유: 이 차수는 독립 판정을 **세 번** 받았고, 세 번 다 잡힌 것이 같은 형태였다.
 *   1차: 축을 넓혔더니 이웃이 못 따라왔다(4건)
 *   2차: 내가 방금 세운 규칙을 내가 방금 쓴 코드가 어겼다(6건)
 *   3차: 그 수리 커밋 **자신 안에서** 또 「셋 중 둘」이 재생산됐다(12건)
 *  판정자는 매번 사람이었고, 매번 **같은 것**을 찾았다. 사람이 세 번 찾은 것은 검사로 내려야 한다.
 *
 *  ⚠ 이 검사는 **정적**이다 — 값이 옳은지는 못 본다(그건 test-inspection-steps-sync가 본다).
 *  여기서 고정하는 것은 「이 표면이 그 축을 **읽기는 하는가**」뿐이다. 3차 판정에서 화면 다섯 곳이
 *  틀린 값을 낸 것이 아니라 **축을 아예 안 읽고 있었다**는 것이 요점이었다.
 *
 *  실행: node scripts/_probe-45-neighbors.mjs */
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const read = p => { try { return readFileSync(p, 'utf8') } catch { return null } }

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}
/** 파일이 있고 그 안에 패턴이 있는가 — 파일 부재를 '통과'로 읽지 않는다(공허 통과 차단) */
function has(name, path, re, detail = '') {
  const src = read(path)
  if (src === null) { fail++; console.log(`  ❌ ${name} — 파일 없음: ${path}`); return }
  ok(name, re.test(src), detail)
}
function lacks(name, path, re, detail = '') {
  const src = read(path)
  if (src === null) { fail++; console.log(`  ❌ ${name} — 파일 없음: ${path}`); return }
  ok(name, !re.test(src), detail)
}

const SRC = 'src'
const P = {
  status: `${SRC}/lib/inspection-step-status.ts`,
  sync: `${SRC}/lib/inspection-step-sync.ts`,
  active: `${SRC}/lib/active-steps.ts`,
  paginate: `${SRC}/lib/supabase/paginate.ts`,
  docs: `${SRC}/app/(dashboard)/reports/docs-actions.ts`,
  list: `${SRC}/app/(dashboard)/inspections/page.tsx`,
  custDetail: `${SRC}/app/(dashboard)/customers/[id]/page.tsx`,
  custList: `${SRC}/lib/customer-list.ts`,
  cron: `${SRC}/app/api/cron/inspection-deadline-notify/route.ts`,
  cronDefect: `${SRC}/app/api/cron/defect-action-notify/route.ts`,
  layout: `${SRC}/app/(dashboard)/layout.tsx`,
  dash: `${SRC}/app/(dashboard)/dashboard/page.tsx`,
  cal: `${SRC}/app/(dashboard)/inspections/calendar/page.tsx`,
  planActions: `${SRC}/app/(dashboard)/inspection-plans/actions.ts`,
  mySched: `${SRC}/app/(dashboard)/my/schedules/page.tsx`,
  custDocs: `${SRC}/components/reports/customer-docs.tsx`,
  annexSection: `${SRC}/components/customers/plan-annex-section.tsx`,
  annexCard: `${SRC}/components/customers/plan-annex-round-card.tsx`,
}

console.log('— 판정 원천: 실패를 「해당없음」으로 접지 않는다 (3차 판정 R-1)')
has('StepEvidence가 axisIncomplete 축을 갖는다', P.status, /axisIncomplete\?: boolean/)
has('hasSheetDefect가 그 축을 먼저 본다', P.status, /if \(e\.axisIncomplete\) return true/)
has('evidenceDone ⑤가 그 축을 요구한다', P.status, /5: !e\.axisIncomplete/)
has('isForced5Void도 그 축을 본다', P.status, /axisIncomplete\) return true/)
has('gatherStepEvidence가 축을 실어 보낸다', P.sync, /axisIncomplete: xAxisIncomplete \|\| defectAxisIncomplete/)
// 🎯 판별식: 구 구현은 sheetX를 보수 판정 없이 그대로 실었고 불량 조회는 맨몸이었다
has('불량 조회도 ✕와 **같은 규약**으로 받는다(fetchAllRows)', P.sync,
  /fetchAllRows<\{ action_completed_at[\s\S]{0,200}inspection_defects/)
lacks('불량 조회를 `data ?? []`로 조용히 삼키지 않는다', P.sync, /defectsRes\.data \?\? \[\]/)

console.log('\n— Q-9(2026-09-09): 코드 없는 불량은 ✕ 하나를 덮은 것으로 본다')
has('집합 차에 개수 상쇄가 들어 있다', P.sync, /uncodedDefects/)
has('상쇄는 0에서 멈춘다', P.sync, /Math\.max\(0, unmatchedX - uncodedDefects\)/)

console.log('\n— 화면 쌍둥이: 여섯 표면이 **한 벌**을 쓴다 (Q-6 유예분 + 3차 판정이 찾은 5번째)')
has('공용 모듈이 존재한다', P.active, /export async function activeStepsByInspection/)
has('모르면 활성으로 본다(닫는 쪽으로 안 기운다)', P.active, /\?\? true/)
for (const [name, path] of [
  ['크론(마감 알림)', P.cron],
  ['사이드바 뱃지', P.layout],
  ['대시보드', P.dash],
  ['점검 달력(착륙 화면)', P.cal],
  ['계획 항목 패널', P.planActions],
  ['개인 일정 달력', P.mySched],
]) {
  has(`${name}이 공용 판정을 쓴다`, path, /from '@\/lib\/active-steps'/)
}
// 크론의 지역 사본이 되살아나면 다시 여섯 갈래가 된다
lacks('크론이 판정을 다시 지역 함수로 복제하지 않는다', P.cron,
  /async function activeStepsByInspection/)
has('고객 목록 스트립도 같은 판정 함수를 쓴다', P.custList, /hasSheetDefect\(\{/)
lacks('고객 목록이 `> 0` 사본으로 되돌아가지 않는다', P.custList,
  /const hasDefect = \(defCount\.get\(insp\) \?\? 0\) > 0/)

console.log('\n— 조용한 폴백 금지: 실패의 **기울기**까지 본다 (2차 R-3 · 3차 R-2/R-3)')
has('목록이 보수 판정을 activeStepNums에 넘긴다', P.list, /repairAxisIncomplete \|\|/)
has('고객 상세도 같은 자리에 넘긴다', P.custDetail, /repairAxisIncomplete \|\|/)
// J9(3차)가 「이 수리에 가드가 0건」이라 지적한 자리 — 지우면 여기서 붉어진다
has('고객 상세의 inspection_steps가 포장돼 있다', P.custDetail,
  /fetchAllRows<\{ inspection_id: string; step_num: number; status: string \}>/)
has('현황판은 판정을 보류한다(개수를 조작하지 않는다)', P.docs, /allPassUnknown/)
has('별지 트리 원천도 실패를 싣는다', P.docs, /const allPassUnknown = !!\(defRes\.error \|\| xRes\.error\)/)
for (const [name, path] of [
  ['문서 현황(10·11호 행)', P.custDocs],
  ['별지 트리 미리보기', P.annexSection],
  ['회차 카드 ⑩⑪ 칩', P.annexCard],
]) {
  has(`${name}이 allPassUnknown을 읽는다`, path, /allPassUnknown/)
}
// customer-docs만 hasSheetDefect를 안 부르는 인라인 사본이었다(3차 판정 J12)
lacks('문서 현황이 인라인 사본으로 되돌아가지 않는다', P.custDocs,
  /i\.defects\.total === 0 && i\.sheetX === 0/)

console.log('\n— `.in()`은 URL 길이를 풀지 않는다 (§S12 실측: 200 통과 / 400 실패)')
has('쪼개는 헬퍼가 있다', P.paginate, /export async function fetchAllRowsByIds/)
has('안전선이 상수로 고정돼 있다', P.paginate, /IN_CHUNK_SIZE = 150/)
has('한 조각만 실패해도 전체를 불완전으로 본다', P.paginate, /truncated: parts\.some/)
for (const [name, path] of [
  ['공용 판정 모듈', P.active],
  ['점검 목록', P.list],
  ['대시보드', P.dash],
  ['점검 달력', P.cal],
  ['개인 일정 달력', P.mySched],
  ['고객 목록 스트립', P.custList],
]) {
  has(`${name}이 id 목록을 쪼개 보낸다`, path, /fetchAllRowsByIds/)
}

console.log('\n— 크론: 상류를 풀면 하류도 함께 (3차 판정 R-5) · 실패를 성공으로 보고하지 않는다')
has('기발송(멱등) 조회가 포장돼 있다', P.cron, /기발송 조회 불완전/)
has('불완전하면 그 규칙을 건너뛴다(중복 발송 금지)', P.cron, /중복 발송을 막기 위해 이 규칙을 건너뜁니다/)
has('insert 실패를 500으로 올린다', P.cron, /if \(insErr\)/)
lacks('insert 결과를 버리지 않는다', P.cron, /await admin\.from\('notifications'\)\.insert\(batch as Record<string, unknown>\[\]\)\s*\n\s*totalSent/)
has('대상 0건인 날도 키를 남긴다', P.cron, /results\[rule\.dueDate\] \?\?= 0/)
has('별지 9호 대상 조회가 서버측에서 걸러진다', P.cronDefect, /plan_type\.like\.special_\*/)
has('그 조회도 끝까지 받는다', P.cronDefect, /fetchAllRows/)

console.log('\n— 「전체」 보기 절단 (§S12 Q-10 사용자 확정)')
has('전체 보기는 끝까지 받는다', P.list, /pageSize > 0\s*\n\s*\? query/)
has('못 받았으면 화면이 말한다', P.list, /전체가 아닙니다/)

console.log(`\n결과: ${pass}/${pass + fail} 통과`)
process.exit(fail ? 1 : 0)
