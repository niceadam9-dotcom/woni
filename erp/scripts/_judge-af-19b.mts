/** [독립 판정] 소방계획서_19 B-8 후속 — A4-4 · E10-5 · E10-8 순수 렌더 실주행
 *  실행: npx tsx --conditions=react-server scripts/_judge-af-19b.mts
 *  판정자 작성(구현자≠판정자). DB 불필요 — 렌더 함수만 직접 주행한다.
 *  기준 원문: erp_goal/_form/별지9호-placeholder.hwpx (세부현황은 별지4호·9호 공용 원본) */
import r4mod from '../src/lib/doc-templates/report4.ts'
import type { Report4Data } from '../src/lib/doc-templates/report4.ts'
import r9mod from '../src/lib/doc-templates/report9.ts'
import type { Report9Data } from '../src/lib/doc-templates/report9.ts'
import r1011mod from '../src/lib/doc-templates/report1011.ts'
import type { Annex1011Data } from '../src/lib/doc-templates/report1011.ts'
import schemamod from '../src/lib/facility-spec-schema.ts'

const { renderReport4 } = r4mod as unknown as typeof import('../src/lib/doc-templates/report4.ts')
const { renderReport9 } = r9mod as unknown as typeof import('../src/lib/doc-templates/report9.ts')
const { renderReport10 } = r1011mod as unknown as typeof import('../src/lib/doc-templates/report1011.ts')
const { FACILITY_SPEC_SECTIONS } = schemamod as unknown as typeof import('../src/lib/facility-spec-schema.ts')

let pass = 0, fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ── A4-4 ─────────────────────────────────────────────────────────────────────
// 원문(별지9호-placeholder.hwpx §3-3·3-5·3-6)에서 설치장소 줄이 2줄인 블록은 **8개**:
//   옥내소화전 · 화재조기진압용SP · 물분무 · 미분무 · 자동화재탐지설비 · **화재알림설비** · 피난기구 · 인명구조기구
// (_judge-af-a44-form.mjs / _judge-af-a44-cont.mjs 로 이음줄 8개 전수 확인)
const TWO_LINE_BLOCKS: Array<{ sec: string; blk: string; label: string }> = [
  { sec: 's33_water_each', blk: 'indoor_hydrant', label: '옥내소화전' },
  { sec: 's33_water_each', blk: 'early_suppression', label: '화재조기진압용SP' },
  { sec: 's33_water_each', blk: 'water_spray', label: '물분무' },
  { sec: 's33_water_each', blk: 'water_mist', label: '미분무' },
  { sec: 's35_alarm', blk: 'fire_detection', label: '자동화재탐지설비' },
  { sec: 's35_alarm', blk: 'fire_alert', label: '화재알림설비' },
  { sec: 's36_evac', blk: 'evac_equipment', label: '피난기구' },
  { sec: 's36_evac', blk: 'rescue_equipment', label: '인명구조기구' },
]
// 원문이 1줄인 대표 블록(과다 방지) — 스프링클러·간이SP·포·유도등·비상조명등·휴대용
const ONE_LINE_BLOCKS: Array<{ sec: string; blk: string; label: string }> = [
  { sec: 's33_water_each', blk: 'sprinkler', label: '스프링클러설비' },
  { sec: 's33_water_each', blk: 'simple_sprinkler', label: '간이스프링클러설비' },
  { sec: 's33_water_each', blk: 'foam', label: '포소화설비' },
  { sec: 's36_evac', blk: 'guide_light', label: '유도등' },
  { sec: 's36_evac', blk: 'emergency_light', label: '비상조명등' },
  { sec: 's36_evac', blk: 'portable_light', label: '휴대용비상조명등' },
]

// 스키마 계층 — dong2 필드가 열려 있는 블록 집합
console.log('— A4-4 ① 스키마: 둘째 동(dong2) 필드 보유 블록')
const schemaSecond = new Set<string>()
for (const s of FACILITY_SPEC_SECTIONS) {
  for (const b of s.blocks) {
    if (b.fields.some(f => f.key === 'dong2')) schemaSecond.add(`${s.key}.${b.key}`)
  }
}
for (const t of TWO_LINE_BLOCKS) {
  ok(`스키마 dong2 — ${t.label}`, schemaSecond.has(`${t.sec}.${t.blk}`),
    '원문 2줄인데 둘째 동 필드 없음')
}
for (const t of ONE_LINE_BLOCKS) {
  ok(`스키마 dong2 없음(원문 1줄) — ${t.label}`, !schemaSecond.has(`${t.sec}.${t.blk}`), '과다 생성')
}
ok(`dong2 보유 블록 총수 = 8`, schemaSecond.size === 8, `실제 ${schemaSecond.size}개: ${[...schemaSecond].join(', ')}`)

