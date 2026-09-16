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
import {
  parseParkingSummary, parseParkingByType, renderReport9, toggleParkingChip,
  parseParkingEv, isParkingChipOn, PK_EV_WORD, parkingUnmatchedForAnnex9, type ParkingChipFlag,
} from '../src/lib/doc-templates/report9.ts'
import { base9 } from './_fixtures-doc-templates.mts'
import { FIRE_PLAN_ANCHORS } from '../src/lib/fire-plan-anchors.ts'
import { readFileSync } from 'node:fs'

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
  /* 상자 셋 → **넷**(2026-09-16 전기차충전소 신설). 개수를 지우지 않고 갈아끼운다 —
   * 「3개」로 남겨 두면 다음 사람이 전기차 칸을 지우며 이 검사를 초록으로 되돌린다. */
  check('주차장 줄을 실제로 뽑았다(상자 4개가 다 들어 있다)',
    (row.match(/[■☐]/g) ?? []).length === 4, JSON.stringify(row.slice(0, 80)))
  check('옥외가 체크로 표시된다', /■\s*옥외/.test(row), JSON.stringify(row.slice(0, 60)))
  check('옥내는 빈 상자다(음성)', /[□☐]\s*옥내/.test(row))
  check('원문 대수가 보존된다', html.includes('옥외 자주식 8대'))

  const html0 = buildFirePlanHtml(base(''), [])
  const row0 = (html0.match(/주차장:[\s\S]*?<\/td>/) ?? [''])[0]
  check('값이 없으면 어느 상자도 안 켜진다', !/■/.test(row0), JSON.stringify(row0.slice(0, 60)))
}

console.log('\n[4] 엑셀 — 1.1 주차장 14행 자주식·기계식 네 칸 (2026-09-09)')
{
  const FIELDS = ['parking_in_self', 'parking_in_mech', 'parking_out_self', 'parking_out_mech'] as const
  const anchors = FIRE_PLAN_ANCHORS.filter(a => (FIELDS as readonly string[]).includes(a.field))
  check('네 칸이 앵커에 있다', anchors.length === 4, anchors.map(a => `${a.sheet}!${a.cell}`).join(' · '))
  check('좌표가 1.1의 14행이다', anchors.length === 4 && anchors.every(a => /14$/.test(a.cell) && a.sheet.startsWith('1.1')),
    anchors.map(a => a.cell).join(','))

  /* 규칙 — 여기가 이 축의 핵심이다. 「자주식 = 기계식이 아닌 것」으로 짜면 아래 3·4번이 깨진다. */
  const a1 = parseParkingByType('옥외 자주식 8대')
  check('「옥외 자주식 8대」→ 옥외 자주식 하나만', a1.outSelf && !a1.outMech && !a1.inSelf && !a1.inMech, JSON.stringify(a1))
  const a2 = parseParkingByType('옥내 기계식 4대, 옥외 자주식 8대')
  check('두 편이 섞이면 각 편만 켜진다(구간 분절)', a2.inMech && a2.outSelf && !a2.inSelf && !a2.outMech, JSON.stringify(a2))
  const a3 = parseParkingByType('옥외 8대')
  check('종류가 없으면 둘 다 안 켜진다(여집합 아님)', !a3.outSelf && !a3.outMech, JSON.stringify(a3))
  const a4 = parseParkingByType('기계식 8대')
  check('편을 모르면 어느 칸도 안 켠다(지어내지 않는다)', Object.values(a4).every(x => x === false), JSON.stringify(a4))
  const a5 = parseParkingByType('지하 기계식 20대')
  check('지하도 옥내로 친다(옥내 어휘 한 벌)', a5.inMech === true, JSON.stringify(a5))

  /* 값 축 — 규칙이 옳아도 셀에 안 닿으면 사용자에겐 없는 것이다(이 결함의 원래 모양) */
  const v = buildFirePlanValues(base('옥외 자주식 8대'))
  check('값 맵에 네 필드가 다 있다', FIELDS.every(f => v.has(f)))
  check('옥외 자주식 칸이 체크(■)된다', /■/.test(String(v.get('parking_out_self') ?? '')), JSON.stringify(String(v.get('parking_out_self') ?? '')))
  check('옥외 기계식은 미체크(음성)', !/■/.test(String(v.get('parking_out_mech') ?? '')))
  check('옥내 두 칸도 미체크(음성)', !/■/.test(String(v.get('parking_in_self') ?? '')) && !/■/.test(String(v.get('parking_in_mech') ?? '')))
  check('라벨 자구가 살아 있다(값이 라벨을 덮지 않는다)', /자주식/.test(String(v.get('parking_out_self') ?? '')))

  const v0 = buildFirePlanValues(base(''))
  check('빈 값이면 네 칸 다 미체크', FIELDS.every(f => !/■/.test(String(v0.get(f) ?? ''))))
}

