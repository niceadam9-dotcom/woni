// 보고서 커버 렌더 프로브 (2026-08-10) — 문서 마지막 페이지 커버(업체명·연도) + 앞표지 연도 연동 검증
// 실행: npx tsx --conditions=react-server scripts/_probe-report-cover.mts
import tpl from '../src/lib/fire-plan-template.ts'
import type { FirePlanGenData } from '../src/lib/fire-plan-template.ts'

const { buildFirePlanHtml } = tpl as unknown as typeof import('../src/lib/fire-plan-template.ts')

// 최소 유효 샘플 (_h12-snapshot.mts 관례 축약본 — 커버 검증에 필요한 필드 중심)
const base: FirePlanGenData = {
  year: 2026,
  revisionDate: '2026-08-10', revisionNote: '2026년 소방계획서 작성',
  revisions: [],
  buildingName: '커버검증빌딩', address: '경기 양평군 검증로 12',
  grade: '2급', purpose: '근린생활시설', useApprovalDate: '2010-05-01',
  totalArea: '1234.5', buildingArea: '456.7', floors: '지상 5층', height: '18',
  structure: '철근콘크리트', roof: '슬래브', receiverLocation: '1층 관리실',
  ownerName: '홍대표', ownerPhone: '010-1111-2222',
  managerName: '홍대표', managerPhone: '010-1111-2222', managerSelectedAt: '2023-03-02',
  fireStation: '양평소방서', stationDistance: '2.4', stationEta: '7',
  facilities: ['소화기구'], companyName: '승진소방ENG', companyAddress: '경기 양평군 회사로 1',
  companyPhone: '031-000-0000', contractStart: '2024-01-01', inspectionCycle: '매월 1회',
  operationMonth: '2026년 7월', comprehensiveMonth: '2026년 1월', trainingMonth: 11,
  brigade: [], evacRoutes: [], assembly: '1층 주차장', evacNote: '',
  zones: [], hazards: [], photos: [],
  ops: {
    insuranceJoined: false, insuranceCompany: '', insurancePeriod: '',
    insuranceAmountPerson: '', insuranceAmountProperty: '',
    opHoursWeekday: '', opHoursHoliday: '',
    headcountWorker: '', headcountResident: '', headcountMax: '',
  },
  forms: {},
}

const checks: Array<[string, boolean]> = []
const backOf = (html: string) => html.slice(html.indexOf('<!-- 보고서 커버'))

// 1) 기본값 — reportCover 미입력이어도 커버는 항상 마지막 페이지에 나온다 (자동값: 연도=생성 연도, 업체명=고객명)
{
  const html = buildFirePlanHtml(base, [])
  const back = backOf(html)
  checks.push(['기본 — 마지막 커버 블록 존재', html.includes('<!-- 보고서 커버')])
  checks.push(['기본 — 커버가 문서 마지막 페이지(</body> 직전)', back.indexOf('</body>') > 0 && back.split('<div class="page').length === 2])
  checks.push(['기본 — 제목 2회(앞표지+커버)', html.split('소 방 계 획 서').length - 1 === 2])
  checks.push(['기본 — 자동 연도(생성 연도)', back.includes('2026년도')])
  checks.push(['기본 — 자동 업체명(고객명)', back.includes('[ 커버검증빌딩 ]')])
  checks.push(['기본 — 부기 폴백(업무대행 회사명)', back.includes('승진소방ENG')])
}

// 2) 입력값 — sections.reportCover가 있으면 커버·앞표지 연도가 함께 그 값을 따른다 (앞뒤 불일치 방지)
{
  const html = buildFirePlanHtml({
    ...base,
    forms: { reportCover: { company: '커버업체(주)', year: '2030', sub: '소방안전관리 업무대행 승진소방ENG' } },
  }, [])
  const back = backOf(html)
  checks.push(['입력 — 커버 연도 반영', back.includes('2030년도')])
  checks.push(['입력 — 앞표지 연도도 동일 값(불일치 방지)', !html.includes('2026년도')])
  checks.push(['입력 — 커버 업체명 반영', back.includes('[ 커버업체(주) ]')])
  checks.push(['입력 — 부기 문구 반영', back.includes('소방안전관리 업무대행 승진소방ENG')])
}

// 3) 이스케이프 — 입력값이 HTML로 주입되지 않는다
{
  const html = buildFirePlanHtml({
    ...base,
    forms: { reportCover: { company: '<b>주입</b>', year: '', sub: '' } },
  }, [])
  const back = backOf(html)
  checks.push(['이스케이프 — 태그 원문 미노출', !back.includes('<b>주입</b>')])
  checks.push(['이스케이프 — 엔티티 변환', back.includes('&lt;b&gt;주입&lt;/b&gt;')])
}

let fail = 0
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) fail++
}
console.log(`\n검사 ${checks.length}개 중 실패 ${fail}개`)
if (fail > 0) process.exit(1)
