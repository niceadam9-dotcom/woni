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

/** ⭐⭐4차 독립 판정이 이 프로브를 **반증했다** — 제품을 되돌린 37개 변이 중 **24개에서 초록**이었다.
 *  원인은 전부 하나였다: **문자열이 어딘가에 있는지만 봤다.**
 *   · `/if \(e\.axisIncomplete\) return true/`는 형제 함수의 같은 줄에도 매치해, 정작 DB에
 *     `completed`를 쓰게 하던 가드를 지워도 초록이었다.
 *   · 「셋 중 둘」을 잡으려고 만든 단언이 파일당 `fetchAllRowsByIds` **1회 등장**만 봐서,
 *     세 조회 중 둘만 되돌린 변이를 세 파일 모두에서 놓쳤다.
 *   · `pageSize > 0 ? query` 같은 **삼항의 머리**만 봐서 「전체」 가지를 통째로 원복해도 초록이었다.
 *  → 아래 헬퍼로 바꾼다. **개수를 세고, 위치를 고정하고, 함수 본문 안에서만 찾는다.** */

/** 패턴이 **정확히 n회** 나오는가 — 「셋 중 둘」은 개수로만 잡힌다 */
function count(name, path, re, n, detail = '') {
  const src = read(path)
  if (src === null) { fail++; console.log(`  ❌ ${name} — 파일 없음: ${path}`); return }
  const m = src.match(re) ?? []
  ok(name, m.length === n, detail || `기대 ${n}회 · 실제 ${m.length}회`)
}
/** 패턴이 **n회 이상** */
function atLeast(name, path, re, n, detail = '') {
  const src = read(path)
  if (src === null) { fail++; console.log(`  ❌ ${name} — 파일 없음: ${path}`); return }
  const m = src.match(re) ?? []
  ok(name, m.length >= n, detail || `기대 ≥${n}회 · 실제 ${m.length}회`)
}
/** `export function <이름>` 부터 다음 `\nexport ` 까지를 잘라 **그 함수 본문 안에서만** 본다 —
 *  형제 함수의 동일한 줄에 매치해 공허 통과하던 것을 막는다 */
function inFn(name, path, fnName, re, detail = '') {
  const src = read(path)
  if (src === null) { fail++; console.log(`  ❌ ${name} — 파일 없음: ${path}`); return }
  const start = src.search(new RegExp(`export function ${fnName}\\b`))
  if (start < 0) { fail++; console.log(`  ❌ ${name} — 함수 없음: ${fnName}`); return }
  const rest = src.slice(start + 1)
  const end = rest.search(/\nexport /)
  const body = end < 0 ? rest : rest.slice(0, end)
  ok(name, re.test(body), detail)
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
  workbench: `${SRC}/components/inspections/inspection-workbench.tsx`,
  timeline: `${SRC}/components/inspections/inspection-timeline-client.tsx`,
  // ⚠ 모바일은 별도 Expo 패키지라 규칙을 **사본**으로 갖는다 — 갈라짐을 여기서 대조한다
  mobileRule: '../mobile/lib/inspection-steps.ts',
  mobileScreen: '../mobile/app/(app)/inspections/[id].tsx',
  board: `${SRC}/components/reports/submission-board.tsx`,
}

console.log('— 판정 원천: 실패를 「해당없음」으로 접지 않는다 (3차 R-1 · 4차 재작성)')
// ⚠ 이 넷은 4차 판정에서 **서로의 문자열로 공허 통과**했다(어느 하나만 지워도 초록).
//    이제 함수 본문을 잘라 각각을 따로 본다 + 축이 **선택이 아니라 필수 키**임을 고정한다.
has('StepEvidence의 axisIncomplete가 **필수 키**다 — 선택이면 새 리터럴이 빠뜨릴 수 있다',
  P.status, /axisIncomplete: boolean \| undefined/)
count('그 축이 타입에 두 곳(증거·판정 인자) 모두 필수로 선언돼 있다',
  P.status, /axisIncomplete: boolean \| undefined/g, 2)