/* ────────────────────────────────────────────────────────────────────────────
 * [6] 별지 9호 2쪽 — `옥내(지하 지상 필로티 기계식)` **괄호 구조**가 지켜지는가 (2026-09-11)
 *
 * 왜 생겼나: 사용자가 "옥내(…) 괄호 구조면 옥내를 먼저 켜야 하는 것 아니냐"고 물었고,
 *   실측해 보니 「옥외 기계식 2대」가 `[ ]옥내(… [√]기계식), [√]옥외`로 나가고 있었다.
 *   괄호 안이 켜졌는데 상위가 꺼진 모순이고, 무엇보다 **옥외 기계식이 옥내로 인쇄**됐다.
 *
 * 🚨 왜 안 잡혔나: 위 [1]·[4]가 **양성만** 물었다 — 「옥내 기계식」이 켜지는지는 봤는데
 *    「옥외 기계식」이 별지 9호에서 꺼지는지는 **한 번도 안 물었다**. 서식 1.1 축([4])에는
 *    그 음성 단언이 있었는데(`:127`) 별지 9호 축에는 없어 형제 검사가 눈멀었다.
 *    그래서 여기서는 **음성 대조와 렌더 결과**를 함께 건다.
 * ──────────────────────────────────────────────────────────────────────────── */
console.log('\n[6] 별지 9호 2쪽 — 옥내(…) 괄호 구조 (2026-09-11)')
{
  const INNER = ['pkInUg', 'pkInGround', 'pkInPiloti', 'pkMech'] as const
  /** 괄호 안이 켜졌는데 상위 옥내가 꺼져 있으면 서식이 모순되게 인쇄된다 */
  const contradicts = (s: string) => {
    const p = parseParkingSummary(s)
    return INNER.some(k => p[k]) && !p.pkIn
  }
  const CASES = ['옥외 기계식 2대', '기계식 4대', '옥외 자주식 8대', '옥상 3대', '옥외 지상 6대',
    '옥내 지상, 옥내 자주식 1대, 옥내 기계식 1대', '지하 10대', '필로티 2대', '지하 기계식 20대',
    '옥내 기계식 4대, 옥외 자주식 8대', '']
  check('어떤 입력도 괄호 모순을 만들지 않는다', CASES.every(s => !contradicts(s)),
    CASES.filter(contradicts).map(s => `"${s}"`).join(' · ') || '모순 0건')

  // 🚨 이 축의 핵심 음성 단언 — 이것 하나가 없어서 결함이 배포돼 있었다
  const out = parseParkingSummary('옥외 기계식 2대')
  check('「옥외 기계식」은 별지 9호 옥내·기계식을 켜지 않는다', out.pkMech === false, JSON.stringify(out))
  check('같은 값에서 옥외는 켜진다(양성 짝)', out.pkOut === true)
  check('그 정보는 서식 1.1 옥외 기계식이 받는다(유실 아님)', parseParkingByType('옥외 기계식 2대').outMech === true)

  const unknown = parseParkingSummary('기계식 4대')
  check('편을 모르는 「기계식」은 옥내로 단정하지 않는다(서식 1.1과 같은 규약)', unknown.pkMech === false, JSON.stringify(unknown))

  const inside = parseParkingSummary('옥내 기계식 4대, 옥외 자주식 8대')
  check('옥내 구간의 기계식은 켜진다(양성 짝 — 통째로 끈 게 아님)', inside.pkMech === true && inside.pkIn === true)
  check('지하 구간의 기계식도 옥내로 친다', parseParkingSummary('지하 기계식 20대').pkMech === true)

  /* 하위가 상위를 켜는가 — 사용자의 원래 물음("옥내를 또 눌러야 하나")에 대한 계약 */
  for (const [s, label] of [['지하 10대', '지하'], ['필로티 2대', '필로티'], ['옥내 지상 3대', '지상'], ['지하 기계식 20대', '지하 기계식']] as const)
    check(`「${label}」만 있어도 상위 옥내가 켜진다`, parseParkingSummary(s).pkIn === true, s)

  /* 렌더 축 — 플래그가 옳아도 표에 안 닿으면 사용자에겐 없는 것이다.
     별지 9호 **본문 문서를 통째로 렌더**하고 그 2쪽 주차장 줄을 뽑는다.
     픽스처는 저장소 표준 `base9`를 쓴다(여기서 Report9Data를 새로 지으면 사본이 된다). */
  const row = (pk: string) => {
    const html = renderReport9({ ...base9, ...parseParkingSummary(pk) } as unknown as Parameters<typeof renderReport9>[0])
    // ⚠ `옥내(`부터 자르면 **상위 옥내 상자를 놓친다**(6개만 잡혀 아래 7개 단언이 붉었다).
    //   이 축의 쟁점이 바로 그 상위 상자이니 `<th>주차장</th>`부터 셀이 닫힐 때까지 통째로 잡는다.
    return (html.match(/<th>주차장<\/th>[\s\S]*?<\/td>/) ?? [''])[0]
  }
  /* ⚠ 별지 9호의 상자 표기는 `doc-templates/base.ts:67` **`[√]` / `[&nbsp;&nbsp;]`**이다.
   *   엑셀·PDF 축(위 [2]·[3])의 `■/☐`를 그대로 가져다 쓰면 **제품이 옳은데 붉어진다**
   *   (실제로 처음에 그렇게 짜서 4건이 붉었다 — 계측기가 틀린 것이었다). */
  const ON = /\[√\]/, OFF = /\[&nbsp;&nbsp;\]/
  const rOut = row('옥외 기계식 2대')
  // 추출 성공부터 단언한다 — 빈손을 보고 초록이 되는 공허 통과를 막는다(옥내+하위4+옥상+옥외 = 7)
  check('주차장 줄을 실제로 뽑았다(상자 7개)', (rOut.match(/\[(?:√|&nbsp;&nbsp;)\]/g) ?? []).length === 7,
    JSON.stringify(rOut.replace(/<[^>]*>/g, '').slice(0, 120)))
  check('렌더: 옥외 기계식이면 괄호 안 기계식이 빈 상자다', new RegExp(OFF.source + '기계식').test(rOut),
    JSON.stringify(rOut.replace(/<[^>]*>/g, '').slice(0, 120)))
  check('렌더: 그래도 옥외는 체크된다', new RegExp(ON.source + '옥외').test(rOut),
    JSON.stringify(rOut.replace(/<[^>]*>/g, '').slice(0, 120)))
  const rIn = row('옥내 기계식 4대')
  check('렌더: 옥내 기계식이면 괄호 안 기계식이 체크된다(양성 짝)', new RegExp(ON.source + '기계식').test(rIn),
    JSON.stringify(rIn.replace(/<[^>]*>/g, '').slice(0, 120)))

  /* PDF 1.1 평면 목록 — 거기 「기계식」은 괄호 **밖**이라 편 무관 '있음'이 뜻이다.
     pkMech를 옥내로 좁히면서 이쪽까지 좁히면 옥외 기계식이 조용히 사라진다. */
  const htmlOut = buildFirePlanHtml(base('옥외 기계식 2대'), [])
  const flat = (htmlOut.match(/주차장:[\s\S]*?<\/td>/) ?? [''])[0]
  check('PDF 요약의 「기계식」은 옥외 기계식도 켠다(편 무관)', /■\s*기계식/.test(flat),
    JSON.stringify(flat.replace(/<[^>]*>/g, '').slice(0, 80)))
  const flat0 = (buildFirePlanHtml(base('옥외 자주식 8대'), [])
    .match(/주차장:[\s\S]*?<\/td>/) ?? [''])[0]
  check('PDF 요약: 기계식이 없으면 안 켜진다(음성 대조)', !/■\s*기계식/.test(flat0))
}

