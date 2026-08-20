/** 소방계획서_19 B-2~B-5·B-8 P1 렌더 검증 — 순수 렌더 함수 단언(DB 불필요)
 *  조립 측(B-2 판정·B-5b·B-5d·E10/E11 날짜·EX-1/EX-5 집계)은 독립 검증 패스에서 실주행.
 *  실행: npx tsx --conditions=react-server scripts/_probe-soban19-b.mts */
import r4mod from '../src/lib/doc-templates/report4.ts'
import type { Report4Data } from '../src/lib/doc-templates/report4.ts'
import r9mod from '../src/lib/doc-templates/report9.ts'
import type { Report9Data } from '../src/lib/doc-templates/report9.ts'
import extmod from '../src/lib/doc-templates/exterior.ts'
import type { ExteriorData } from '../src/lib/doc-templates/exterior.ts'
import tplmod from '../src/lib/fire-plan-template.ts'
import type { FirePlanGenData } from '../src/lib/fire-plan-template.ts'
import ptsmod from '../src/lib/plan-text-sections.ts'

const { renderReport4 } = r4mod as unknown as typeof import('../src/lib/doc-templates/report4.ts')
const { renderReport9, parseParkingSummary } = r9mod as unknown as typeof import('../src/lib/doc-templates/report9.ts')
const { renderExterior } = extmod as unknown as typeof import('../src/lib/doc-templates/exterior.ts')
const { buildFirePlanHtml } = tplmod as unknown as typeof import('../src/lib/fire-plan-template.ts')
const { planTextBodyEquals } = ptsmod as unknown as typeof import('../src/lib/plan-text-sections.ts')