inFn('hasSheetDefect가 그 축을 **먼저** 본다', P.status, 'hasSheetDefect', /if \(e\.axisIncomplete\) return true/)
inFn('evidenceDone ⑤가 그 축을 요구한다', P.status, 'evidenceDone', /5: !e\.axisIncomplete/)
inFn('isForced5Void도 그 축을 본다', P.status, 'isForced5Void', /if \(e\.axisIncomplete\) return true/)
has('작업대(정본 화면)가 그 축을 넘긴다 — 손에 쥐고 버리던 자리',
  P.workbench, /hasSheetDefect\(\{[\s\S]{0,160}axisIncomplete: data\.evidence\?\.axisIncomplete/)
has('타임라인 사본도 같은 축을 넘긴다', P.timeline, /axisIncomplete: data\.evidence\?\.axisIncomplete/)
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
// ⚠ 자체 변이 실험이 잡은 구멍: 「호출한다」만 보면 결과를 **버려도** 초록이다(뱃지가 영구 빨강으로
//    되돌아가는데). 차감이 실제로 두 수치에 반영되는지 본다.
count('사이드바가 두 뱃지에서 **실제로 차감**한다', P.layout,
  /Math\.max\(0, \((?:red|orange)Res\.count \?\? 0\) - naCount\(/g, 2)
for (const [name, path] of [
  ['크론(마감 알림)', P.cron],
  ['사이드바 뱃지', P.layout],
  ['대시보드', P.dash],
  ['점검 달력(착륙 화면)', P.cal],
  ['계획 항목 패널', P.planActions],
  ['개인 일정 달력', P.mySched],
]) {
  has(`${name}이 공용 판정을 쓴다`, path, /from '@\/lib\/active-steps'/)
  // ⚠ import만 남기고 **호출을 지워도** 초록이던 구멍(4차 판정 B4·W5) — 실제 사용을 함께 본다
  has(`${name}이 그 판정을 실제로 **호출**한다`, path, /activeStepsByInspection\(/)
}
// 🎯 4차 판정 R-8: **6번째 표면 — 모바일**. 6행을 그대로 그리고 ⑤⑥에 [완료] 버튼을 띄우며
// 그 버튼이 `inspections.status='completed'`를 직접 썼다. 웹 축 밖이라 아무도 안 보고 있었다.
has('모바일이 유효 단계 규칙을 갖는다', P.mobileRule, /export function activeStepNums/)
has('모바일 사본이 웹과 **같은 규칙**이다 — ①~④/①~⑥ 분기',
  P.mobileRule, /needsRepairSteps \? \[1, 2, 3, 4, 5, 6\] : \[1, 2, 3, 4\]/)
has('모바일 사본도 「모르면 조치 필요」로 기운다', P.mobileRule, /if \(e\.axisIncomplete\) return true/)
has('모바일 화면이 그 규칙으로 단계를 거른다', P.mobileScreen, /const visibleSteps = steps\.filter/)
has('모바일 완료 판정도 **유효 단계만** 센다 — completed를 DB에 쓰는 자리',
  P.mobileScreen, /updatedSteps\.filter\(s => activeNums\.has\(s\.step_num\)\)\.every/)
lacks('모바일이 6행을 그대로 세지 않는다', P.mobileScreen, /\/\{steps\.length\}/)
// 크론의 지역 사본이 되살아나면 다시 여섯 갈래가 된다
lacks('크론이 판정을 다시 지역 함수로 복제하지 않는다', P.cron,
  /async function activeStepsByInspection/)
has('고객 목록 스트립도 같은 판정 함수를 쓴다', P.custList, /hasSheetDefect\(\{/)
lacks('고객 목록이 `> 0` 사본으로 되돌아가지 않는다', P.custList,
  /const hasDefect = \(defCount\.get\(insp\) \?\? 0\) > 0/)

console.log('\n— 조용한 폴백 금지: 실패의 **기울기**까지 본다 (2차 R-3 · 3차 R-2/R-3)')
// ⚠ 4차 판정 B2: 문자열은 그대로 두고 `repairAxisIncomplete`를 **상수 false**로 바꿔도 초록이었다.
//    이제 그 값이 실제 조회 결과에서 나오는지(오류·절단 4항)를 함께 본다.
has('목록이 보수 판정을 activeStepNums에 넘긴다', P.list, /repairAxisIncomplete \|\|/)
has('그 값이 실제 조회 결과에서 나온다', P.list,
  /repairAxisIncomplete = !!\([\s\S]{0,160}\.error[\s\S]{0,160}\.truncated/)
has('고객 상세도 같은 자리에 넘긴다', P.custDetail, /repairAxisIncomplete \|\|/)
has('고객 상세의 그 값도 조회 결과에서 나온다', P.custDetail,
  /repairAxisIncomplete = !!\([\s\S]{0,160}\.error[\s\S]{0,160}\.truncated/)
// ⚠ B11: `allPassUnknown`을 `&& false`로 죽여도 초록이었다 — 실제 판정에 쓰이는지 본다
has('현황판이 그 보류를 판정에 실제로 쓴다', P.board, /!r\.allPassUnknown &&/)
// ⚠ R-7(4차): 새로 깐 6표면 중 다섯이 error/truncated를 한 번도 안 읽었다
for (const [name, path] of [
  ['대시보드', P.dash], ['점검 달력', P.cal], ['개인 일정', P.mySched],
  ['고객 목록 스트립', P.custList], ['사이드바 뱃지', P.layout],
]) {
  has(`${name}이 조회 불완전을 표면화한다`, path, /console\.error\(/)
}
// J9(3차)가 「이 수리에 가드가 0건」이라 지적한 자리 — 지우면 여기서 붉어진다
has('고객 상세의 inspection_steps가 포장돼 있다', P.custDetail,
  /fetchAllRows<\{ inspection_id: string; step_num: number; status: string \}>/)
has('현황판은 판정을 보류한다(개수를 조작하지 않는다)', P.docs, /allPassUnknown/)
has('별지 트리 원천도 실패를 싣는다', P.docs, /const allPassUnknown = !!\(defRes\.error \|\| xRes\.error\)/)
// ⚠ 4차 판정 N-7: 이 셋은 `allPassUnknown` **문자열 존재**만 봐서, `sheetX` 인자를 빼도(=⑩⑪ 칩이
//    ✕만 있는 회차에서 사라져도) 어느 검사에도 안 잡혔다. 세 인자를 **모두** 넘기는지 본다.
for (const [name, path, totalRe] of [
  ['문서 현황(10·11호 행)', P.custDocs, /defectsTotal: i\.defects\.total/],
  ['별지 트리 미리보기', P.annexSection, /defectsTotal: r\.docs\?\.defects\.total/],
  ['회차 카드 ⑩⑪ 칩', P.annexCard, /defectsTotal: r\.docs\.defects\.total/],
]) {
  has(`${name}이 세 축을 모두 넘긴다(불량·✕·불완전)`, path,
    new RegExp(`hasSheetDefect\\(\\{[\\s\\S]{0,200}${totalRe.source}[\\s\\S]{0,200}sheetX:[\\s\\S]{0,200}allPassUnknown`))
}
// customer-docs만 hasSheetDefect를 안 부르는 인라인 사본이었다(3차 판정 J12)
lacks('문서 현황이 인라인 사본으로 되돌아가지 않는다', P.custDocs,
  /i\.defects\.total === 0 && i\.sheetX === 0/)

console.log('\n— `.in()`은 URL 길이를 풀지 않는다 (§S12 실측: 200 통과 / 400 실패)')
has('쪼개는 헬퍼가 있다', P.paginate, /export async function fetchAllRowsByIds/)
has('안전선이 상수로 고정돼 있다', P.paginate, /IN_CHUNK_SIZE = 150/)
has('한 조각만 실패해도 전체를 불완전으로 본다', P.paginate, /truncated: parts\.some/)
// ⚠ 4차 판정: 「파일에 한 번이라도 나오는가」로는 **「셋 중 둘」을 못 잡는다**(이 프로브의 존재 이유가
//   바로 그 형태인데). 파일마다 **몇 개가 쪼개져야 하는지**를 세고, 맨몸 `.in(…)`이 남아 있지 않은지도 본다.
for (const [name, path, n] of [
  ['공용 판정 모듈', P.active, 3],
  ['점검 목록', P.list, 3],
  ['대시보드', P.dash, 3],
  ['점검 달력', P.cal, 2],
  ['개인 일정 달력', P.mySched, 2],
  ['고객 목록 스트립', P.custList, 3],
  ['마감 알림 크론(멱등 조회)', P.cron, 1],
  ['이행기한 크론(멱등 2곳)', P.cronDefect, 2],
]) {
  count(`${name}이 id 목록 ${n}건을 **전부** 쪼개 보낸다`, path, /fetchAllRowsByIds</g, n)
}
// 청크 크기를 상수로 두고도 호출부가 덮어쓰면 벽을 넘는다(4차 판정 B8이 실증)
lacks('청크 크기를 호출부가 덮어쓰지 않는다', P.active, /chunkSize:/)
lacks('안전선이 URL 벽(실측 400건) 아래다', P.paginate, /IN_CHUNK_SIZE = (\d{3,})/.source
  ? new RegExp(`IN_CHUNK_SIZE = (?:[3-9]\\d\\d|\\d{4,})`) : /$^/)

console.log('\n— 크론: 상류를 풀면 하류도 함께 (3차 판정 R-5) · 실패를 성공으로 보고하지 않는다')
has('기발송(멱등) 조회가 포장돼 있다', P.cron, /기발송 조회 불완전/)
has('불완전하면 그 규칙을 건너뛴다(중복 발송 금지)', P.cron, /중복 발송을 막기 위해 이 규칙을 건너뜁니다/)
has('insert 실패를 500으로 올린다', P.cron, /if \(insErr\)/)
lacks('insert 결과를 버리지 않는다', P.cron, /await admin\.from\('notifications'\)\.insert\(batch as Record<string, unknown>\[\]\)\s*\n\s*totalSent/)
has('대상 0건인 날도 키를 남긴다', P.cron, /results\[rule\.dueDate\] \?\?= 0/)
has('별지 9호 대상 조회가 서버측에서 걸러진다', P.cronDefect, /plan_type\.like\.special_\*/)
// ⚠ 4차 판정 N-7: 종전 `/fetchAllRows/`는 **import 줄에도 매치**해 준-공허했다(포장을 되돌려도 초록).
//   호출 형태를 본다 — 이 라우트는 주 규칙·별지9호 대상 **둘 다** 끝까지 받아야 한다.
count('그 라우트의 전건 조회 2곳이 모두 포장돼 있다', P.cronDefect, /fetchAllRows<Record<string, unknown>>\(/g, 2)
has('주 규칙(이행기한) 조회도 불완전을 표면화한다', P.cronDefect, /이행기한 대상 조회 불완전/)
has('그 라우트도 중복 발송을 막는다', P.cronDefect, /중복 발송을 막기 위해/)

console.log('\n— 「전체」 보기 절단 (§S12 Q-10 사용자 확정)')
// ⚠ 4차 판정: 종전 단언은 삼항의 **머리**(`pageSize > 0 ? query`)만 봐서, 「전체」 가지를
//   `range(0,99999)` 단발로 통째로 원복해도 초록이었다(C5 실증). 이제 **else 가지의 실체**를 본다.
has('「전체」 가지가 fetchAllRows로 끝까지 받는다',
  P.list, /: fetchAllRows<Record<string, unknown>>\(\(f, t\) => query/)
has('그 가지가 동점 없는 보조 정렬키를 붙인다 — 없으면 페이지가 겹치거나 건너뛴다',
  P.list, /\.order\('created_at', \{ ascending: false \}\)\.order\('id'\)/)
has('절단·오류를 화면 신호로 올린다', P.list, /truncated: !!r\.error \|\| r\.truncated/)
has('그 신호가 실제로 렌더된다', P.list, /\{listTruncated && \(/)
has('못 받았으면 화면이 말한다', P.list, /전체가 아닙니다/)
lacks('「전체」가 range 단발로 되돌아가지 않았다', P.list, /const to = pageSize > 0 \? from \+ pageSize - 1 : 99999/)

console.log(`\n결과: ${pass}/${pass + fail} 통과`)
process.exit(fail ? 1 : 0)
