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
  check('주차장 줄을 실제로 뽑았다(상자 3개가 다 들어 있다)',
    (row.match(/[■☐]/g) ?? []).length === 3, JSON.stringify(row.slice(0, 80)))
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
  type Flag = keyof ReturnType<typeof parseParkingSummary>

  /* 🎯 사용자 물음(2026-09-11): 「옥내를 안 누르고 옥내·지하만 누르면 옥내가 자동으로 켜지나」
   *   — 화면에 그려지는 칩 목록을 **소스에서 읽어** 그 클릭 경로를 그대로 재생한다.
   *   칩 정의를 여기 베껴 적으면 라벨이 바뀔 때 엉뚱한 칩을 누르고도 초록이 된다. */
  const panel = readFileSync(new URL('../src/components/customers/building-inline-panel.tsx', import.meta.url), 'utf8')
  const chipBlock = (panel.match(/const PARKING_CHIPS[\s\S]*?\n\]/) ?? [''])[0]
  const CHIPS = [...chipBlock.matchAll(/\{ flag: '(\w+)', word: '([^']+)', label: '([^']+)' \}/g)]
    .map(m => ({ flag: m[1] as Flag, word: m[2], label: m[3] }))
  // 추출 성공부터 단언한다 — 0개를 뽑고 `every`가 참이 되는 공허 통과를 막는다
  check('화면 칩 7개를 실제로 뽑았다(공허 통과 방지)', CHIPS.length === 7, CHIPS.map(c => c.label).join('/'))
  const chip = (label: string) => CHIPS.find(c => c.label === label)

  /* 🚨 **배선 축** — 규칙이 옳고 이 검사가 그 규칙을 불러도, 화면이 안 부르면 사용자에겐 없는 것이다.
   *   변이 실험에서 「화면이 toggleParkingChip을 안 부름」 하나만 초록으로 살아남아 신설했다.
   *   ⚠ 주석을 걷어내고 잰다 — 설명 문구가 패턴에 걸려 거짓 초록/빨강이 되지 않게. */
  const ui = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  check('배선: 화면이 주차장 규칙 모듈을 import한다', /import \{[^}]*toggleParkingChip[^}]*\} from '@\/lib\/doc-templates\/report9'/.test(ui))
  check('배선: 칩 onClick이 그 함수까지 이어진다',
    /onClick=\{\(\) => onParkingChip\(c\)\}/.test(ui)
    && /function onParkingChip[\s\S]{0,240}?toggleParkingChip\(form\.parking_summary, chip\.flag, chip\.word\)/.test(ui))
  // 규칙을 화면이 **다시 적지 않았는가** — 사본이 생기면 이 검사가 무는 것과 화면이 하는 것이 갈라진다
  check('화면이 토글 규칙을 재구현하지 않는다',
    !/PK_INDOOR_WORDS|stripParkingWordIndoor|PK_INDOOR_SUB_WORDS/.test(ui))
  // 주석 제거가 통째로 지워 위 단언들이 공허 통과하는 것을 막는다
  check('주석 제거 후에도 화면 소스가 살아 있다(공허 통과 방지)',
    ui.length > panel.length * 0.5 && ui.includes('PARKING_CHIPS'), `${ui.length}/${panel.length}`)

  for (const label of ['옥내·지하', '옥내·지상', '옥내·필로티', '옥내·기계식']) {
    const c = chip(label)
    if (!c) { check(`칩 「${label}」이 화면에 있다`, false); continue }
    // 시작 상태 셋 — 빈 값 / 옥외 문맥 / 옥내와 무관한 문맥. 어디서 눌러도 옥내가 따라와야 한다.
    const froms = ['', '옥외 자주식 8대', '옥상 3대']
    const rows = froms.map(f => ({ f, to: toggle(f, c.flag, c.word) }))
    check(`「${label}」을 **한 번만** 눌러도 상위 옥내가 함께 켜진다`,
      rows.every(r => { const q = parseParkingSummary(r.to); return q.pkIn === true && q[c.flag] === true }),
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
    const before = !!parseParkingSummary(cur)[flag]
    const next = toggle(cur, flag, word)
    const after = !!parseParkingSummary(next)[flag]
    check(label, before !== after, `"${cur || '(빈값)'}" → "${next}" (${before ? '√' : '☐'}→${after ? '√' : '☐'})`)
  }
  // 🚨 부수 피해 — 옥내·기계식을 끄면서 옥외 기계식(서식 1.1 AJ14)까지 죽이면 안 된다
  const both = '옥내 기계식 1대, 옥외 기계식 2대'
  const offed = toggle(both, 'pkMech', '기계식')
  check('옥내·기계식을 꺼도 옥외 기계식은 살아 있다', parseParkingByType(offed).outMech === true, `"${offed}"`)
  check('그러면서 옥내 기계식은 실제로 꺼진다(양성 짝)', parseParkingByType(offed).inMech === false, `"${offed}"`)
}

console.log(`\n=== pass ${pass} / fail ${fail} ===`)
process.exit(fail === 0 ? 0 : 1)
