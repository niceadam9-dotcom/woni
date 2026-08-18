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
ok('작업대가 evidenceDone으로 ✓를 계산한다', !!wb && /evidenceDone\(data\.evidence\)/.test(wb))
ok('작업대가 stepProgress·activeStepNums로 진행률을 낸다',
  !!wb && /stepProgress\(doneByNum, activeNums\)/.test(wb) && /activeStepNums\(isSpecial, hasDefects\)/.test(wb))
ok('타임라인(미렌더)도 같은 함수를 쓴다 — 되살릴 때 규칙이 갈라지지 않게',
  /const stepDone = evidenceDone\(/.test(tl)
  && !/const done1 = data\.responded > 0/.test(tl) && !/const done3 = !!data\.delivery/.test(tl))
ok('타임라인이 미렌더임을 파일 머리에 명시했다', /현재 렌더되지 않는다/.test(tl))

console.log('\n— D4 동기화 배선 누락')
ok('지난 회차 복사가 sync를 부른다',
  /copyPreviousRoundResponsesAction[\s\S]{0,6000}?syncInspectionSteps\(admin, inspectionId/.test(sheet))
// 과거본 정리(archive-cleanup)는 폐기(2026-08-18) — 종이 보관은 이제 사람이 기록한다
ok('종이 보관 기록이 sync를 부른다', /recordCertPaperAction[\s\S]{0,1200}syncInspectionSteps/.test(tlActions))

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

console.log(`\n결과: ${pass}/${pass + fail} 통과`)
process.exit(fail ? 1 : 0)
