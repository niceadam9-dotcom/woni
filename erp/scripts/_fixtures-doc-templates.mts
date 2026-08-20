/** 인쇄 번들 8종 렌더 픽스처 — 오버라이드 프로브·테스트 공용.
 *
 *  한 곳에 두는 이유: _probe-override-feasibility(전제 실측)와 test-annex-overrides(불변식 고정)가
 *  서로 다른 픽스처를 쓰면 한쪽만 통과하는 상태가 생긴다. 같은 문서를 봐야 같은 결론이 나온다.
 *
 *  동적 import(.ts 확장자) — tsx v4.21+node24가 .ts 정적 named import를 해석하지 못한다
 *  (test-spec-derive.mts 주석 참조). */

const { renderReport4 } = await import('../src/lib/doc-templates/report4.ts')
const { renderReport9 } = await import('../src/lib/doc-templates/report9.ts')
const { renderReport10, renderReport11 } = await import('../src/lib/doc-templates/report1011.ts')
const { renderExterior } = await import('../src/lib/doc-templates/exterior.ts')
const { renderCover } = await import('../src/lib/doc-templates/cover.ts')
const { renderOfficial } = await import('../src/lib/doc-templates/official.ts')
const { renderDelegation } = await import('../src/lib/doc-templates/delegation.ts')

const cast = <T,>(v: unknown) => v as T
const person = { name: '김점검', qual: '소방시설관리사', regNo: '제1234호', phone: '010-0000-0000' }

/** 화면(image-58) 실측 규모 — 설치 설비 13종 × 31항목. 별지 4호 크기·페이지네이션의 근거. */
export function sheetSections(count = 13, itemsPer = 31) {
  return Array.from({ length: count }, (_, s) => ({
    no: s + 1,
    name: `${s + 1}번 설비`,
    items: Array.from({ length: itemsPer }, (_, i) => ({
      code: `${s + 1}-${String(i + 1).padStart(3, '0')}`,
      name: `점검항목 ${i + 1} — 설치기준 및 설치상태의 적정 여부 확인`,
      mark: (i % 4 === 3 ? null : (['O', 'X', 'N'] as const)[i % 3]),
      comprehensive: i % 5 === 0,
      group: i % 10 === 0 ? `${s + 1}-${'ABC'[(i / 10) | 0] ?? 'A'}. 중분류` : null,
      subgroup: i % 7 === 0 ? '소제목' : null,
    })),
  }))
}

export const base9 = {
  ckOp: true, ckInitial: false, ckCompEtc: false,
  customerName: '테스트빌딩', purpose: '근린생활시설', address: '경기도 양평군 양평읍 1',
  inspPeriod: '2026년 8월 1일 ~ 2026년 8월 2일', inspDays: '2일',
  companyName: '㈜승진소방ENG', companyPhone: '031-000-0000',
  consent: true, reportEmail: 'a@b.kr',
  main: person, assistants: [person, person],
  reportDate: '2026년 8월 3일', submitTo: '관계인ㆍ양평소방서장',
  repRole: '소유자', ownerName: '홍길동', ownerPhone: '010-1111-2222',
  managerGrade: '2급', mgrName: '이관리', mgrPhone: '010-3333-4444', mgrEduDate: '2026-03-01',
  hasFirePlan: true, prevOpDone: true, prevCompDone: false, eduDone: true, drillDone: true,
  insuranceJoined: true, insCompany: '보험사', insPeriod: '1년', insPerson: '1억', insProperty: '10억',
  multiUseNone: false, multiUseCounts: { 일반음식점: '2' },
  permitDate: '2000-01-01', useApprovalDate: '2001-01-01',
  totalArea: '1000', buildingArea: '500', households: '0',
  floorsAbove: '5', floorsBelow: '1', heightM: '20', buildingCount: '1',
  stCon: true, stSteel: false, stBrick: false, stWood: false, stEtc: false,
  rfSlab: true, rfTile: false, rfSlate: false, rfEtc: false,
  elvR: '1', elvE: '1', elvV: '', pkIn: true, pkMech: false, pkRoof: false, pkOut: true,
  facilityChecks: ['소화기구 및 자동소화장치', '옥내소화전설비', '피난기구'],
  resultMarks: { 옥내소화전설비: 'O' as const },
  etcMarks: { door: 'O' as const },
  muResults: { 'MU-001': 'N' as const },
  defectRows: [{ content: '유도등 미점등', period: '2026-08-10' }],
  ledgerCodes: ['소화기구 및 자동소화장치', '옥내소화전설비', '피난기구', '유도표지'],
  building: { emergency_elevator_count: 1 },
  specs: { s36_evac: { evac_equipment: { types: ['완강기'] } } },
}

export const base1011 = {
  customerName: '테스트빌딩', purpose: '근린생활시설', address: '경기도 양평군 양평읍 1',
  ownerName: '홍길동', ownerPhone: '010-1111-2222', mgrName: '이관리', mgrPhone: '010-3333-4444',
  rows: [
    { content: '유도등 교체', period: '2026-08-10' },
    { content: '소화기 충전', period: '2026-08-12' },
  ],
  reportDate: '2026년 8월 3일', submitTo: '양평소방서장',
  totalPeriod: '2026년 8월 1일 ~ 2026년 8월 20일', totalDays: '20일',
  companyName: '㈜승진소방ENG', companyBizno: '000-00-00000', companyRep: '대표',
  companyPhone: '031-000-0000', companyAddress: '경기도 양평군',
}

export const baseExterior = {
  customerName: '테스트빌딩', purpose: '근린생활시설', address: '경기도 양평군 양평읍 1',
  mgrTitle: '', mgrName: '이관리', mgrPhone: '010-3333-4444', year: '2026',
  months: [
    { month: 7, day: 15, inspectorName: '김점검', good: true, results: { 'X1-01': 'O' as const } },
    { month: 8, day: 18, inspectorName: '김점검', good: false, results: { 'X1-01': 'X' as const } },
  ],
  remark: '8월 유도등 불량',
}