/* ────────────────────────────────────────────────────────────────────────────
 * [7] 건물 폼 주차장 칩 — 누르면 반드시 √가 뒤집히는가 (2026-09-11)
 *
 * 종전 토글은 켜짐 여부를 `cur.includes(word)`로 되물어 **칩의 √와 어긋났다**:
 *   · 「지하 10대」면 옥내 칩이 √인데 텍스트엔 '옥내'가 없어, 끄려고 눌러도 '옥내'가 **추가**됐다
 *   · 「옥외 기계식 2대」면 옥내·기계식 칩은 ☐인데 텍스트엔 '기계식'이 있어, 켜려고 누르면 **지워졌다**
 * ⚠ 여기 토글은 화면 코드의 사본이 아니라 **같은 export를 부르는 얇은 재현**이다
 *   (판정=parseParkingSummary, 옥내 어휘=PK_INDOOR_WORDS, 옥내 한정 제거=stripParkingWordIndoor).
 * ──────────────────────────────────────────────────────────────────────────── */
console.log('\n[7] 건물 폼 주차장 칩 토글 (2026-09-11)')
{
  /* ⚠ 재현본이 아니라 **화면이 부르는 그 함수**를 부른다. 종전엔 이 검사가 토글 로직을
   *   베껴 갖고 있었는데, 그러면 화면만 고쳐도 검사는 초록으로 남는다. */
  const toggle = toggleParkingChip
  // 별지 9호 축 일곱 + 서식 1.1 전용 `ev` — 화면 칩 목록과 같은 타입이어야 칩을 다 재생할 수 있다
  type Flag = ParkingChipFlag

  /* 🎯 사용자 물음(2026-09-11): 「옥내를 안 누르고 옥내·지하만 누르면 옥내가 자동으로 켜지나」
   *   — 화면에 그려지는 칩 목록을 **소스에서 읽어** 그 클릭 경로를 그대로 재생한다.
   *   칩 정의를 여기 베껴 적으면 라벨이 바뀔 때 엉뚱한 칩을 누르고도 초록이 된다. */
  /* 🚨 2026-09-16: 칩·대수칸이 `building-inline-panel`에서 **`facility-status-grid`로 옮겨 갔다**
   *   (서식 1.1 12~16행 배치를 그대로 쓰는 격자). 과녁만 옮기고 묻는 것은 그대로 둔다 —
   *   낡은 계약을 지우는 게 아니라 **갈아끼운다**. */
  const panel = readFileSync(new URL('../src/components/customers/facility-status-grid.tsx', import.meta.url), 'utf8')
  const chipBlock = (panel.match(/export const PARKING_CHIPS[\s\S]*?\n\]/) ?? [''])[0]
  /* 낱말은 문자열 리터럴이거나 **상수 식별자**다(전기차 칩은 `PK_EV_WORD` — 파서가 지우는 낱말과
   * 칩이 넣는 낱말이 갈라지지 않게 한 벌로 쓴다). 식별자면 여기서 실제 값으로 풀어 준다. */
  const WORD_CONSTS: Record<string, string> = { PK_EV_WORD }
  const CHIPS = [...chipBlock.matchAll(/\{ flag: '(\w+)', word: (?:'([^']+)'|(\w+)), label: '([^']+)', group: '(\w+)' \}/g)]
    .map(m => ({ flag: m[1] as Flag, word: m[2] ?? WORD_CONSTS[m[3]], label: m[4], group: m[5] }))
  // 추출 성공부터 단언한다 — 0개를 뽑고 `every`가 참이 되는 공허 통과를 막는다
  check('화면 칩 7개를 실제로 뽑았다(공허 통과 방지)', CHIPS.length === 7, CHIPS.map(c => c.label).join('/'))

  /* 🎯 **칩 수보다 강한 물음**: 별지 9호가 아는 주차 축이 화면에서 **하나도 빠지지 않았는가**.
   *   개수만 세면 칩 하나를 지우고 다른 걸 더해도 초록이다. 2026-09-16에 `옥내·기계식` 칩을
   *   없앴는데(대수칸과 같은 뜻을 두 벌로 받고 있었다) 그 축이 진짜로 사라지지 않았음을 여기서 문다 —
   *   대수칸도 화면의 입력구다(「옥내 기계식 3대」를 적으면 `pkMech`가 켜진다). */
  const countBlock = (panel.match(/export const PARKING_COUNTS[\s\S]*?\n\]/) ?? [''])[0]
  const COUNT_LABELS = [...countBlock.matchAll(/label: '([^']+)'/g)].map(m => m[1])
  check('대수칸 4개를 실제로 뽑았다(공허 통과 방지)', COUNT_LABELS.length === 4, COUNT_LABELS.join('/'))
  const ALL_FLAGS: Flag[] = ['pkIn', 'pkOut', 'pkInUg', 'pkInGround', 'pkInPiloti', 'pkMech', 'pkRoof', 'ev']
  for (const f of ALL_FLAGS) {
    const viaChip = CHIPS.find(c => c.flag === f)
    // 대수칸 경로 — 그 라벨로 「N대」를 적었을 때 이 축이 켜지는가(원문 합성은 격자가 하는 그 형식)
    const viaCount = COUNT_LABELS.some(l => isParkingChipOn(`${l} 3대`, f))
    check(`축 「${f}」을 화면에서 켤 수 있다`, !!viaChip || viaCount,
      viaChip ? `칩 「${viaChip.label}」` : viaCount ? '대수칸' : '경로 없음')
  }
  // 식별자 낱말이 `undefined`로 풀리면 아래 토글이 전부 무의미해진다 — 먼저 막는다
  check('칩 낱말이 하나도 빈 채로 남지 않았다', CHIPS.every(c => !!c.word), CHIPS.map(c => `${c.label}=${c.word}`).join(' · '))
  const chip = (label: string) => CHIPS.find(c => c.label === label)

  /* 🚨 칩이 들고 있는 **낱말**이 그 칩의 플래그를 실제로 뒤집는가 — 라벨·플래그가 맞아도 낱말만
   *   어긋나면 눌러도 아무 일이 없다. 종전엔 특정 라벨 몇 개만 골라 물어 이 구멍이 비어 있었다
   *   (2026-09-16 전기차 칩처럼 낱말을 상수로 들고 오면 드리프트가 조용해진다). 전수로 건다. */
  for (const c of CHIPS) {
    const on = toggle('', c.flag, c.word)
    check(`칩 「${c.label}」의 낱말이 그 칩을 켠다`, isParkingChipOn(on, c.flag), `"${c.word}" → "${on}"`)
  }

  /* 🚨 **배선 축** — 규칙이 옳고 이 검사가 그 규칙을 불러도, 화면이 안 부르면 사용자에겐 없는 것이다.
   *   변이 실험에서 「화면이 toggleParkingChip을 안 부름」 하나만 초록으로 살아남아 신설했다.
   *   ⚠ 주석을 걷어내고 잰다 — 설명 문구가 패턴에 걸려 거짓 초록/빨강이 되지 않게. */
  const ui = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  check('배선: 화면이 주차장 규칙 모듈을 import한다',
    /import \{[\s\S]*?toggleParkingChip[\s\S]*?\} from '@\/lib\/doc-templates\/report9'/.test(ui))
  check('배선: 칩 onClick이 그 함수까지 이어진다',
    /onClick=\{\(\) => onParking\(toggleParkingChip\(pkText, c\.flag, c\.word\)\)\}/.test(ui))
  /* 14행 네 칸의 켜짐이 **대수가 아니라 원문 낱말**에서 오는가 — 엑셀·PDF와 같은 함수여야 한다.
   * 대수로 켜면 「옥내 기계식」이라고만 적힌 값에서 화면만 꺼져 세 표면이 갈라진다. */
  check('배선: 14행 상자가 parseParkingByType을 본다',
    /const pkt = parseParkingByType\(pkText\)/.test(ui) && /on=\{pkt\[c\.type\]\}/.test(ui))
  // 규칙을 화면이 **다시 적지 않았는가** — 사본이 생기면 이 검사가 무는 것과 화면이 하는 것이 갈라진다
  check('화면이 토글 규칙을 재구현하지 않는다',
    !/PK_INDOOR_WORDS|stripParkingWordIndoor|PK_INDOOR_SUB_WORDS/.test(ui))
  // 주석 제거가 통째로 지워 위 단언들이 공허 통과하는 것을 막는다
  check('주석 제거 후에도 화면 소스가 살아 있다(공허 통과 방지)',
    ui.length > panel.length * 0.4 && ui.includes('PARKING_CHIPS'), `${ui.length}/${panel.length}`)

  /* 🚨 `옥내·기계식`은 이제 칩이 아니라 대수칸이다 — 그래도 **상위 옥내가 함께 켜지는가**는
   *   그대로 물어야 한다(대수칸이 합성하는 원문 형식으로 건다). 칩 셋은 아래 루프가 이어 문다. */
  {
    const to = '옥내 기계식 3대'
    check('「옥내 기계식」 대수칸이 상위 옥내를 함께 켠다',
      parseParkingSummary(to).pkIn === true && isParkingChipOn(to, 'pkMech'), `"${to}"`)
  }
  for (const label of ['옥내·지하', '옥내·지상', '옥내·필로티']) {
    const c = chip(label)
    if (!c) { check(`칩 「${label}」이 화면에 있다`, false); continue }
    // 시작 상태 셋 — 빈 값 / 옥외 문맥 / 옥내와 무관한 문맥. 어디서 눌러도 옥내가 따라와야 한다.
    const froms = ['', '옥외 자주식 8대', '옥상 3대']
    const rows = froms.map(f => ({ f, to: toggle(f, c.flag, c.word) }))
    check(`「${label}」을 **한 번만** 눌러도 상위 옥내가 함께 켜진다`,
      rows.every(r => parseParkingSummary(r.to).pkIn === true && isParkingChipOn(r.to, c.flag)),
      rows.map(r => `"${r.f || '(빈값)'}"→"${r.to}"`).join(' · '))
  }
  // 반대 방향 — 상위를 켜도 하위는 승계하지 않는다(모르는 것을 인쇄하지 않는다)
  const inOnly = toggle('', 'pkIn', '옥내')
  const io = parseParkingSummary(inOnly)
  check('「옥내」만 누르면 하위 넷은 꺼진 채다(자동 승계 없음)',
    io.pkIn === true && !io.pkInUg && !io.pkInGround && !io.pkInPiloti && !io.pkMech, `"${inOnly}"`)

  const CASES: Array<[string, Flag, string, string]> = [
    ['지하 10대', 'pkIn', '옥내', '하위가 켠 옥내 칩도 꺼진다'],
    ['필로티 2대', 'pkIn', '옥내', '필로티가 켠 옥내 칩도 꺼진다'],
    ['옥외 기계식 2대', 'pkMech', '기계식', '옥외 기계식만 있을 때 옥내·기계식을 켤 수 있다'],
    ['옥외 자주식 8대', 'pkMech', '기계식', '옥외 구간 뒤에 붙여도 옥내가 켜진다'],
    ['옥내 기계식 1대', 'pkMech', '기계식', '옥내·기계식을 끌 수 있다'],
    ['옥외 자주식 8대', 'pkInGround', '지상', '옥외 문맥에서도 옥내·지상이 켜진다'],
    ['옥내 자주식 5대', 'pkInUg', '지하', '지하를 덧붙일 수 있다'],
    ['', 'pkOut', '옥외', '빈 값에서 옥외를 켤 수 있다'],
    ['옥상 3대', 'pkRoof', '옥상', '옥상을 끌 수 있다'],
  ]
  for (const [cur, flag, word, label] of CASES) {
    const before = isParkingChipOn(cur, flag)
    const next = toggle(cur, flag, word)
    const after = isParkingChipOn(next, flag)
    check(label, before !== after, `"${cur || '(빈값)'}" → "${next}" (${before ? '√' : '☐'}→${after ? '√' : '☐'})`)
  }
  // 🚨 부수 피해 — 옥내·기계식을 끄면서 옥외 기계식(서식 1.1 AJ14)까지 죽이면 안 된다
  const both = '옥내 기계식 1대, 옥외 기계식 2대'
  const offed = toggle(both, 'pkMech', '기계식')
  check('옥내·기계식을 꺼도 옥외 기계식은 살아 있다', parseParkingByType(offed).outMech === true, `"${offed}"`)
  check('그러면서 옥내 기계식은 실제로 꺼진다(양성 짝)', parseParkingByType(offed).inMech === false, `"${offed}"`)
}