let pass = 0, fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const r9base = {
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

console.log('— B-3: 기타 3항목 (31번 응답 롤업, 별지4·9호 공용)')
{
  const html = renderReport9({ ...r9base, etcMarks: { door: 'X', exit: 'O', flame: 'N' } })
  ok('방화문 X → √+×', /\[√\]방화문, 자동방화셔터[\s\S]{0,120}?×/.test(html))
  ok('비상구 O → √+○', /\[√\]비상구, 피난통로[\s\S]{0,120}?○/.test(html))
  ok('방염 N → ☐+／', /\[&nbsp;&nbsp;\]방  염[\s\S]{0,120}?\//.test(html))
  const legacy = renderReport9(r9base)
  ok('미공급(구 호출) → 종전 ☐+공란', /\[&nbsp;&nbsp;\]방화문, 자동방화셔터/.test(legacy))
  const r4: Report4Data = {
    ckOp: true, ckInitial: false, ckCompEtc: false,
    customerName: '프로브빌딩', purpose: '', address: '',
    facilityChecks: [], resultMarks: {}, muResults: {},
    main: null, assistants: [], inspStart: '', inspEnd: '', inspDays: '',
    companyName: '', specs: {},
    etcMarks: { door: 'X' },
  }
  ok('별지4호 1쪽에도 동일 반영(공용 함수)', /\[√\]방화문, 자동방화셔터[\s\S]{0,120}?×/.test(renderReport4(r4)))
}

console.log('— B-4a·B-4b: 조문 줄·9쪽 작성방법')
{
  const html = renderReport9(r9base)
  ok('유의사항 조문 병기(제58조제1호)', html.includes('제58조제1호'))
  ok('유의사항 조문 병기(제61조제1항제8호)', html.includes('제61조제1항제8호'))
  ok('9쪽 작성방법 페이지 출력', html.includes('작성방법') && html.includes('전산입력되는 서식'))
  ok('9쪽에 교육훈련(전년도) 안내 포함', html.includes('교육훈련(전년도)'))
}

console.log('— B-4c: 주차장 옥내 하위')
{
  const html = renderReport9({ ...r9base, pkIn: true, pkInUg: true, pkInPiloti: true })
  ok('지하·필로티 √, 지상 ☐', /\[√\]지하 \[&nbsp;&nbsp;\]지상 \[√\]필로티/.test(html))
  const legacy = renderReport9(r9base)
  ok('미공급 → 종전 전부 ☐', /\[&nbsp;&nbsp;\]지하 \[&nbsp;&nbsp;\]지상 \[&nbsp;&nbsp;\]필로티/.test(legacy))
}

console.log('— B-4c 보강: parking_summary 매칭(조립·프로브 공용 함수)')
{
  // 기존 검증 케이스 — 출력 불변(회귀 없음)
  const p1 = parseParkingSummary('옥내(지하, 필로티), 옥외')
  ok('옥내(지하, 필로티), 옥외 → 옥내·지하·필로티 √, 지상 ☐', p1.pkIn && !!p1.pkInUg && !!p1.pkInPiloti && !p1.pkInGround && p1.pkOut)
  // L-2: 옥외 문맥의 '지상'이 옥내 하위로 오체크되지 않는다
  const p2 = parseParkingSummary('옥외 지상 6대')
  ok('옥외 지상 6대 → 옥내 ☐·지상 ☐·옥외 √', !p2.pkIn && !p2.pkInGround && p2.pkOut)
  // L-1: 지하는 서식상 옥내의 하위 유형 — 상위(옥내)도 함께 체크돼 모순 출력이 없다
  const p3 = parseParkingSummary('지하 자주식 30대')
  ok('지하 자주식 30대 → 옥내 √·지하 √', p3.pkIn && !!p3.pkInUg)
  // 실데이터 형태(스테이징 2건) — 전부 ☐ + 옥외 √ 유지
  const p4 = parseParkingSummary('옥외 자주식 6대')
  ok('옥외 자주식 6대 → 옥내·하위 전부 ☐, 옥외 √', !p4.pkIn && !p4.pkInUg && !p4.pkInGround && !p4.pkInPiloti && p4.pkOut)
}

console.log('— B-4d: 선임 형태 5종')
{
  const html = renderReport9({ ...r9base, mgrAppointType: '겸직' })
  ok('겸직 √', /\[√\]겸직/.test(html))
  ok('나머지 ☐', /\[&nbsp;&nbsp;\]소방기술자격/.test(html) && /\[&nbsp;&nbsp;\]기타/.test(html))
  const legacy = renderReport9(r9base)
  ok('미입력 → 전부 ☐(종전)', !/\[√\]겸직/.test(legacy))
}

console.log('— B-2: 교육훈련 실시 렌더(판정 분리)')
{
  const html = renderReport9({ ...r9base, eduDone: true, drillDone: false })
  ok('교육만 실시 체크(분리 판정)', /소방안전교육 \(\[√\]실시/.test(html) && /소방훈련 \(\[&nbsp;&nbsp;\]실시/.test(html))
}

console.log('— B-5a: M-9 최초점검 독립 출력')
{
  const planBase = {
    year: 2026, buildingName: '프로브빌딩', address: '', grade: '', purpose: '',
    useApprovalDate: '', totalArea: '', buildingArea: '', floors: '', height: '',
    structure: '', roof: '', receiverLocation: '', ownerName: '', ownerPhone: '',
    managerName: '', managerPhone: '', managerSelectedAt: '', fireStation: '',
    stationDistance: '', stationEta: '', facilities: [] as string[],
    companyName: '', companyAddress: '', companyPhone: '', contractStart: '', inspectionCycle: '',
    operationMonth: '', comprehensiveMonth: '', trainingMonth: null,
    brigade: [], evacRoutes: [], assembly: '', evacNote: '', zones: [], hazards: [],
    revisions: [], photos: [], revisionDate: '', revisionNote: '', ops: null, forms: {},
  } as unknown as FirePlanGenData
  const html = buildFirePlanHtml({
    ...planBase,
    comprehensiveMonth: '',
    forms: { inspection: { opMonth: '2026년 9월', opInspector: '외주', isInitial: true, initialMonth: '2026년 3월', compMonth: '', comp2Month: '', compInspector: '외주' } },
  } as unknown as FirePlanGenData)
  ok('종합월 없어도 최초점검 행 출력', html.includes('■ 최초점검 — 점검시기: 2026년 3월'))
  const withComp = buildFirePlanHtml({
    ...planBase,
    forms: { inspection: { opMonth: '', opInspector: '외주', isInitial: true, initialMonth: '2026년 3월', compMonth: '2026년 5월', comp2Month: '', compInspector: '외주' } },
  } as unknown as FirePlanGenData)
  ok('종합월 있으면 종전대로 병기(이중 행 없음)', withComp.includes('(최초점검: 2026년 3월)') && !withComp.includes('■ 최초점검 —'))

  console.log('— B-5d: 1.3 캐시 폴백 자동 채움 표시')
  const st = buildFirePlanHtml({ ...planBase, stationDistance: '2.4', stationEta: '7', autoFilled: ['station'] } as unknown as FirePlanGenData)
  ok('캐시 폴백 값 인쇄 + autofill 표시', st.includes('2.4 km') && /class="autofill">2\.4 km/.test(st))
  ok('배너에 1.3 라벨', st.includes('소방서 최단거리·도착시간(1.3 자동조회 캐시)'))
}

console.log('— EX-1·EX-4: 외관 비고칸 메모 + 연간 누적본')
{
  const extBase = {
    customerName: '프로브빌딩', purpose: '', address: '', mgrTitle: '', mgrName: '', mgrPhone: '',
    year: '2026', months: [],
  } as unknown as ExteriorData
  const mk = (month: number, day: number, good: boolean | null, results: Record<string, 'O' | 'X' | 'N'>, who = '') =>
    ({ month, day, good, results, inspectorName: who })

  const html = renderExterior({
    ...extBase,
    months: [
      mk(3, 5, true, { 'X1-01': 'O' }, '김점검'),
      mk(8, 11, false, { 'X1-01': 'X' }, '이점검'),
    ],
    remark: '8월 X1-01 소화기 압력 미달',
  } as unknown as ExteriorData)
  ok('비고칸에 월 표기 메모 인쇄', html.includes('8월 X1-01 소화기 압력 미달'))
  ok('3월 행 채움(양호·점검자)', html.includes('3월 5일') && html.includes('김점검'))
  ok('8월 행 채움(불량·점검자)', html.includes('8월 11일') && html.includes('이점검'))
  ok('미점검 달은 종전 빈 행', html.includes('월&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;일'))
  // 섹션 표 — 같은 항목이 3월엔 ○, 8월엔 ×로 두 열 모두 채워져야 한다(종전엔 1열만)
  const row = html.split('\n').find(l => l.includes('소화기의 변형') || l.includes('X1-01')) ?? ''
  const firstItemRow = html.match(/<tr><td class="itm">[\s\S]*?<\/tr>/)?.[0] ?? row
  const marks = (firstItemRow.match(/○|×/g) ?? [])
  ok('첫 항목 행에 ○·× 두 달 모두 표기', marks.includes('○') && marks.includes('×'), `실제 ${JSON.stringify(marks)}`)

  const empty = renderExterior(extBase)
  ok('기록 0개월 — 메모 없으면 종전 공란', /<th>비고<\/th><td[^>]*>&nbsp;<\/td>/.test(empty))
  ok('기록 0개월 — 12행 전부 빈 행', (empty.match(/월&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;일/g) ?? []).length === 12)

  const allN = renderExterior({ ...extBase, months: [mk(5, 2, null, { 'X1-01': 'N' })] } as unknown as ExteriorData)
  ok('EX-5 — 전부 N이면 양호·불량 양쪽 미체크', !/\[√\]양호/.test(allN) && !/\[√\]불량/.test(allN))
}

console.log('— A4-3: 세부현황 수계공통 \'설비의 종류\' 체크줄 (별지4·9호 공용)')
{
  const specs = {
    s32_water_common: {
      main_water: { systems: ['옥내소화전설비', '스프링클러설비'] },
      pump_type: { used: true, systems: ['옥내소화전설비'] },
    },
  }
  const html = renderReport9({ ...r9base, specs } as unknown as Report9Data)
  const lines = html.match(/◦ 설비의 종류:/g) ?? []
  ok('5개 블록 전부 체크줄 출력', lines.length === 5, `실제 ${lines.length}건`)
  ok('주된수원 선택분 √', /설비의 종류:[\s\S]{0,80}?\[√\]옥내소화전설비/.test(html))
  // 종전 단언은 두 칸짜리 '[&nbsp;&nbsp;]옥외소화전설비'를 찾았는데, 그건 base.ts ck()가 찍는
  // **3쪽 점검결과 표(FORM3_ITEMS)**를 맞히고 있었다 — 세부현황의 CB는 한 칸 '[&nbsp;]'이다.
  // 3-2 체크줄을 통째로 지워도 통과하는 가짜 양성이라(2026-08-20 실측) '설비의 종류' 줄 안으로 좁힌다.
  ok('미선택은 ☐', /설비의 종류:[\s\S]{0,120}?\[&nbsp;\]옥외소화전설비/.test(html))
  ok('8종 전부 나열', ['옥내소화전설비', '옥외소화전설비', '스프링클러설비', '간이스프링클러설비',
    '화재조기진압용스프링클러설비', '물분무소화설비', '미분무소화설비', '포소화설비'].every(s => html.includes(s)))
  const r4: Report4Data = {
    ckOp: true, ckInitial: false, ckCompEtc: false,
    customerName: 'P', purpose: '', address: '',
    facilityChecks: [], resultMarks: {}, muResults: {},
    main: null, assistants: [], inspStart: '', inspEnd: '', inspDays: '',
    companyName: '', specs,
  }
  ok('별지4호 세부현황에도 동일(공용 원본)', (renderReport4(r4).match(/◦ 설비의 종류:/g) ?? []).length === 5)
  ok('현행판 라벨 유지 — 압력체임버(구판 압력챔버 아님)', html.includes('압력체임버') && !html.includes('압력챔버'))
}

console.log('— EX-3: 외관 직위(1.7 구분)')
{
  const extBase = {
    customerName: 'P', purpose: '', address: '', mgrTitle: '', mgrName: '', mgrPhone: '',
    year: '2026', months: [],
  } as unknown as ExteriorData
  ok('직위 인쇄', renderExterior({ ...extBase, mgrTitle: '관리자', mgrName: '김선임' }).includes('관리자'))
}

console.log('— B-7: planTextBodyEquals (jsonb 키 순서 무관)')
{
  ok('키 순서 달라도 동등', planTextBodyEquals({ a: 1, b: { d: [1, 2], c: 'x' } }, { b: { c: 'x', d: [1, 2] }, a: 1 }))
  ok('내용 다르면 다름', !planTextBodyEquals({ a: 1 }, { a: 2 }))
  ok('배열 순서는 내용(다름 판정)', !planTextBodyEquals({ a: [1, 2] }, { a: [2, 1] }))
}

console.log(`\n결과: ${pass}/${pass + fail} 통과`)
process.exit(fail ? 1 : 0)
