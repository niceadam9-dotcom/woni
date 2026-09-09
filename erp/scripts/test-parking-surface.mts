/**
 * 주차장 축 — 저장한 값이 **소방계획서 두 표면에 도달하는가** (2026-09-09 신설)
 *
 * 왜 생겼나: 건물 폼에 「옥외 자주식 8대」를 저장했는데 소방계획서 엑셀이 공란이라는 지적을 받았다.
 * 원인은 **세 층에 걸쳐 있었다** — ①조립기 `select` 목록에 `parking_summary`가 없고
 * ②`FirePlanGenData`에 필드가 없고 ③앵커·값 축도 미배선. 어느 한 층만 봐서는 안 보인다.
 * 🚨 그리고 **이 축을 단언하는 검사가 하나도 없었다** — 그래서 전 스위트가 초록인 채 배포됐다.
 *
 * 판정 축을 셋으로 나눈다:
 *   [1] 규칙 — 별지 9호와 **같은 함수**(parseParkingSummary)를 쓰는가 (사본이면 언젠가 갈라진다)
 *   [2] 엑셀 — 1.1 L13·AB13 상자가 값에 따라 켜지고, 값이 없으면 안 켜진다(음성 대조)
 *   [3] PDF  — 같은 값이 HTML에도 도달하고 원문(대수)이 보존되는가
 *
 * 실행: npx tsx --conditions=react-server scripts/test-parking-surface.mts   (server-only 우회)
 */
import { buildFirePlanValues } from '../src/lib/fire-plan-xlsx-values.ts'
import { buildFirePlanHtml, type FirePlanGenData } from '../src/lib/fire-plan-template.ts'
import { parseParkingSummary } from '../src/lib/doc-templates/report9.ts'
import { FIRE_PLAN_ANCHORS } from '../src/lib/fire-plan-anchors.ts'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

/* 픽스처는 `test-print-source-pin`의 표준본을 따른다(렌더가 요구하는 필드가 많다).
 * ⚠ `assembly`를 「건물 앞 공터」로 둔다 — 표준본의 「건물 앞 주차장」을 그대로 쓰면
 *   내 정규식이 집결지 문구를 물어 **엉뚱한 줄을 보고 초록**이 될 수 있다. */
const base = (parking: string): FirePlanGenData => ({
  year: 2026, revisionDate: '2026-01-02', revisionNote: '최초 작성', revisions: [],
  buildingName: '주차장검사', address: '서울특별시 중구 세종대로 110',
  grade: '2급', purpose: '업무시설', useApprovalDate: '2010-03-04',
  totalArea: '4500', buildingArea: '900', floors: '지하1층 / 지상5층', height: '21',
  structure: '철근콘크리트', roof: '슬래브', receiverLocation: '1층 방재실',
  ownerName: '표준소유자', ownerPhone: '02-0000-0000',
  managerName: '표준관리자', managerPhone: '010-0000-0000', managerSelectedAt: '2025-01-02',
  fireStation: '중부소방서', stationDistance: '2.4', stationEta: '6',
  facilities: ['소화기구 및 자동소화장치'],
  companyName: '표준소방', companyAddress: '서울특별시 중구 1', companyPhone: '02-1111-1111',
  contractStart: '2025-01-01', inspectionCycle: '매월 1회',
  operationMonth: '2026년 7월', comprehensiveMonth: '', trainingMonth: null,
  brigade: [{ team: '지휘반', name: '표준관리자', duty: '총괄', phone: '010-0000-0000' }],
  evacRoutes: [{ floor: '5층', route: '동편 계단', guide: '표준관리자', equip: '완강기' }],
  assembly: '건물 앞 공터', evacNote: '방송 후 계단으로 유도한다.',
  evacFalseAlarm: '수신기에서 발신 지구를 확인한다.', evacMethod: '낮은 자세로 대피한다.',
  zones: [{ zone: '1구역', name: '1~2층', area: '1800', weekday: '20', holiday: '2', managerCo: '표준소방', contact: '02-1111-1111' }],
  hazards: [{ place: '전기실', location: '지하1층', factors: ['전기적 요인'] }],
  photos: [],
  parkingSummary: parking,
} as unknown as FirePlanGenData)

