/** 별지 9호 2쪽 «소방계획서·자체점검(전년도)·교육훈련» A~D 검증 — 순수 함수 단언(DB 불필요)
 *  실행: npx tsx --conditions=react-server scripts/_probe-report9-p2-marks.mts
 *
 *  A 3상태화 · B 사유 노출(조립 측이라 여기선 렌더 단언만) · C at 파싱 · D 연도 보관 자동 체크
 *  기준: 부정 칸(미실시·미보관·미작성)은 **③ 수동 확정일 때만** √. 자동 판정은 부정을 단정하지 않는다. */
import r9mod from '../src/lib/doc-templates/report9.ts'
import type { Report9Data } from '../src/lib/doc-templates/report9.ts'
import trmod from '../src/lib/training-records.ts'

const { renderReport9 } = r9mod as unknown as typeof import('../src/lib/doc-templates/report9.ts')
const { trainingRecordYear, trainingDoneIn } = trmod as unknown as typeof import('../src/lib/training-records.ts')

let pass = 0, fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const base = {
  ckOp: true, ckInitial: false, ckCompEtc: false,
  customerName: '프로브빌딩', purpose: '', address: '', inspPeriod: '', inspDays: '',
  companyName: '', companyPhone: '', consent: null, reportEmail: '',
  main: null, assistants: [], reportDate: '', submitTo: '',
  repRole: '', ownerName: '', ownerPhone: '', managerGrade: '',
  mgrName: '', mgrPhone: '', mgrEduDate: '',
  hasFirePlan: false, prevOpDone: false, prevCompDone: false, eduDone: false, drillDone: false,
  insuranceJoined: null, insCompany: '', insPeriod: '', insPerson: '', insProperty: '',
  multiUseNone: false, multiUseCounts: {}, permitDate: '', useApprovalDate: '',
  totalArea: '', buildingArea: '', households: '', floorsAbove: '', floorsBelow: '',
  heightM: '', buildingCount: '',
  stCon: false, stSteel: false, stBrick: false, stWood: false, stEtc: false,
  rfSlab: false, rfTile: false, rfSlate: false, rfEtc: false,
  elvR: '', elvE: '', elvV: '', pkIn: false, pkMech: false, pkRoof: false, pkOut: false,
  rampCount: '', stairsCount: '',
  facilityChecks: [], resultMarks: {}, muResults: {}, specs: {}, defectRows: [],
} as unknown as Report9Data

/** ck()의 미체크 칸은 `[&nbsp;&nbsp;]`로 나온다 — 단언 전에 `[ ]`로 정규화 */
const norm = (html: string) => html.replace(/\[&nbsp;&nbsp;\]/g, '[ ]')
/** 2쪽 표의 한 행만 뽑는다. 라벨 문자열은 <title>에도 들어 있어(예: '자체점검')
 *  머리글 셀(<th class="lbl">)로 못박지 않으면 문서 서두를 잘못 집는다. */
function row(html: string, label: string): string {
  return norm(html).split('<tr>').find(s => s.includes(`<th class="lbl">${label}`)) ?? ''
}
/** 해당 라벨이 체크(√)인지 — ck()는 체크 시 [√], 아니면 [ ] 를 라벨 바로 앞에 낸다 */
function checked(html: string, label: string): boolean {
  const s = norm(html)
  const i = s.indexOf(label)
  if (i < 0) return false
  const before = s.slice(Math.max(0, i - 40), i)
  const last = before.lastIndexOf('[')
  return last >= 0 && before.slice(last).includes('√')
}

console.log('— C: 실시일 자유 텍스트 연도 파싱 (종전 at.slice(0,4)가 조용히 놓치던 형태)')
ok("'2025-06-10' → 2025", trainingRecordYear({ at: '2025-06-10' }) === '2025')
ok("'2025.6.10' → 2025", trainingRecordYear({ at: '2025.6.10' }) === '2025')
ok("' 2025-06-10'(앞 공백) → 2025", trainingRecordYear({ at: ' 2025-06-10' }) === '2025', trainingRecordYear({ at: ' 2025-06-10' }))
ok("'25.6.10' → 2025", trainingRecordYear({ at: '25.6.10' }) === '2025', trainingRecordYear({ at: '25.6.10' }))
ok("'2025년 6월 10일' → 2025", trainingRecordYear({ at: '2025년 6월 10일' }) === '2025')
ok("'6월 10일'(연도 불명) → ''", trainingRecordYear({ at: '6월 10일' }) === '')
ok("빈 행 → ''", trainingRecordYear({}) === '')

