/** 소방계획서_15 P2·P4 구현 렌더 검증 — 순수 렌더 함수 단언(DB 불필요)
 *  대상: Q-2(별지4호 설비별 점검표 O/X만) · A4-2(등록번호) · A9-3(특별피난계단) ·
 *        Q-1(자동 채움 미리보기 표시, PDF 불변) · M-16~19(설계 보강 4건 인쇄)
 *  실행: npx tsx --conditions=react-server scripts/_probe-soban15-p2.mts  (_h12-snapshot 관례 — default import + 캐스트) */
import r4mod from '../src/lib/doc-templates/report4.ts'
import type { Report4Data } from '../src/lib/doc-templates/report4.ts'
import r9mod from '../src/lib/doc-templates/report9.ts'
import type { Report9Data } from '../src/lib/doc-templates/report9.ts'
import tplmod from '../src/lib/fire-plan-template.ts'
import type { FirePlanGenData } from '../src/lib/fire-plan-template.ts'

const { renderReport4 } = r4mod as unknown as typeof import('../src/lib/doc-templates/report4.ts')
const { renderReport9 } = r9mod as unknown as typeof import('../src/lib/doc-templates/report9.ts')
const { buildFirePlanHtml } = tplmod as unknown as typeof import('../src/lib/fire-plan-template.ts')

let pass = 0, fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ── 공통 최소 데이터 ────────────────────────────────────────────────
const r4base: Report4Data = {
  ckOp: true, ckInitial: false, ckCompEtc: false,
  customerName: '프로브빌딩', purpose: '근린생활시설', address: '경기도 양평군',
  facilityChecks: [], resultMarks: {}, muResults: {},
  main: null, assistants: [], inspStart: '', inspEnd: '', inspDays: '',
  companyName: '승진소방ENG', specs: {},
}

console.log('— Q-2: 별지4호 설비별 점검표 (O/X만 수록)')
{
  const html = renderReport4({
    ...r4base,
    sheetSections: [
      { no: 1, name: '소화기구 및 자동소화장치 점검표', items: [
        { code: '1-A-001', name: '거주자 등이 손쉽게 사용할 수 있는 장소에 설치되어 있는지 여부', mark: 'O' },
        { code: '1-A-007', name: '지시압력계 정상 범위 여부', mark: 'X' },
      ] },
      { no: 15, name: '자동화재탐지설비 점검표', items: [
        { code: '15-B-002', name: '수신기 음향장치 정상 여부', mark: 'O' },
      ] },
    ],
  })
  ok('부속 제목 인쇄', html.includes('설비별 점검표'))
  ok('O 항목 코드·○ 인쇄', html.includes('1-A-001') && /1-A-001[\s\S]{0,200}?○/.test(html))
  ok('X 항목 ×로 인쇄', /1-A-007[\s\S]{0,200}?×/.test(html))
  ok('설비 그룹 헤더 인쇄', html.includes('1. 소화기구 및 자동소화장치 점검표') && html.includes('15. 자동화재탐지설비 점검표'))
  ok('생략 안내문 인쇄', html.includes('해당없음(／)·미점검 항목은 생략'))

  const emptyHtml = renderReport4({ ...r4base, sheetSections: [] })
  ok('O/X 전무 시 부속 쪽 미생성', !emptyHtml.includes('설비별 점검표'))
  const undefHtml = renderReport4(r4base)
  ok('sheetSections 미공급(구 호출) 시에도 미생성·렌더 정상', !undefHtml.includes('설비별 점검표') && undefHtml.includes('소방시설등 점검표'))
}

console.log('— A4-2: 관리업 등록번호')
{
  const withNo = renderReport4({ ...r4base, companyRegNo: '2026-15' })
  ok('등록번호 인쇄 (제 2026-15 호)', withNo.includes('제 2026-15 호'))
  const without = renderReport4(r4base)
  ok('미입력 시 종전 공란 유지', without.includes('(제    -    호)'))
}

console.log('— A9-3: 별지9호 2쪽 특별피난계단')
{
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
    rampCount: '', stairsCount: '2',
    facilityChecks: [], resultMarks: {}, muResults: {}, specs: {}, defectRows: [],
  } as unknown as Report9Data
  const withSp = renderReport9({ ...r9base, specialStairCount: '3' })
  ok('특별피난계단 [√]+개소 인쇄', /\[√\]특별피난계단 \(3 {2}개소\)/.test(withSp))
  const without = renderReport9(r9base)
  ok('미입력 시 종전 빈 체크 유지', /특별피난계단 \( {2}개소\)/.test(without) && !/\[√\]특별피난계단/.test(without))
}

// ── 본문 템플릿 공통 데이터 ─────────────────────────────────────────
const planBase = {
  year: 2026, buildingName: '프로브빌딩', address: '', grade: '', purpose: '',
  useApprovalDate: '', totalArea: '', buildingArea: '', floors: '', height: '',
  structure: '', roof: '', receiverLocation: '', ownerName: '', ownerPhone: '',
  managerName: '', managerPhone: '', managerSelectedAt: '', fireStation: '',
  stationDistance: '', stationEta: '', facilities: [] as string[],
  companyName: '', companyAddress: '', companyPhone: '', contractStart: '', inspectionCycle: '',
  operationMonth: '', comprehensiveMonth: '', trainingMonth: null,
  brigade: [] as unknown[], evacRoutes: [] as unknown[], assembly: '', evacNote: '',
  zones: [] as unknown[], hazards: [] as unknown[],
  revisions: [] as unknown[], photos: [] as unknown[],
  revisionDate: '', revisionNote: '', ops: null, forms: {},
} as unknown as FirePlanGenData