console.log('\n[1] 판정 규칙 — 별지 9호와 한 함수')
{
  const pk = parseParkingSummary('옥외 자주식 8대')
  check('「옥외 자주식 8대」→ 옥외 켜짐', pk.pkOut === true, JSON.stringify(pk.pkOut))
  check('같은 값에서 옥내는 꺼짐(음성)', pk.pkIn === false, JSON.stringify(pk.pkIn))
  const pk2 = parseParkingSummary('옥내 기계식 12대')
  check('「옥내 기계식」→ 옥내·기계식 켜짐', pk2.pkIn === true && pk2.pkMech === true)
  check('빈 값이면 전부 꺼짐', Object.values(parseParkingSummary('')).every(v => v === false))
}

console.log('\n[2] 엑셀 — 1.1 주차장 두 칸')
{
  const anchors = FIRE_PLAN_ANCHORS.filter(a => a.field === 'parking_indoor' || a.field === 'parking_outdoor')
  check('주차장 앵커가 두 칸이다', anchors.length === 2, anchors.map(a => `${a.sheet}!${a.cell}`).join(' · '))
  check('좌표가 1.1의 13행이다', anchors.every(a => /13$/.test(a.cell) && a.sheet.startsWith('1.1')),
    anchors.map(a => a.cell).join(','))

  const v = buildFirePlanValues(base('옥외 자주식 8대'))
  const inCell = String(v.get('parking_indoor') ?? '')
  const outCell = String(v.get('parking_outdoor') ?? '')
  check('값 맵에 두 필드가 있다', v.has('parking_indoor') && v.has('parking_outdoor'))
  check('옥외 칸이 체크(■)된다', /■/.test(outCell), JSON.stringify(outCell))
  check('옥내 칸은 미체크(음성 대조)', !/■/.test(inCell), JSON.stringify(inCell))
  check('라벨 자구가 살아 있다(값이 라벨을 덮지 않는다)', /옥외/.test(outCell) && /옥내/.test(inCell))

  // 🚨 이 검사의 핵심 — 주차장을 안 넣으면 어느 칸도 켜지지 않아야 한다.
  //    (종전 결함 상태에서는 '늘 안 켜짐'이라 위 양성 단언만으로는 구별되지 않는다)
  const v0 = buildFirePlanValues(base(''))
  check('빈 값이면 두 칸 다 미체크', !/■/.test(String(v0.get('parking_indoor') ?? '')) && !/■/.test(String(v0.get('parking_outdoor') ?? '')))
}

console.log('\n[3] PDF — 같은 값이 HTML에 도달')
{
  const html = buildFirePlanHtml(base('옥외 자주식 8대'), [])
  // ⚠ `ck()`가 `<span class="ck">■ 옥외</span>`를 내므로 `[^<]*`로 끊으면 **라벨 앞에서 멈춰**
  //   빈손("주차장: ")을 보고도 초록이 될 뻔했다 — 셀이 닫힐 때까지 통째로 잡는다.
  const row = (html.match(/주차장:[\s\S]*?<\/td>/) ?? [''])[0]
  // 추출에 성공했다는 것부터 단언한다 — 빈손을 보고 초록이 되는 공허 통과를 막는다
  check('주차장 줄을 실제로 뽑았다(상자 3개가 다 들어 있다)',
    (row.match(/[■☐]/g) ?? []).length === 3, JSON.stringify(row.slice(0, 80)))
  check('옥외가 체크로 표시된다', /■\s*옥외/.test(row), JSON.stringify(row.slice(0, 60)))
  check('옥내는 빈 상자다(음성)', /[□☐]\s*옥내/.test(row))
  check('원문 대수가 보존된다', html.includes('옥외 자주식 8대'))

  const html0 = buildFirePlanHtml(base(''), [])
  const row0 = (html0.match(/주차장:[\s\S]*?<\/td>/) ?? [''])[0]
  check('값이 없으면 어느 상자도 안 켜진다', !/■/.test(row0), JSON.stringify(row0.slice(0, 60)))
}

console.log(`\n=== pass ${pass} / fail ${fail} ===`)
process.exit(fail === 0 ? 0 : 1)
