/** 소방계획서_35 S0-3 / E-1 — 생성 PDF의 **소스 HTML을 sha256으로 고정**한다.
 *
 *  왜: 화면 배율(--fs-*)이 인쇄물로 새지 않는다는 것이 사용자 결정 D35-5의 핵심 제약이다.
 *  런타임 축(--print 모드)은 브라우저 Ctrl+P를 보고, 이 축은 **Gotenberg로 가는 문자열**을 본다.
 *  둘은 다른 경로다 — PDF는 화면 컴포넌트를 전혀 쓰지 않고 buildFirePlanHtml이 자체 HTML을 만든다.
 *
 *  ⚠ 이 검사가 항진명제가 되는 길
 *   ① 기준 해시를 '지금 값'으로 매번 다시 잡으면 무엇을 해도 통과한다 → **상수로 박는다**.
 *   ② 입력이 비면 출력도 거의 비어 어떤 변경도 안 보인다 → 고정 픽스처에 실값을 채우고
 *      **출력 길이 하한**을 함께 단언한다.
 *   ③ 해시만 보면 '무엇이 왜 바뀌었는지'를 못 본다 → 불일치 시 길이·구조 신호를 함께 찍는다.
 *
 *  해시가 바뀌면 그 자체로 실패가 아니라 **의도 확인 요구**다: 서식을 고쳤으면 새 값으로
 *  갱신(--print-hash)하고, 고친 적이 없는데 바뀌었다면 화면 축이 새어든 것이다.
 *
 *  실행: npx tsx --conditions=react-server scripts/test-print-source-pin.mts
 *        npx tsx --conditions=react-server scripts/test-print-source-pin.mts --print-hash
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { check, summary } from './_e2e-helpers.mjs'
import { buildFirePlanHtml, type FirePlanGenData } from '../src/lib/fire-plan-template'

const PRINT = process.argv.includes('--print-hash')

/** 고정 픽스처 — 실데이터가 아니라 결정적 상수다(고객 PII를 검사에 넣지 않는다).
 *  ⚠ `as unknown as FirePlanGenData` 캐스팅을 쓰지 않는다. 처음에 그렇게 썼다가
 *  zones 누락을 타입이 못 잡아 런타임에서야 터졌다 — 캐스팅은 타입 검사를 끄는 것이지
 *  통과시키는 게 아니다. 전 필드를 명시해 타입이 완전성을 강제하게 둔다. */
const FIXTURE: FirePlanGenData = {
  year: 2026, revisionDate: '2026-01-02', revisionNote: '최초 작성', revisions: [],
  buildingName: '검사용 표준건물', address: '서울특별시 중구 세종대로 110',
  grade: '2급', purpose: '업무시설', useApprovalDate: '2010-03-04',
  totalArea: '4500', buildingArea: '900', floors: '지하1층 / 지상5층', height: '21',
  structure: '철근콘크리트', roof: '슬래브', receiverLocation: '1층 방재실',
  ownerName: '표준소유자', ownerPhone: '02-0000-0000',
  managerName: '표준관리자', managerPhone: '010-0000-0000', managerSelectedAt: '2025-01-02',
  fireStation: '중부소방서', stationDistance: '2.4', stationEta: '6',
  facilities: ['소화기구 및 자동소화장치', '옥내소화전설비', '자동화재탐지설비 및 시각경보기'],
  companyName: '표준소방', companyAddress: '서울특별시 중구 1', companyPhone: '02-1111-1111',
  contractStart: '2025-01-01', inspectionCycle: '매월 1회',
  operationMonth: '2026년 7월', comprehensiveMonth: '',
  trainingMonth: null,
  brigade: [{ team: '지휘반', name: '표준관리자', duty: '총괄', phone: '010-0000-0000' }],
  evacRoutes: [{ floor: '5층', route: '동편 계단', guide: '표준관리자', equip: '완강기' }],
  assembly: '건물 앞 주차장', evacNote: '방송 후 계단으로 유도한다.',
  evacFalseAlarm: '수신기에서 발신 지구를 확인한다.', evacMethod: '연기를 피해 낮은 자세로 대피한다.',
  zones: [{ zone: '1구역', name: '1~2층', area: '1800', weekday: '20', holiday: '2', managerCo: '표준소방', contact: '02-1111-1111' }],
  hazards: [{ place: '전기실', location: '지하1층', factors: ['전기적 요인'] }],
  photos: [],
}

const html = buildFirePlanHtml(FIXTURE, [])
const sha = createHash('sha256').update(html, 'utf8').digest('hex')

if (PRINT) {
  console.log(`EXPECTED_SHA = '${sha}'`)
  console.log(`EXPECTED_MIN_LEN = ${html.length}`)
  process.exit(0)
}

const EXPECTED_SHA = '0879db0a142f15f8d5f19f1f3509a32f13f12d1a3518a8e8b8795dd55c5c73d6'
const EXPECTED_MIN_LEN = 26000   // 실측 26,551자 — 하한은 조금 낮춰 잡는다(사소한 문구 변화 허용)

// ② 입력이 비어 출력이 껍데기면 어떤 회귀도 안 보인다 — 하한을 먼저 단언한다.
check(`생성 HTML이 실질적이다 (${html.length}자 ≥ ${EXPECTED_MIN_LEN})`,
  html.length >= EXPECTED_MIN_LEN, '')

// 화면 토큰이 인쇄 소스에 섞였는가 — 이게 이 검사의 본론이다.
const leaked = (html.match(/--fs-\d|--fs-scale|text-form-|data-fs/g) ?? [])
check('인쇄 소스에 화면 토큰(--fs-*/text-form-*/data-fs)이 없다',
  leaked.length === 0, leaked.length ? `유출 ${leaked.length}건: ${[...new Set(leaked)].join(', ')}` : '')

// 인쇄 소스는 자체 폰트·크기를 쓴다 — 화면 스택을 물려받지 않는다는 구조적 증거
check('인쇄 소스가 자체 font-family를 선언한다 (화면 스택 비의존)',
  /font-family:\s*'Malgun Gothic'/.test(html), '')

check('인쇄 소스가 자체 font-size를 선언한다',
  /body\s*\{[^}]*font-size:\s*[\d.]+px/.test(html), '')

// ① 고정 해시 대조
check(`소스 HTML sha256이 고정값과 일치 (${sha.slice(0, 12)}…)`,
  sha === EXPECTED_SHA,
  sha === EXPECTED_SHA ? '' :
    `기대 ${EXPECTED_SHA}\n     실측 ${sha} (${html.length}자)\n` +
    `     서식을 의도적으로 고쳤다면 --print-hash로 갱신할 것. 고친 적이 없다면 화면 축이 새어든 것이다.`)

// 템플릿 파일 자체도 함께 본다 — 해시가 같아도 소스에 토큰이 들어와 있으면 다음 변경에서 샌다
for (const f of ['src/lib/fire-plan-template.ts', 'src/lib/doc-templates/base.ts']) {
  const src = readFileSync(f, 'utf8')
  check(`${f}가 화면 토큰을 참조하지 않는다`,
    !/--fs-\d|--fs-scale|text-form-/.test(src), '')
}

summary()