console.log('— D: 연도가 보관돼 있으면 at 표기와 무관하게 자동 체크')
ok('year 명시(2025) + at 공란 → 전년도 실적 인정',
  trainingDoneIn([{ year: '2025', kind: '교육' }], 2025).edu === true)
ok('year가 at보다 우선 (at=2024, year=2025)',
  trainingDoneIn([{ year: '2025', at: '2024-01-01', kind: '훈련' }], 2025).drill === true)
ok('구 데이터(year 없음) at에서 파생 → 그대로 판정',
  trainingDoneIn([{ at: '2025-06-10', kind: '훈련' }], 2025).drill === true)
ok("'교육·훈련' 행은 양쪽 모두 인정", (() => {
  const r = trainingDoneIn([{ year: '2025', kind: '교육·훈련' }], 2025)
  return r.edu && r.drill
})())
ok('구분 분리 — 훈련만 있으면 교육은 ☐', (() => {
  const r = trainingDoneIn([{ year: '2025', kind: '훈련' }], 2025)
  return r.drill && !r.edu
})())
ok('당해년도(2026) 실적은 전년도(2025) 판정에 안 잡힌다',
  trainingDoneIn([{ year: '2026', kind: '교육' }], 2025).edu === false)
ok('전년도 행 수 집계', trainingDoneIn([{ year: '2025', kind: '교육' }, { year: '2025', kind: '훈련' }], 2025).count === 2)

console.log('— A: 부정 칸은 ③ 수동 확정일 때만 √ (자동 판정은 단정 안 함)')
{
  const html = renderReport9(base)
  ok('미공급(구 호출) → 미실시·미보관·미작성 전부 ☐ (하위 호환)',
    !checked(html, '미실시') && !checked(html, '미보관') && !checked(html, '미작성'))
  ok('미공급 → 실시 칸도 ☐ (자동 판정 false)', !checked(html, '실시'))
}
{
  const html = renderReport9({ ...base, eduNone: true, drillNone: true })
  const r = row(html, '교육훈련')
  ok('eduNone·drillNone → 교육훈련 미실시 √', (r.match(/\[√\]미실시/g) ?? []).length === 2, r.slice(0, 200))
  ok('그 행의 실시는 ☐', (r.match(/\[√\]실시/g) ?? []).length === 0)
}
{
  const html = renderReport9({ ...base, prevOpNone: true, prevCompNone: true })
  const r = row(html, '자체점검')
  ok('prevOpNone·prevCompNone → 자체점검 미실시 √ 2개', (r.match(/\[√\]미실시/g) ?? []).length === 2, r.slice(0, 200))
}
{
  const html = renderReport9({ ...base, hasFirePlan: false, firePlanNone: true, firePlanStored: false })
  const r = row(html, '소방계획서')
  ok('firePlanNone → 미작성 √ · 작성 ☐', /\[√\]미작성/.test(r) && !/\[√\]작성/.test(r), r.slice(0, 200))
  ok('미작성이면 보관 칸도 ☐ (자동 폴백이 살아나지 않는다)', !/\[√\]보관/.test(r))
}
{
  const html = renderReport9({ ...base, hasFirePlan: true, firePlanStored: false, firePlanUnstored: true })
  const r = row(html, '소방계획서')
  ok('작성 √ + 미보관 √ 조합이 표현된다', /\[√\]작성/.test(r) && /\[√\]미보관/.test(r), r.slice(0, 200))
  ok('그 경우 보관은 ☐', !/\[√\]보관 /.test(r) && !/\(\[√\]보관/.test(r))
}
{
  const html = renderReport9({ ...base, hasFirePlan: true })
  const r = row(html, '소방계획서')
  ok('종전 동작 보존 — hasFirePlan만 true면 작성·보관 √ (firePlanStored 미공급)',
    /\[√\]작성/.test(r) && /\[√\]보관/.test(r) && !/\[√\]미보관/.test(r), r.slice(0, 200))
}
{
  const html = renderReport9({ ...base, eduDone: true, eduNone: false, drillDone: false })
  const r = row(html, '교육훈련')
  ok('교육 실시 √ · 훈련은 실시·미실시 둘 다 ☐(미확정)',
    /소방안전교육 \(\[√\]실시/.test(r) && /소방훈련 \(\[ \]실시 \[ \]미실시/.test(r), r.slice(0, 200))
}

console.log(`\n결과: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
