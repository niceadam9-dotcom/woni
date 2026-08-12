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
const { renderReport9 } = r9mod as unknown as typeof import('../src/lib/doc-templates/report9.ts')
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

console.log('— EX-1: 외관 비고칸 메모 요약')
{
  const extBase = {
    customerName: '프로브빌딩', purpose: '', address: '', mgrTitle: '', mgrName: '', mgrPhone: '',
    year: '2026', month: 8, day: 11, inspectorName: '', monthGood: false, results: { 'X1-01': 'X' },
  } as unknown as ExteriorData
  const html = renderExterior({ ...extBase, remark: 'X1-01 소화기 압력 미달' })
  ok('비고칸에 메모 인쇄', html.includes('X1-01 소화기 압력 미달'))
  const empty = renderExterior(extBase)
  ok('메모 없으면 종전 공란', /<th>비고<\/th><td[^>]*>&nbsp;<\/td>/.test(empty))
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
  ok('미선택은 ☐', /\[&nbsp;&nbsp;\]옥외소화전설비/.test(html))
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
    year: '2026', month: 8, day: 11, inspectorName: '', monthGood: null, results: {},
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
