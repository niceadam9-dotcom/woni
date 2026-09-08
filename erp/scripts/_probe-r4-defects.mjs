// R4 독립 검증 지적사항(D1~D6) 해소 정적 확인 — 실행: node scripts/_probe-r4-defects.mjs
// 실주행 단언은 test-inspection-steps-sync.mts(54/54)가 담당하고, 여기서는 '배선이 존재하는가'를 본다.
import { readFileSync, existsSync } from 'fs'

const read = p => readFileSync(p, 'utf8')
const status = read('src/lib/inspection-step-status.ts')
const sync = read('src/lib/inspection-step-sync.ts')
const tlActions = read('src/app/(dashboard)/inspections/timeline-actions.ts')
const tl = read('src/components/inspections/inspection-timeline-client.tsx')
const wb = existsSync('src/components/inspections/inspection-workbench.tsx')
  ? read('src/components/inspections/inspection-workbench.tsx') : ''
const page = read('src/app/(dashboard)/inspections/[id]/page.tsx')
const sheet = read('src/app/(dashboard)/inspections/sheet-actions.ts')
const test = read('scripts/test-inspection-steps-sync.mts')

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\n— D1 강제 완료가 영구 고정되던 결함')
ok('철회 마커 상수가 있다', /STEP_FORCE_UNDO_ACTION = 'step_force_undo'/.test(status))
ok('단계별 최신 마커로 유효분을 가리는 순수 함수가 있다', /export function resolveForcedSteps/.test(status))
ok('sync가 그 함수를 쓴다(직접 filter 재구현 아님)', /resolveForcedSteps\(/.test(sync))
ok('sync가 철회 마커까지 조회한다', /STEP_FORCE_UNDO_ACTION/.test(sync) && /created_at/.test(sync))
ok('철회 서버 액션이 있고 사유를 강제한다',
  /export async function undoForceCompleteStepAction/.test(tlActions)
  && /undoForceCompleteStepAction[\s\S]{0,800}철회 사유를 5자 이상/.test(tlActions))
ok('⑤ 사유 완료는 미조치 불량이 남으면 무효(신규·조치해제·삭제를 한 규칙으로)',
  /export function isForced5Void/.test(status)
  && /return e\.defectsDone < e\.defectsTotal/.test(status)
  && /if \(n === 5 && isForced5Void\(e\)\) continue/.test(status))
ok('동률 시각이면 철회가 이긴다', /m\.at === cur\.at && m\.action === STEP_FORCE_UNDO_ACTION/.test(status))
ok('작업대에 철회 버튼이 있다', !wb || /사유 완료 철회/.test(wb))
ok('철회 버튼이 isSpecial로 막히지 않는다(월간 건도 마커가 찍힌다)',
  !wb || /canComplete && stepOf\(sel\) && forcedNums\.has/.test(wb))

console.log('\n— D2 오프라인 보고를 남길 UI가 없던 결함')
// ⚠ 렌더되는 화면은 작업대다 — 타임라인(미렌더)의 배선은 도달 가능성이 없어 근거로 세지 않는다
ok('작업대가 오프라인 기록 액션을 부른다', !!wb && /recordOwnerReportOfflineAction\(/.test(wb))
ok('작업대 ③ 상태 문구가 오프라인 기록을 반영한다', !!wb && /오프라인 기록됨/.test(wb))
ok('작업대에 [방문·유선 보고 기록] 입력이 있다', !!wb && /방문·유선 보고 기록/.test(wb))

console.log('\n— D3 화면이 판정 함수를 쓰지 않던 결함')
ok('sync가 증거 묶음을 화면에 내주는 함수를 export 한다', /export async function loadStepEvidence/.test(sync))
ok('page가 그 증거를 싣는다', /loadStepEvidence\(admin, id\)/.test(page)
  && (page.match(/evidence: stepEvidence/g) ?? []).length >= 2)
// 인자를 스프레드로 넘긴다(`evidenceDone({ ...data.evidence, submit9At, … })`) — S3-6 선반영 때문이다.
// 종전 정규식은 괄호 직후 `data.evidence`만 봐서 그 리팩터 뒤로 **항상 실패**하고 있었다(2026-09-07 실측).
ok('작업대가 evidenceDone으로 ✓를 계산한다', !!wb && /evidenceDone\(\{?\s*(\.\.\.)?data\.evidence/.test(wb))
// 소방계획서_45 — 2번째 인자는 ✕ ∪ 불량내역을 합성한 needsRepairSteps다(hasSheetDefect가 원본).
ok('작업대가 stepProgress·activeStepNums로 진행률을 낸다',
  !!wb && /stepProgress\(doneByNum, activeNums\)/.test(wb) && /activeStepNums\(isSpecial, needsRepairSteps\)/.test(wb))
ok('작업대의 ⑤⑥ 활성 축이 점검표 ✕까지 본다 (소방계획서_45)',
  !!wb && /hasSheetDefect\(\{ defectsTotal: defectStat\.total, sheetX \}\)/.test(wb)
  && /const na = !needsRepairSteps &&/.test(wb))
ok('타임라인(미렌더)도 같은 함수를 쓴다 — 되살릴 때 규칙이 갈라지지 않게',
  /const stepDone = evidenceDone\(/.test(tl)
  && !/const done1 = data\.responded > 0/.test(tl) && !/const done3 = !!data\.delivery/.test(tl))
ok('타임라인이 미렌더임을 파일 머리에 명시했다', /현재 렌더되지 않는다/.test(tl))

console.log('\n— D4 동기화 배선 누락')
ok('지난 회차 복사가 sync를 부른다',
  /copyPreviousRoundResponsesAction[\s\S]{0,6000}?syncInspectionSteps\(admin, inspectionId/.test(sheet))
// 과거본 정리(archive-cleanup)는 폐기(2026-08-18) — 종이 보관은 이제 사람이 기록한다
// ⚠ 2026-09-08 2차 판정: 이 단언이 오래 붉었고 45 문서는 그것을 「② 전환이 sync 호출을 지웠다」로
// 기록했으나 **거짓**이었다 — 배선은 살아 있고(timeline-actions.ts:132) 다만 래퍼
// syncStepsAndRevalidate를 거친다. 정규식이 직접 호출만 찾아 낡았던 것이다.
// 래퍼도 인정하되 **호출 자체가 사라지면 여전히 물린다**(둘 다 없으면 거짓).
ok('종이 보관 기록이 sync를 부른다',
  /recordCertPaperAction[\s\S]{0,1200}(syncInspectionSteps|syncStepsAndRevalidate)\(/.test(tlActions))

console.log('\n— D5 테스트가 스테이징을 오염시키던 결함')
ok('정리에 purge_activity_logs를 쓴다', /rpc\('purge_activity_logs'/.test(test))
ok('삭제되지 않은 마커를 경고한다', /마커 잔존/.test(test))
ok('테스트가 syncInspectionSteps를 실제로 호출한다',
  /import syncMod from '\.\.\/src\/lib\/inspection-step-sync\.ts'/.test(test)
  && (test.match(/await syncInspectionSteps\(admin, inspId/g) ?? []).length >= 8
  && !test.includes('server-only라 여기서 직접 부를 수 없다'))
ok('스테이징이 아니면 중단한다', /nwflnzugwylhpdyodyog/.test(test))

console.log('\n— D6 죽은 코드')
ok('inspection-detail-client.tsx가 제거됐다',
  !existsSync('src/components/inspections/inspection-detail-client.tsx'))

// ── D7: 소방계획서_45 독립 판정(4인)이 잡은 결함들의 회귀 가드 ──────────────
// 전부 "축은 넓혔는데 **주변 규칙이 따라오지 않은**" 한 형태다. 넓힌 자리마다 짝을 세운다.
console.log('\n— D7 축 확장의 짝(소방계획서_45 독립 판정)')
const inspList = read('src/app/(dashboard)/inspections/page.tsx')
const docsActions = read('src/app/(dashboard)/reports/docs-actions.ts')
const cron = read('src/app/api/cron/inspection-deadline-notify/route.ts')
const custPage = read('src/app/(dashboard)/customers/[id]/page.tsx')
const annexSection = read('src/components/customers/plan-annex-section.tsx')
const roundCard = read('src/components/customers/plan-annex-round-card.tsx')
const terms = read('src/lib/doc-requirements.ts')

// R-3: ⑤가 새로 활성이 된 구간(미등록 ✕)에서 [사유 완료]가 굳던 구멍
// ⚠ R-5(2026-09-08 2차 판정)로 축이 **개수 근사 → 집합 차**로 바뀌었다. 종전 정규식은
// `defectsTotal === 0 && sheetX > 0`이라는 **옛 구현식을 그대로 박아** 두고 있었다.
ok('isForced5Void가 미등록 ✕도 미조치로 본다',
  /if \(\(e\.unregisteredX \?\? 0\) > 0\) return true/.test(status))
ok('그 축이 sheetX(✕ 전체)가 아니라 미등록분이다 — sheetX만 보면 등록 후 영구 무효가 된다',
  !/return \(e\.sheetX \?\? 0\) > 0 \|\| e\.defectsDone < e\.defectsTotal/.test(status)
  && !/e\.defectsTotal === 0 && \(e\.sheetX \?\? 0\) > 0/.test(status))
// R-5: ⑤ **완료** 판정도 함께 좁혔다 — 등록분을 다 조치해도 미등록 ✕가 남으면 완료가 아니다
ok('evidenceDone ⑤가 미등록 ✕를 함께 본다',
  /5: e\.defectsTotal > 0 && e\.defectsDone >= e\.defectsTotal && \(e\.unregisteredX \?\? 0\) === 0/.test(status))
// 서버가 그 집합 차를 실제로 계산하는가 — 타입에만 있고 늘 0인 침묵 경로가 아님을 본다
ok('gatherStepEvidence가 ✕ 코드와 불량 코드의 집합 차를 낸다',
  /xCodes\.filter\(c => !registered\.has\(c\)\)\.length/.test(sync)
  && /select\('action_completed_at, defect_code'\)/.test(sync))
ok('작업대가 그 구간에서 ⑤ [사유 완료] 버튼을 내린다',
  !!wb && /const force5Blocked = \(k: StepKey\) => xUnregistered && STEP_NUM\[k\] === 5/.test(wb)
  && /!force5Blocked\(sel\)/.test(wb))
ok('그 구멍을 무는 단언이 스위트에 있다 — 45차수는 67개가 전부 통과시켰다',
  /미등록 ✕가 있으면 ⑤ 사유 완료는 무효/.test(test)
  && /등록 후 전건 조치했으면 ✕가 남아 있어도/.test(test))

// R-4: 1000행 상한 — 축을 넓히며 **셋 중 둘만** 감쌌던 결함
ok('목록의 세 조회가 모두 fetchAllRows다 (steps를 빠뜨렸었다)',
  (inspList.match(/fetchAllRows</g) ?? []).length >= 3
  && !/admin\.from\('inspection_steps'\)\.select\([^)]*\)\.in\('inspection_id', ids\)\s*,/.test(inspList))
ok('현황판의 불량·✕ 조회가 모두 fetchAllRows다 — 잘리면 거짓 「해당없음」이 된다',
  /fetchAllRows<\{ inspection_id: string \}>\(\(from, to\) => admin\.from\('inspection_defects'\)/.test(docsActions))
ok('조회 불완전이 조용한 폴백으로 묻히지 않는다',
  /진행단계 열이 부정확/.test(inspList) && /'해당없음' 판정이 부정확/.test(docsActions))

// R-5: 라벨을 잘라 문장에 쓰던 것 — 사유를 별도 상수로
ok('생략 사유가 별도 상수이고 라벨이 그것으로 조립된다',
  /export const NA_ALL_PASS_REASON = '점검표 모두 합격'/.test(terms)
  && /naAllPass: `해당없음 — \$\{NA_ALL_PASS_REASON\}`/.test(terms))
ok('④ 안내가 라벨을 replace로 수술하지 않는다 — 사유를 두 번 말하던 문장',
  !!wb && !/naAllPass\.replace/.test(wb) && /\{NA_ALL_PASS_REASON\} — 별지 10·11호/.test(wb))
ok('「해당없음 — 불량 0건」 하드코딩이 전멸했다(미렌더 파일 포함)',
  !/해당없음 — 불량 0건'/.test(tl) && /DOC_TERMS\.naAllPass/.test(tl))
ok('⑤ 배너 CTA가 권한을 본다 — 없으면 ①에 버튼이 없는 막다른 길',
  !!wb && /\{canManage && \(\s*<button onClick=\{\(\) => setSel\('checklist'\)\}/.test(wb))

// Q-4·제3표면: 같은 축을 쓰는 나머지 소비자들
ok('별지 트리 미리보기가 같은 축을 쓴다', /hasSheetDefect\(\{ defectsTotal: r\.docs\?\.defects\.total \?\? 0/.test(annexSection))
ok('회차 카드 ⑩⑪ 칩이 같은 축을 쓴다', /hasSheetDefect\(\{ defectsTotal: r\.docs\.defects\.total, sheetX: r\.docs\.sheetX \}\)/.test(roundCard))
ok('마감 알림 크론이 해당없음 단계를 발송 대상에서 뺀다',
  /activeStepNums\(isSelfInspection\(i\.plan_type\)/.test(cron)
  && /activeByInsp\.get\(s\.inspection_id\)\?\.has\(s\.step_num\)/.test(cron))
ok('크론은 조회가 불완전하면 **보수적으로** 전 단계를 활성으로 본다 — 알림을 지우는 쪽으로 기울지 않는다',
  /incomplete \|\| needsRepair\.has\(i\.id\)/.test(cron))
ok('고객 상세 진행바가 유효 단계만 센다 — 목록 4/4 · 상세 4/6으로 갈라져 있었다',
  /activeNumsByInsp\.get\(r\.inspection_id\)\?\.has\(r\.step_num\)/.test(custPage))

console.log(`\n결과: ${pass}/${pass + fail} 통과`)
process.exit(fail ? 1 : 0)