export const coverOf = (photo: string | null, logo: string | null) => ({
  year: 2026, typeLabel: '작동점검', buildingName: '테스트빌딩',
  photoSrc: photo, issueLabel: '2026년 8월',
  company: { name: '㈜승진소방ENG', address: '경기도 양평군', phone: '031-000-0000', fax: '031-000-0001', logoSrc: logo },
})

export const baseOfficial = {
  company: { name: '㈜승진소방ENG', address: '경기도 양평군', phone: '031-000-0000', fax: '031-000-0001' },
  docNo: '승 진 2608-977', sendDate: '2026년 8월', recipient: '테스트빌딩',
  reference: '소방안전관리자 및 관계인', sender: '㈜승진소방 ENG', year: 2026, typeLabel: '작동점검',
  // 147 하단 발신 명의 — OfficialData의 **필수** 필드다. 빠지면 signBlock이 s.name에서 터진다.
  // ⚠ 아래 DOCS가 렌더 인자를 cast<>로 넘겨 타입 검사를 우회하므로 tsc는 이 누락을 못 잡는다 —
  //   서식에 필드가 늘면 여기도 같이 늘려야 하고, 안 늘리면 **실행할 때** 죽는다.
  //   레터헤드(company.name, 약식 상호)와 일부러 다른 값을 둔다: 명의는 법인 정식 상호.
  senderSign: { name: '주식회사 승진소방ENG', title: '대표이사', rep: '김흥준' },
}

export const baseDelegation = {
  typeLabel: '작동점검',
  owner: { name: '홍길동', position: '소방안전관리자', phone: '010-1111-2222', birth: '1972.12.27' },
  agent: { name: '김대리', position: '과장', phone: '010-3333-4444', birth: '1987.10.13' },
  periodLabel: '2026.08.01 부터 ~ 2026.08.02 까지', daysLabel: '2일',
  submitDate: '2026년 8월 3일', station: '양평',
}

export type DocFixture = {
  key: string
  label: string
  render: (highlight: boolean) => string
  /** highlight 옵션을 받는 서식인가 (표지·공문·위임장은 안 받는다) */
  hasHighlight: boolean
}

/** 인쇄 번들 8종 — bundle/route.ts의 TYPE_ORDER와 같은 순서 */
export const DOCS: DocFixture[] = [
  { key: 'official', label: '공문', hasHighlight: false,
    render: () => renderOfficial(cast<Parameters<typeof renderOfficial>[0]>(baseOfficial)) },
  { key: 'delegation', label: '위임장', hasHighlight: false,
    render: () => renderDelegation(cast<Parameters<typeof renderDelegation>[0]>(baseDelegation)) },
  { key: 'cover', label: '표지', hasHighlight: false,
    render: () => renderCover(cast<Parameters<typeof renderCover>[0]>(coverOf('cover.jpg', 'logo.png'))) },
  { key: 'report9', label: '별지 9호(실시결과보고서)', hasHighlight: true,
    render: h => renderReport9(cast<Parameters<typeof renderReport9>[0]>(base9), { highlight: h }) },
  { key: 'report4', label: '별지 4호(점검표)', hasHighlight: true,
    render: h => renderReport4(cast<Parameters<typeof renderReport4>[0]>(report4Data()), { highlight: h }) },
  { key: 'report10', label: '별지 10호(이행계획서)', hasHighlight: true,
    render: h => renderReport10(cast<Parameters<typeof renderReport10>[0]>(base1011), { highlight: h }) },
  { key: 'report11', label: '별지 11호(이행완료보고서)', hasHighlight: true,
    render: h => renderReport11(cast<Parameters<typeof renderReport11>[0]>({ ...base1011, note: '완료 보고합니다' }), { highlight: h }) },
  { key: 'exterior', label: '외관점검표', hasHighlight: true,
    render: h => renderExterior(cast<Parameters<typeof renderExterior>[0]>(baseExterior), { highlight: h }) },
]

/** 별지 4호 데이터 — 항목 수를 바꾸면 설비마다 쪽 분할이 달라져 **뒤 쪽 인덱스가 통째로 밀린다**.
 *  (report4.ts의 sheetItemPages가 SHEET_PAGE_W_FIRST/NEXT 예산으로 손수 쪽을 나누기 때문)
 *  앵커 복구 시나리오를 만드는 손잡이다 — 설비 수만 늘리면 **뒤에 붙기만 해서** 앞 설비의 키는 안 밀린다. */
export function report4Data(sectionCount = 13, itemsPer = 31) {
  return {
    ...base9,
    sheetSections: sheetSections(sectionCount, itemsPer),
    inspStart: '2026년 8월 1일', inspEnd: '2026년 8월 2일', inspDays: '2일',
    companyRegNo: '제2026-1호', pumpRows: [],
  }
}

export function renderReport4With(sectionCount: number, itemsPer = 31, highlight = true): string {
  return renderReport4(cast<Parameters<typeof renderReport4>[0]>(report4Data(sectionCount, itemsPer)), { highlight })
}

/** 별지 9호 — 임의 필드를 덮어써 '자동값이 갱신된' 상황을 만든다 */
export function renderReport9With(patch: Record<string, unknown>, highlight = true): string {
  return renderReport9(cast<Parameters<typeof renderReport9>[0]>({ ...base9, ...patch }), { highlight })
}

export function renderCoverWith(photo: string | null, logo: string | null): string {
  return renderCover(cast<Parameters<typeof renderCover>[0]>(coverOf(photo, logo)))
}
