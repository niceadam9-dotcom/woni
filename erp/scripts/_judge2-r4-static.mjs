/** 독립 재판정 보조 — D2·D3·D4·D6 배선의 **도달 가능성** 정적 확인
 *  실행: node scripts/_judge2-r4-static.mjs
 *  (구현자 _probe-r4-defects.mjs와 달리 "파일에 문자열이 있는가"가 아니라
 *   "실제로 렌더되는 컴포넌트인가 / 게이트가 무엇인가"를 본다) */
import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${d ? ` — ${d}` : ''}`) } }
const R = p => readFileSync(p, 'utf8')
const grep = pat => {
  try { return execSync(`git grep -l "${pat}" -- src`, { cwd: process.cwd(), encoding: 'utf8' }).trim().split('\n').filter(Boolean) }
  catch { return [] }
}

const PAGE = 'src/app/(dashboard)/inspections/[id]/page.tsx'
const WB = 'src/components/inspections/inspection-workbench.tsx'
const TL = 'src/components/inspections/inspection-timeline-client.tsx'
const page = R(PAGE), wb = R(WB), tl = R(TL)

console.log('— 렌더되는 컴포넌트가 무엇인가 (D2·D3의 도달 가능성 전제)')
ok('상세 페이지가 렌더하는 것은 InspectionWorkbench다', /<InspectionWorkbench/.test(page))
ok('상세 페이지는 InspectionTimelineClient를 렌더하지 않는다', !/<InspectionTimelineClient/.test(page))
const tlImporters = grep('inspection-timeline-client').filter(f => !f.endsWith('inspection-timeline-client.tsx'))
const tlValueImport = tlImporters.filter(f => !/import type \{[^}]*\} from '@\/components\/inspections\/inspection-timeline-client'|import \{ type TimelineData \} from '@\/components\/inspections\/inspection-timeline-client'/.test(R(f)))
ok(`InspectionTimelineClient 컴포넌트(${tl.split('\n').length}줄)는 어디에서도 **렌더되지 않는다** — 남은 참조는 타입 전용 import뿐(D6와 같은 죽은 UI)`,
  tlValueImport.length === 0 && grep('<InspectionTimelineClient').length === 0,
  JSON.stringify(tlValueImport))

console.log('\n— D2 오프라인 보고: 살아 있는 호출자')
ok('작업대에 recordOwnerReportOfflineAction 호출이 있다', /recordOwnerReportOfflineAction\(/.test(wb))
ok('작업대 ③ 칸(sel === \'ownerReport\')에서 폼이 렌더된다', /sel === 'ownerReport'/.test(wb) && /방문·유선 보고 기록/.test(wb))
ok('타임라인에도 같은 폼을 배선했으나 렌더되지 않으므로 **살아 있는 호출자는 1곳**(신고는 "0 → 2")',
  /recordOwnerReportOfflineAction\(/.test(tl) && grep('<InspectionTimelineClient').length === 0)

console.log('\n— D1 철회 버튼의 게이트')
const undoBlock = wb.slice(wb.indexOf('사유로 완료한 단계입니다'), wb.indexOf('사유로 완료한 단계입니다') + 400)
// ⚠ 2026-09-08 2차 판정으로 **뒤집은 단언**. 종전에는 「isSpecial 게이트 **안**에 있다」를 요구해
// 영구히 붉었고, 같은 리포의 _probe-r4-defects는 정반대(「막히지 **않는다**」)를 요구해 통과했다 —
// 두 프로브가 서로 반대를 요구하는 상태였다. 제품이 옳다: 달력 일괄·계획 패널은 plan_type을 가리지
// 않고 강제 마커를 찍으므로 월간·일반 건에도 사유 완료가 생기고, **찍히는데 되돌릴 수 없으면 안 된다**
// (inspection-workbench.tsx:1082-1085에 그 근거가 주석으로 박혀 있다). 그래서 은퇴가 아니라 뒤집는다 —
// 오래 붉은 단언은 진짜 회귀를 가리지만, 지우면 이 설계가 되돌아가도 아무도 모른다.
ok('작업대 철회 버튼은 isSpecial 게이트 **밖**에 있다 — 월간·일반 건에도 찍힌 사유 완료를 되돌릴 수 있다',
  /\{canComplete && stepOf\(sel\) && forcedNums\.has/.test(wb)
  && !/isSpecial && canComplete && stepOf\(sel\) && forcedNums\.has/.test(wb), undoBlock.slice(0, 120))
ok('강제 완료 버튼도 같은 isSpecial 게이트',
  /isSpecial && canComplete && !done\[sel\]/.test(wb))
// 달력·계획 패널은 점검 종류를 가리지 않고 completeStepCore(=강제 완료 마커)를 부른다
const act = R('src/app/(dashboard)/inspections/actions.ts')
const bulk = act.slice(act.indexOf('export async function bulkCompleteStepsAction'))
ok('달력 일괄(bulkCompleteStepsAction)은 plan_type을 가리지 않는다 — 월간 건에도 강제 마커가 찍히는데 철회 UI는 없다',
  bulk.length > 0 && !/plan_type/.test(bulk.slice(0, 2500)))

console.log('\n— D3 화면·서버 판정 함수 공유')
ok('page.tsx가 loadStepEvidence를 부른다', /loadStepEvidence\(admin, id\)/.test(page))
ok('두 분기(월간·자체점검) 모두 evidence를 싣는다',
  (page.match(/evidence: stepEvidence \?\? undefined/g) ?? []).length === 2,
  String((page.match(/evidence: stepEvidence \?\? undefined/g) ?? []).length))
// evidenceDone은 S3-6 선반영 때문에 스프레드로 부른다 / 2번째 인자는 소방계획서_45의 needsRepairSteps
ok('작업대가 evidenceDone/activeStepNums/stepProgress를 쓴다',
  /evidenceDone\(\{?\s*(\.\.\.)?data\.evidence/.test(wb) && /activeStepNums\(isSpecial, needsRepairSteps\)/.test(wb) && /stepProgress\(/.test(wb))
ok('작업대의 리터럴 판정은 evidence가 없을 때의 폴백 한 곳뿐',
  (wb.match(/data\.responded > 0/g) ?? []).length === 1)

console.log('\n— D4 배선')
ok('copyPreviousRoundResponsesAction에 sync가 있다',
  /R4-6\(독립 검증 D4\)[\s\S]{0,300}syncInspectionSteps/.test(R('src/app/(dashboard)/inspections/sheet-actions.ts')))
// archive-cleanup(과거본 정리)은 폐기됨(2026-08-18) — 대신 종이 보관을 **사람이 기록**하는
// 경로가 그 자리를 대신하므로, 그쪽에 sync가 걸려 있는지를 본다
// ⚠ 2026-09-08 2차 판정: 이 붉음의 원인은 배선 소실이 아니라 **정규식이 낡은 것**이었다 —
// recordCertPaperAction은 래퍼 syncStepsAndRevalidate를 거쳐 sync를 부른다(timeline-actions.ts:132).
// 45 문서가 이 붉음을 「② 배치신고 전환이 sync 호출을 지웠다」로 적었던 것도 함께 철회했다.
ok('종이 보관 기록에 sync가 있다',
  /recordCertPaperAction[\s\S]{0,1200}(syncInspectionSteps|syncStepsAndRevalidate)\(/.test(R('src/app/(dashboard)/inspections/timeline-actions.ts')))
ok('archive-cleanup은 제거됨', !existsSync('src/lib/archive-cleanup.ts'))

console.log('\n— D6')
ok('inspection-detail-client.tsx 삭제됨', !existsSync('src/components/inspections/inspection-detail-client.tsx'))
ok('src에 남은 참조는 주석뿐', grep('InspectionDetailClient').every(f => f.endsWith('page.tsx') || f.endsWith('inspection-delete-client.tsx')))

console.log('\n— 단일 기록자 유지 여부')
const writers = grep("from('inspection_steps')").filter(f => !f.includes('page.tsx'))
console.log(`  inspection_steps 접근 파일: ${JSON.stringify(writers)}`)
const statusWriters = writers.filter(f => /from\('inspection_steps'\)[\s\S]{0,200}\.update\(\{[^}]*status:/.test(R(f)))
ok('inspection_steps.status를 UPDATE하는 파일은 inspection-step-sync.ts 하나',
  statusWriters.length === 1 && statusWriters[0].endsWith('inspection-step-sync.ts'), JSON.stringify(statusWriters))

console.log(`\n결과: ${pass}/${pass + fail} 통과`)
process.exit(fail ? 1 : 0)