console.log('— Q-1: 자동 채움 미리보기 표시 (PDF 불변)')
{
  const html = buildFirePlanHtml({
    ...planBase,
    assembly: '1층 주차장', evacNote: '기본 문구',
    autoFilled: ['brigade', 'assembly', 'evacNote', 'zones', 'hazards', 'evacRoutes'],
  } as FirePlanGenData)
  ok('배너 인쇄', html.includes('autofill-banner') && html.includes('자동 채움(미입력 폴백)'))
  ok('배너에 구획 라벨 나열', html.includes('자위소방대 편성') && html.includes('집결지'))
  ok('행 표시 클래스 부여', html.includes('class="autofill"') && html.includes('l autofill'))
  ok('하이라이트는 @media screen 한정(PDF 불변)', /@media screen \{[\s\S]*?\.autofill \{ background/.test(html))
  ok('배너 기본 display:none(인쇄 매체 숨김)', /\.autofill-banner \{ display: none; \}/.test(html))
  const clean = buildFirePlanHtml(planBase)
  ok('autoFilled 없으면 배너·클래스 없음', !clean.includes('autofill-banner') || !/class="autofill"/.test(clean))
}

console.log('— M-17: 1.6 비상발전기·정압기 구조화')
{
  const html = buildFirePlanHtml({
    ...planBase,
    forms: { etcFacility: {
      electric: { kw: '', kva: '', location: '', qty: '', generator: true, generatorNote: '', note: '', genKw: '150', genLocation: '지하1층 기계실', genQty: '1' },
      gas: { kind: 'LNG', location: '', usage: '', regulator: true, shutoff: false, shutoffLocation: '', regulatorLocation: '옥외 배관실' },
      hazmat: { none: true, note: '' },
    } },
  } as unknown as FirePlanGenData)
  ok('발전기 용량·위치·수량 인쇄', html.includes('150kW') && html.includes('위치 지하1층 기계실') && html.includes('1대'))
  ok('정압기 위치 인쇄', html.includes('정압기') && html.includes('위치: 옥외 배관실'))
  const legacy = buildFirePlanHtml({
    ...planBase,
    forms: { etcFacility: {
      electric: { kw: '', kva: '', location: '', qty: '', generator: true, generatorNote: '100kW 옥상', note: '' },
      gas: { kind: '', location: '', usage: '', regulator: false, shutoff: false, shutoffLocation: '' },
      hazmat: { none: false, note: '' },
    } },
  } as unknown as FirePlanGenData)
  ok('레거시 자유 텍스트 폴백 유지', legacy.includes('(100kW 옥상)'))
}

console.log('— M-16: 1.10.3 영업시간 세분·이용자 유형')
{
  const html = buildFirePlanHtml({
    ...planBase,
    forms: { multiUse: {
      applicable: true, categories: { '노래연습장': '1' }, bizName: '', location: '', owner: '', phone: '',
      hours: '', users: '', capacity: '50',
      hoursDetail: { wkDay: '09:00~18:00', wkNight: '18:00~24:00', holDay: '10:00~22:00', holNight: '' },
      userTypes: ['노유자', '청소년'],
    } },
  } as unknown as FirePlanGenData)
  ok('평일 주간·야간 세분 인쇄', html.includes('평일') && html.includes('(09:00~18:00)') && html.includes('(18:00~24:00)'))
  ok('휴일 주간 인쇄', html.includes('휴일') && html.includes('(10:00~22:00)'))
  ok('이용자 유형 체크 인쇄', /\[√\]<span class="ck-label">노유자|\[√\] ?노유자/.test(html.replace(/\s+/g, ' ')) || html.includes('노유자'))
  const legacy = buildFirePlanHtml({
    ...planBase,
    forms: { multiUse: { applicable: true, categories: {}, bizName: '', location: '', owner: '', phone: '', hours: '평일 10~22시', users: '일반', capacity: '' } },
  } as unknown as FirePlanGenData)
  ok('레거시 hours·users 폴백 유지', legacy.includes('평일 10~22시') && legacy.includes('일반'))
}

console.log('— M-19: 1.11.2 종류·형태 구조화')
{
  const html = buildFirePlanHtml({
    ...planBase,
    forms: { training: {
      headcount: { worker: '', resident: '', brigade: '' }, eduMonths: [], drillMonths: [],
      details: [
        { name: '1차', at: '', place: '', target: '', kind: '', form: '', materials: '', plan: '', kindPractice: '기본', kindTheory: '강의', formType: '합동', formPartner: '양평소방서' },
        { name: '2차(레거시)', at: '', place: '', target: '', kind: '이론', form: '자체', materials: '', plan: '' },
      ],
      scenario: '', scenarioType: '', records: [],
    } },
  } as unknown as FirePlanGenData)
  ok('구조화 종류 인쇄', html.includes('실습(기본)·이론(강의)'))
  ok('합동+참여기관 인쇄', html.includes('합동(양평소방서)'))
  ok('레거시 kind·form 폴백 유지', /2차\(레거시\)[\s\S]{0,300}?이론[\s\S]{0,120}?자체/.test(html))
}

console.log('— M-18: 비상연락체계 텍스트')
{
  const html = buildFirePlanHtml({
    ...planBase,
    forms: { emergencyContact: '발견자 → 자위소방대장 → 119' },
  } as unknown as FirePlanGenData)
  ok('서식 2.2 아래 비상연락체계 인쇄', html.includes('비상연락체계</th><td class="l" style="white-space:pre-wrap">발견자 → 자위소방대장 → 119'))
  const without = buildFirePlanHtml(planBase)
  ok('미입력 시 행 미생성', !without.includes('white-space:pre-wrap'))
}

console.log(`\n결과: ${pass}/${pass + fail} 통과`)
process.exit(fail ? 1 : 0)