// 렌더 — 둘째 동 값을 넣고 별지4호·9호 양쪽에 실제로 인쇄되는지
console.log('\n— A4-4 ② 렌더: 둘째 동 값 인쇄 (별지9호·별지4호 공용)')
const specs: Record<string, Record<string, unknown>> = {}
TWO_LINE_BLOCKS.forEach((t, i) => {
  specs[t.sec] = { ...(specs[t.sec] ?? {}), [t.blk]: { dong: `가동${i}`, dong2: `나동${i}` } }
})
const r9base = {
  ckOp: true, ckInitial: false, ckCompEtc: false,
  customerName: '판정빌딩', purpose: '', address: '', inspPeriod: '', inspDays: '',
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
const r4base: Report4Data = {
  ckOp: true, ckInitial: false, ckCompEtc: false,
  customerName: '판정빌딩', purpose: '', address: '',
  facilityChecks: [], resultMarks: {}, muResults: {},
  main: null, assistants: [], inspStart: '', inspEnd: '', inspDays: '',
  companyName: '', specs: {},
} as unknown as Report4Data

const h9 = renderReport9({ ...r9base, specs })
const h4 = renderReport4({ ...r4base, specs })
TWO_LINE_BLOCKS.forEach((t, i) => {
  ok(`별지9호 둘째 동 인쇄 — ${t.label}`, h9.includes(`나동${i}`), '둘째 동 값이 사라짐')
  ok(`별지4호 둘째 동 인쇄 — ${t.label}`, h4.includes(`나동${i}`), '둘째 동 값이 사라짐')
})

console.log('\n— A4-4 ③ 값 없을 때 회귀(빈 서식 유지)')
const empty9 = renderReport9(r9base)
ok('빈 값에도 undefined·null 문자열 없음', !/undefined|>null</.test(empty9))
// 둘째 줄은 원문처럼 ':'로 이어진 빈 줄이어야 한다 — 개수 = dong2 보유 블록 수
const contCount = (empty9.match(/&gt;|<br>: 동명\(/g) ?? []).filter(s => s !== '&gt;').length
ok(`빈 서식 둘째 줄 수 = dong2 블록 수(${schemaSecond.size})`, contCount === schemaSecond.size, `실제 ${contCount}`)

console.log('\n— A4-4 ④ 무선통신 접속단자 2칸')
const wl = { s38_activity: { wireless: { terminals: '단자가', terminals2: '단자나' } } }
const hw = renderReport9({ ...r9base, specs: wl })
ok('접속단자 1·2칸 모두 인쇄', hw.includes('단자가') && hw.includes('단자나'))

// ── E10-5 / E10-8 ────────────────────────────────────────────────────────────
console.log('\n— E10-5: ③ summary 요약 행이 계획 행과 구분되는가')
const d10base: Annex1011Data = {
  customerName: '판정빌딩', purpose: '업무시설', address: '경기 양평', ownerName: '홍대표',
  ownerPhone: '010-1111-2222', mgrName: '김선임', mgrPhone: '010-3333-4444',
  rows: [], reportDate: '2026년 8월 12일', submitTo: '양평소방서장',
}
const planRow = { content: '유도등 교체', period: '2026년 8월 1일 ~ 2026년 8월 20일' }
{
  const html = renderReport10({ ...d10base, rows: [{ content: '3분기 내 일괄 정비', period: '', isSummary: true }, planRow] })
  ok('요약 행에 [계획 요약] 태그', /row-tag">계획 요약<\/span> 3분기 내 일괄 정비/.test(html))
  ok('요약 행 배경 구분 클래스(row-summary)', /class="row-content row-summary"/.test(html))
  ok('요약 행 기간칸 = —', /row-period row-summary">—</.test(html))
  ok('요약 행에 날짜 자리표 미출력', !/row-summary">\.\s+\.\s+\./.test(html))
  ok('계획 행은 태그·배경 없음', /class="row-content">유도등 교체/.test(html))
  const placeholders = (html.match(/\.&nbsp;|\.  \.  \.  ~/g) ?? []).length
  ok('빈 패딩 행에는 종전 날짜 자리표 유지', placeholders >= 1, `자리표 ${placeholders}개`)
}
{
  const html = renderReport10({ ...d10base, rows: [planRow] })
  // CSS 정의(.row-summary/.row-tag)는 항상 있으므로 표 본문 클래스로만 판정
  ok('summary 없으면 요약 행 자체가 없음',
    !html.includes('계획 요약') && !/class="row-(content|period) row-summary"/.test(html))
}

console.log('\n— E10-8: ③ totalDays 단독 입력')
{
  const both = renderReport10({ ...d10base, rows: [planRow], totalPeriod: '2026년 8월 1일 ~ 2026년 8월 20일', totalDays: '20' })
  ok('기간+총일수 → "기간 (총 20일)"', /2026년 8월 20일 \(총 20일\)/.test(both))
  const onlyDays = renderReport10({ ...d10base, rows: [planRow], totalDays: '20' })
  ok('총일수만 → "총 20일"', />총 20일</.test(onlyDays))
  ok('총일수만 → 빈 괄호 "(총" 미출력', !onlyDays.includes('(총'))
  const onlyPeriod = renderReport10({ ...d10base, rows: [planRow], totalPeriod: '2026년 8월 1일 ~ 2026년 8월 20일' })
  ok('기간만 → 괄호 없음', onlyPeriod.includes('2026년 8월 20일') && !onlyPeriod.includes('(총'))
  const none = renderReport10({ ...d10base, rows: [planRow] })
  ok('둘 다 없음 → 종전대로 공란', /이행조치 필요기간<\/td>\s*<td class="row-period">\s*(<span[^>]*>)?(&nbsp;|\s)*(<\/span>)?<\/td>/.test(none)
    || !/총/.test(none.split('이행조치 필요기간')[1]?.slice(0, 200) ?? ''))
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 판정 프로브 ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