/* ────────────────────────────────────────────────────────────────────────────
 * [8] 전기차충전소 — 서식 1.1 `AS13` (2026-09-16 신설)
 *
 * 법정 양식이 **주차장 13행 안**에 둔 셋째 칸이라(`L13 옥내`·`AB13 옥외`·`AS13 전기차충전소`)
 * 원천도 `parking_summary` 한 문자열을 쓴다. 여태 「ERP에 축이 없다」며 비워 두던 칸이다.
 *
 * 🚨 **이 절의 핵심은 양성이 아니라 누출 음성이다.** 한 칸을 두 사실이 나눠 쓰므로,
 *   새 낱말이 별지 9호 상자나 14행 네 칸을 건드리면 **다른 서식이 조용히 틀린다**.
 *   「부분문자열이 안 겹치니 괜찮다」는 추론이지 증거가 아니다 — 여기서 값으로 못박는다.
 * ──────────────────────────────────────────────────────────────────────────── */
console.log('\n[8] 전기차충전소 — 1.1 AS13 (2026-09-16)')
{
  // ── 규칙 ──
  check('「…, 전기차충전소」→ 켜짐', parseParkingEv('옥외 8대, 전기차충전소') === true)
  check('「전기차 충전기 2기」도 켜진다(표기 흔들림 허용)', parseParkingEv('전기차 충전기 2기') === true)
  check('주차장만 있으면 꺼짐(음성)', parseParkingEv('옥내 지하 10대, 옥외 자주식 8대') === false)
  check('빈 값이면 꺼짐', parseParkingEv('') === false)
  /* 🚨 `/g` 리터럴을 모듈에 두고 `.test()`를 부르면 `lastIndex`가 남아 같은 입력에 참·거짓이
   *   번갈아 나온다. 두 번 물어 같은 답이 오는지 확인한다(이 부류는 한 번만 물으면 안 보인다). */
  check('같은 입력을 두 번 물어도 답이 같다(lastIndex 오염 없음)',
    parseParkingEv('전기차충전소') === true && parseParkingEv('전기차충전소') === true)

  // ── 🚨 누출 금지 — 이 검사의 핵심 ──
  const only = '전기차충전소'
  const leak9 = parseParkingSummary(only)
  check('별지 9호 일곱 상자가 하나도 안 켜진다', Object.values(leak9).every(v => v === false), JSON.stringify(leak9))
  const leak14 = parseParkingByType(only)
  check('서식 1.1 14행 네 칸도 안 켜진다', Object.values(leak14).every(v => v === false), JSON.stringify(leak14))
  const vOnly = buildFirePlanValues(base(only))
  check('엑셀: 13행 옥내·옥외도 안 켜진다',
    !/■/.test(String(vOnly.get('parking_indoor') ?? '')) && !/■/.test(String(vOnly.get('parking_outdoor') ?? '')))
  check('엑셀: 그러면서 전기차 칸은 켜진다(양성 짝 — 통째로 꺼진 게 아님)',
    /■/.test(String(vOnly.get('parking_ev') ?? '')), JSON.stringify(String(vOnly.get('parking_ev') ?? '')))
  /* 렌더까지 본다 — 플래그가 옳아도 표에 닿으면 사용자에겐 그게 진실이다.
     별지 9호 2쪽 주차장 줄에 체크가 하나라도 생기면 없는 주차장을 인쇄하는 것이다. */
  const r9 = (() => {
    const html = renderReport9({ ...base9, ...parseParkingSummary(only) } as unknown as Parameters<typeof renderReport9>[0])
    return (html.match(/<th>주차장<\/th>[\s\S]*?<\/td>/) ?? [''])[0]
  })()
  check('별지 9호 렌더: 상자 7개를 실제로 뽑았다(공허 통과 방지)',
    (r9.match(/\[(?:√|&nbsp;&nbsp;)\]/g) ?? []).length === 7)
  check('별지 9호 렌더: √가 한 개도 없다', !/\[√\]/.test(r9), JSON.stringify(r9.replace(/<[^>]*>/g, '').slice(0, 100)))

  // ── 엑셀 앵커·값 ──
  const a = FIRE_PLAN_ANCHORS.filter(x => x.field === 'parking_ev')
  check('앵커가 한 칸이다', a.length === 1, a.map(x => `${x.sheet}!${x.cell}`).join(' · '))
  check('좌표가 1.1의 AS13이다', a.length === 1 && a[0].cell === 'AS13' && a[0].sheet.startsWith('1.1'))

  const vOn = buildFirePlanValues(base('옥외 자주식 8대, 전기차충전소'))
  const evCell = String(vOn.get('parking_ev') ?? '')
  check('값 맵에 필드가 있다', vOn.has('parking_ev'))
  check('체크(■)된다', /■/.test(evCell), JSON.stringify(evCell))
  check('라벨 자구가 살아 있다', /전기차충전소/.test(evCell))
  /* 🚨 라벨 뒤에 법정 지시문(`[서식1.6.3] 작성`)이 붙어 있다 — `boxLabelCell`이 첫 상자만 갈고
   *   뒤 자구를 보존한다는 실증이다. 지워지면 서식이 훼손된다. */
  check('상자 뒤 법정 지시문이 지워지지 않는다', /\[서식1\.6\.3\]/.test(evCell), JSON.stringify(evCell))
  check('같은 값에서 옥외도 켜진다(형제 축 무손상)', /■/.test(String(vOn.get('parking_outdoor') ?? '')))

  const vOff = buildFirePlanValues(base('옥외 자주식 8대'))
  check('전기차가 없으면 안 켜진다(음성 대조)', !/■/.test(String(vOff.get('parking_ev') ?? '')))
  check('빈 값이면 안 켜진다', !/■/.test(String(buildFirePlanValues(base('')).get('parking_ev') ?? '')))

  // ── PDF — 엑셀과 같은 줄에 같은 판정으로 찍히는가(D-7 항등) ──
  const pdfRow = (pk: string) => (buildFirePlanHtml(base(pk), []).match(/주차장:[\s\S]*?<\/td>/) ?? [''])[0]
  const rOn = pdfRow('옥외 자주식 8대, 전기차충전소')
  check('PDF: 전기차충전소가 체크로 표시된다', /■\s*전기차충전소/.test(rOn),
    JSON.stringify(rOn.replace(/<[^>]*>/g, '').slice(0, 100)))
  check('PDF: 없으면 빈 상자다(음성 짝)', /[□☐]\s*전기차충전소/.test(pdfRow('옥외 자주식 8대')))
  /* 🚨 엑셀만 켜지고 PDF는 안 켜지는 비대칭을 막는다 — 종전엔 원문 병기 괄호 안에만 낱말이 비쳐
   *   「인쇄된 것처럼 보이지만 상자는 꺼진」 상태가 될 수 있었다. 두 표면을 **함께** 단언한다. */
  check('D-7: 엑셀과 PDF가 같은 방향이다(켜짐)', /■/.test(String(vOn.get('parking_ev') ?? '')) && /■\s*전기차충전소/.test(rOn))
  check('D-7: 엑셀과 PDF가 같은 방향이다(꺼짐)',
    !/■/.test(String(vOff.get('parking_ev') ?? '')) && !/■\s*전기차충전소/.test(pdfRow('옥외 자주식 8대')))

  // ── 칩 토글 ──
  const on1 = toggleParkingChip('', 'ev', PK_EV_WORD)
  check('빈 값에서 칩을 켜면 낱말이 들어간다', isParkingChipOn(on1, 'ev'), `"${on1}"`)
  check('그때 별지 9호 상자는 하나도 안 켜진다(누출 음성)',
    Object.values(parseParkingSummary(on1)).every(v => v === false), `"${on1}"`)
  const off1 = toggleParkingChip(on1, 'ev', PK_EV_WORD)
  check('다시 누르면 꺼진다', !isParkingChipOn(off1, 'ev'), `"${off1}"`)
  /* 🚨 판정과 지우기가 **같은 패턴**을 봐야 한다 — 판정만 넓게(「충전기」) 잡고 지울 땐
   *   `'전기차충전소'`만 지우면 눌러도 안 꺼지는 칩이 된다(2026-09-11 「지하 10대」와 같은 부류). */
  const typed = '옥외 8대, 전기차 충전기 2기'
  const offTyped = toggleParkingChip(typed, 'ev', PK_EV_WORD)
  check('손으로 「전기차 충전기」라 적어도 칩으로 끌 수 있다', !isParkingChipOn(offTyped, 'ev'), `"${offTyped}"`)
  check('끄면서 옥외는 살아 있다(부수 피해 없음)', parseParkingSummary(offTyped).pkOut === true, `"${offTyped}"`)

  /* ── 🚨 거짓 경보 금지 — 조립기의 「채웠는데 반영이 안 됨」 경보 ──
   * 별지 9호 조립기는 `parking_summary`가 채워졌는데 일곱 상자가 하나도 안 켜지면 경고를 단다.
   * 전기차충전소는 **별지 9호에 칸이 없으므로** 그 낱말만 든 값은 「미반영」이 아니라 정상이다.
   * 걷어내지 않으면 전기차 칩만 누른 문서마다 없는 결함을 신고하게 된다(경고가 소음이 되면
   * 진짜 한 건이 그 속에 묻힌다 — 조립기 §B-6 후속의 판단). 이 경보는 검사가 0건이었다. */
  check('전기차만 켠 값은 미반영 경고를 내지 않는다', parkingUnmatchedForAnnex9('전기차충전소') === '',
    JSON.stringify(parkingUnmatchedForAnnex9('전기차충전소')))
  check('주차장과 함께 켠 값도 경고하지 않는다', parkingUnmatchedForAnnex9('옥외 자주식 8대, 전기차충전소') === '')
  check('미입력은 경고하지 않는다(부재는 결함이 아니다)', parkingUnmatchedForAnnex9('') === '')
  check('알아듣는 주차장 값도 경고하지 않는다', parkingUnmatchedForAnnex9('옥내 지하 10대') === '')
  // 양성 짝 — 경보 자체가 죽으면 원래 잡던 무증상 결함을 놓친다
  check('정말 못 알아듣는 값은 여전히 경고한다', parkingUnmatchedForAnnex9('주차 가능') === '주차 가능')
  check('전기차 낱말을 뺀 나머지가 못 알아들으면 그 나머지를 알린다',
    parkingUnmatchedForAnnex9('전기차충전소, 주차 가능') === '주차 가능', `"${parkingUnmatchedForAnnex9('전기차충전소, 주차 가능')}"`)
  /* 배선 축 — 술어가 옳아도 조립기가 안 부르면 경보는 옛 규칙 그대로다 */
  const asm = readFileSync(new URL('../src/lib/report9-assemble.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  check('배선: 조립기가 그 술어를 부른다', /parkingUnmatchedForAnnex9\(pk\)/.test(asm))
  check('배선: 조립기가 옛 술어를 들고 있지 않다(두 벌 금지)', !/pk\.trim\(\)\s*&&\s*!data\.pkIn/.test(asm))
  check('배선: 주석 제거 후에도 조립기 소스가 살아 있다(공허 통과 방지)', asm.includes('assembleReport9'))

  /* ── 화면 — 안내 문구가 거짓이 되지 않았는가 ──
   * 칩 무리 아래 안내는 「색칠된 칩 = 별지 9호 2쪽에 √로 인쇄」라고 적혀 있었다. 전기차 칩은
   * 별지 9호에 칸이 **없으므로**, 문구를 안 고치면 화면이 거짓말을 한다(설명과 동작은 함께 움직인다). */
  const panelSrc = readFileSync(new URL('../src/components/customers/facility-status-grid.tsx', import.meta.url), 'utf8')
  const flat = panelSrc.replace(/\s+/g, ' ')
  check('화면 안내가 전기차 칩의 인쇄처를 따로 밝힌다',
    /전기차충전소.{0,80}별지 9호.{0,20}없/.test(flat),
    JSON.stringify((flat.match(/전기차충전소[^<]{0,120}/) ?? [''])[0]))
  /* 접이 안으로 들어간 무리도 인쇄처를 말해야 한다 — 「서식 1.1에 칸이 없다」가 접는 이유였다 */
  check('별지 9호 전용 무리가 자기 인쇄처를 밝힌다', /별지 9호 2쪽[^<]{0,60}에만/.test(flat))
}

console.log(`\n=== pass ${pass} / fail ${fail} ===`)
process.exit(fail === 0 ? 0 : 1)
