/** 빈칸 보고 검사 — `src/lib/fire-plan-blanks.ts`.
 *
 *  이 모듈이 답하는 것: **「엑셀을 받으면 어디가 비나, 그리고 그게 누구 할 일인가」**.
 *
 *  🚨 가장 중요한 단언은 [2]다 — `unwired`(ERP가 못 채움)와 `empty`(값이 없음)가 **절대 섞이면
 *    안 된다**. 섞이면 사용자가 채울 수 없는 칸을 채우려 든다. 양성·음성 **짝으로** 묻는다.
 *
 *  [1]은 래칫이다. 분모(값 슬롯·상자)와 배선 수를 못 박아, 배선이 늘면 「기대치를 올려라」로
 *  붉어지고 **줄면 그 자리에서 잡힌다**.
 *
 *  실행: npx tsx --conditions=react-server scripts/test-fire-plan-blanks.mts
 */
import { FIRE_PLAN_MANIFEST, sheetManifest } from '../src/lib/fire-plan-xlsx-manifest.ts'
import { FIRE_PLAN_ANCHORS } from '../src/lib/fire-plan-anchors.ts'
import { blankReport, sheetBlankReport } from '../src/lib/fire-plan-blanks.ts'

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`) }
}

const SHEETS = FIRE_PLAN_MANIFEST.sheets.map(s => s.name)
const all = await blankReport(SHEETS, null)   // filled=null → 배선 축만(고객 무관)

/* ══════════════════════ [0] 눈멂 가드 ══════════════════════ */
console.log('\n[0] 눈멂 가드 — 분모')
check('50시트를 전부 돌았다', all.length === 50, `${all.length}장`)
check('슬롯이 0이 아니다', all.reduce((n, r) => n + r.slots, 0) > 0)
check('빈칸 목록이 0건이 아니다', all.reduce((n, r) => n + r.blanks.length, 0) > 0)

/* ══════════════════════ [1] 분모·배선 래칫 ══════════════════════ */
console.log('\n[1] 분모와 배선 수 (래칫)')
const slots = all.reduce((n, r) => n + r.slots, 0)
const wired = all.reduce((n, r) => n + r.wired, 0)
const boxes = all.reduce((n, r) => n + r.boxes, 0)
const wiredBoxes = all.reduce((n, r) => n + r.wiredBoxes, 0)
// 실측 기준선(2026-09-16). 배선하면 wired가 늘고, 그때 이 숫자를 **올린다**.
// ⭐ 실제로 한 번 올렸다: 리베이스로 「서식 1.1 전기차충전소 배선」이 착지하자 상자가 77→78,
//   앵커가 221→222가 됐다. 회계 단언(78+13+131=222)이 **자동으로 따라 맞은** 것이 규칙이
//   옳다는 방증이다 — 손으로 맞춘 게 아니라 분류가 제자리를 찾았다.
check('값 슬롯 1,812칸', slots === 1812, `${slots}칸`)
check('상자 658칸', boxes === 658, `${boxes}칸`)
check('배선된 값 슬롯 ≥ 423', wired >= 423, `${wired}칸 (${(wired / slots * 100).toFixed(1)}%)`)
check('배선된 상자 ≥ 216', wiredBoxes >= 216, `${wiredBoxes}칸 (${(wiredBoxes / boxes * 100).toFixed(1)}%)`)
// 🚨 **회계가 딱 맞아야 한다.** 앵커는 셋 중 하나에 앉는다 — 상자칸 · 라벨칸(단위·접두라벨 갈래) ·
//   순수 빈칸. 합이 안 맞으면 분류 규칙 어딘가가 틀린 것이다(1칸이라도 반올림으로 넘기지 않는다).
const box = FIRE_PLAN_ANCHORS.filter(a => sheetManifest(a.sheet).boxes[a.cell]).length
const lbl = FIRE_PLAN_ANCHORS.filter(a => !sheetManifest(a.sheet).boxes[a.cell] && sheetManifest(a.sheet).labels[a.cell]).length
const plain = FIRE_PLAN_ANCHORS.length - box - lbl
check('앵커 회계가 맞는다 (상자+라벨+순수빈칸 = 총수)', box + lbl + plain === FIRE_PLAN_ANCHORS.length,
  `${box}+${lbl}+${plain} = ${FIRE_PLAN_ANCHORS.length}`)
check('상자 배선 수 == 상자칸에 앉는 앵커 수', wiredBoxes === box, `${wiredBoxes} vs ${box}`)
// 🚨 **조용한 예외를 만들지 않는다.** 순수 빈칸 앵커 중 슬롯 집합 **밖**에 있는 것이 딱 하나 있다 —
//   `표지!A3`(문서 제목: 테두리 없는 머리띠 행이라 「사람이 적는 칸」이 아니다). 규칙이 옳게 뺀 것이지만,
//   슬롯 밖 앵커는 값이 비어도 빈칸 보고에 **안 나온다**. 그래서 수를 못 박는다 — 늘면 붉어지고
//   누군가 「이 앵커도 보고에서 빠져도 되나」를 판단하게 된다.
check('슬롯 밖 앵커는 1칸뿐 (표지 제목)', plain - wired === 1, `순수빈칸 ${plain} − 슬롯배선 ${wired} = ${plain - wired}`)

/* ══════════════════════ [2] 🚨 두 빈칸이 섞이지 않는가 (양성·음성 짝) ══════════════════════ */
console.log('\n[2] unwired(우리 할 일) ↔ empty(사용자 할 일) 분리')
const anchoredRef = new Set(FIRE_PLAN_ANCHORS.map(a => `${a.sheet}!${a.cell}`))
let mixUnwired = 0, mixEmpty = 0, nUnwired = 0, nEmpty = 0
for (const r of all) {
  for (const b of r.blanks) {
    const isAnchored = anchoredRef.has(`${b.sheet}!${b.ref}`)
    if (b.kind === 'unwired') { nUnwired++; if (isAnchored) mixUnwired++ }
    else { nEmpty++; if (!isAnchored) mixEmpty++ }
  }
}
check('음성 — 앵커가 있는 칸은 절대 unwired가 아니다', mixUnwired === 0, `${mixUnwired}건 위반`)
check('음성 — 앵커가 없는 칸은 절대 empty가 아니다', mixEmpty === 0, `${mixEmpty}건 위반`)
check('unwired가 실제로 잡혔다(양성)', nUnwired > 0, `${nUnwired}칸`)
// filled=null이면 고객 축을 안 보므로 empty는 0이어야 한다 — 정적 보고의 계약
check('filled=null이면 empty는 0 (정적 보고 계약)', nEmpty === 0, `${nEmpty}칸`)

/* ══════════════════════ [3] 고객 축 — 값이 있으면 empty가 사라지는가 ══════════════════════ */
console.log('\n[3] 고객 축 (filled 집합)')
const someFields = new Set(FIRE_PLAN_ANCHORS.slice(0, 40).map(a => a.field))
const withFilled = await blankReport(SHEETS, someFields)
const e1 = withFilled.reduce((n, r) => n + r.blanks.filter(b => b.kind === 'empty').length, 0)
check('filled을 주면 empty가 생긴다(양성)', e1 > 0, `${e1}칸`)
const allFields = new Set(FIRE_PLAN_ANCHORS.map(a => a.field))
const withAll = await blankReport(SHEETS, allFields)
const e2 = withAll.reduce((n, r) => n + r.blanks.filter(b => b.kind === 'empty').length, 0)
check('전 필드를 채우면 empty가 0 (음성)', e2 === 0, `${e2}칸`)
// unwired는 고객 축과 무관하다 — filled를 뭘 주든 안 변해야 한다
const u0 = all.reduce((n, r) => n + r.blanks.filter(b => b.kind === 'unwired').length, 0)
const u2 = withAll.reduce((n, r) => n + r.blanks.filter(b => b.kind === 'unwired').length, 0)
check('unwired는 고객 값과 무관하다', u0 === u2, `${u0} vs ${u2}`)

/* ══════════════════════ [4] 분모가 부풀지 않았는가 ══════════════════════
 *  🚨 라벨·상자·배너를 슬롯에 넣으면 분모가 1,500칸 넘게 부풀어 **영원히 못 채운다**.
 *    첫 안(「테두리만 본다」)이 1.1에서 1,620칸 전부를 슬롯으로 만들었다. */
console.log('\n[4] 분모에 라벨·상자·배너가 안 섞였는가')
const f11 = all.find(r => r.sheet === '1.1 건축물 일반현황')!
check('1.1 슬롯이 전 칸(1,620)이 아니다', f11.slots < 1620, `${f11.slots}칸`)
check('1.1 슬롯이 0도 아니다', f11.slots > 0, `${f11.slots}칸`)
const man11 = FIRE_PLAN_MANIFEST.sheets.find(s => s.name === '1.1 건축물 일반현황')!
const labelRefs = new Set(Object.keys(man11.labels))
const boxRefs = new Set(Object.keys(man11.boxes))
const r11 = await sheetBlankReport('1.1 건축물 일반현황', null)
check('1.1 빈칸에 라벨 칸이 없다', r11.blanks.every(b => !labelRefs.has(b.ref)))
check('1.1 빈칸에 상자 칸이 없다', r11.blanks.every(b => !boxRefs.has(b.ref)))
check('1.1 빈칸에 머리띠 행이 없다',
  r11.blanks.every(b => !man11.bannerRows.includes(Number(/\d+/.exec(b.ref)![0]) - 1)))

/* ══════════════════════ [5] 사람이 알아볼 단서가 붙는가 ══════════════════════
 *  좌표('AH23')만 주면 아무도 어느 칸인지 모른다. 이웃 라벨이 그 유일한 단서다. */
console.log('\n[5] 빈칸에 이웃 라벨이 붙는가')
const flat = all.flatMap(r => r.blanks)
const withNear = flat.filter(b => b.near.length > 0)
check('이웃 라벨이 붙은 비율 ≥ 80%', withNear.length / flat.length >= 0.8,
  `${withNear.length}/${flat.length} (${(withNear.length / flat.length * 100).toFixed(1)}%)`)
console.log('   예시:', flat.slice(0, 3).map(b => `${b.sheet}!${b.ref}「${b.near}」`).join(' · '))
// 🚨 **「붙었는가」가 아니라 「맞는가」를 묻는다.** 비율만 보던 판은 라벨 색인의 행/열을 뒤집어도
//   두 번째 패스가 아무 라벨이나 찾아 붙여서 80%를 넘겼다(변이 M9가 그렇게 뚫었다).
//   실제 표의 열 머리글을 **구체적으로** 박는다.
//   🚨 그리고 **두 경로를 다 태워야 한다**. 처음엔 기대값 셋이 전부 A열이라 첫 패스(같은 행
//   왼쪽 라벨)를 한 번도 안 탔고, 그래서 뒤집어도 두 번째 패스가 같은 답을 내 M9가 또 살았다.
const EXPECT: Array<[string, string, string]> = [
  // ── 둘째 패스(같은 열 위쪽 머리글)로 결정되는 칸 ──
  ['1.2.1 구역별 세부현황', 'A10', '동'],
  ['1.7.1 소방안전관리자 선임현황', 'A10', '소방안전관리자'],
  // ── 첫째 패스(같은 행 왼쪽 라벨)로 결정되는 칸 — 왼쪽에 라벨이 **넷**이라 가장 가까운 것을
  //    골라야만 맞는다. 행/열을 뒤집거나 거리 비교를 깨면 반드시 달라진다.
  ['1.6.1 기타시설 일반현황', 'AI20', '위치'],
  ['1.5.1 피난·방화시설 현황', 'AE19', '□ 거실 제연'],
]
for (const [sheet, ref, want] of EXPECT) {
  const got = all.find(r => r.sheet === sheet)?.blanks.find(b => b.ref === ref)?.near
  check(`${sheet}!${ref}의 이웃 라벨이 '${want}'`, got === want, `실제 '${got}'`)
}

/* ══════════════════════ [6] 우리 할 일이 먼저 보이는가 ══════════════════════ */
console.log('\n[6] 정렬 — unwired가 앞')
const mixed = withFilled.find(r => r.blanks.some(b => b.kind === 'unwired') && r.blanks.some(b => b.kind === 'empty'))
if (mixed) {
  const firstEmpty = mixed.blanks.findIndex(b => b.kind === 'empty')
  const lastUnwired = mixed.blanks.map(b => b.kind).lastIndexOf('unwired')
  check(`'${mixed.sheet}'에서 unwired가 empty보다 앞`, lastUnwired < firstEmpty,
    `unwired 마지막 ${lastUnwired} < empty 첫 ${firstEmpty}`)
} else {
  check('섞인 시트 표본이 있다(없으면 이 단언이 공허)', false, '표본 없음')
}

/* ══════════════════════ [7] 적색 시트 목록 래칫 ══════════════════════
 *  🚨 **수(37)만 박으면 한 장을 배선하고 다른 한 장이 퇴행해도 초록이다.** 이름 집합으로 박는다.
 *    줄면 「기대 목록을 갱신하라」로 붉어지고, **늘면 그 장의 이름이 나온다.**
 *  왜 「== 0」으로 안 하나: 첫날부터 37건 빨강이면 아무도 안 읽는다. 래칫은 **지금을 못 박고
 *  한 칸씩 내리는** 장치다. (소방계획서_50 §5-2) */
console.log('\n[7] 한 칸도 안 채우는 시트 — 이름으로 못 박기')
/** ERP가 이 시트에 **한 칸도** 안 넣는다 — 값 슬롯도 상자도.
 *  ⚠ 판정은 **한 벌**이다. 프로브에서 이 술어가 두 벌로 갈려 1.10.1(상자 9칸 배선)이
 *    「미배선」으로 찍힌 적이 있다 — 같은 파일 안 드리프트. */
const untouched = (r: (typeof all)[number]) =>
  (r.slots > 0 || r.boxes > 0) && r.wired === 0 && r.wiredBoxes === 0
const red = all.filter(untouched).map(r => r.sheet).sort()
const RED_EXPECTED = [
  '1.11.2 소방훈련·교육 세부계획', '1.11.3 소방훈련 시나리오', '1.11.4 결과기록부 뒷쪽',
  '1.14.1 화재예방 및 홍보 계획',
  '1.14.2 화재예방 및 홍보 결과', '1.15 피해 복구',
  '1.3 건축물 위치·운영현황', '1.5.2 방화·제연구획 현황도', '1.6.1 기타시설 일반현황',
  '1.9.3 입주사 현황', '2.10 피난유도팀',
  '2.11 응급구조팀', '2.12 방호안전팀', '2.13 초기대응체계', '2.14 결과기록부 뒷쪽',
  '2.3 임무', '2.3 조직도', '2.4 개별임무카드', '2.5 지휘통제팀', '2.6 비상연락팀(지휘반)',
  '2.8 비상상황별 연락방법', '2.9 초기소화팀(진압반)', '3.2 피난시설 세부현황',
  '3.4 피난유도 절차·경로', '3.5 피난약자 현황·계획',
  '3.6 피난약자 유형별 방법', '3.7 피난기구·유도장비 현황', '개정이력',
].sort()
const gone = RED_EXPECTED.filter(s => !red.includes(s))
const grew = red.filter(s => !RED_EXPECTED.includes(s))
check(`적색 시트 ${RED_EXPECTED.length}장 — 늘지 않았다`, grew.length === 0,
  grew.length ? `🚨 새로 생긴 장: ${grew.join(' · ')}` : '')
check('적색 시트가 줄면 기대 목록을 갱신하라', gone.length === 0,
  gone.length ? `🎉 배선된 장: ${gone.join(' · ')} — RED_EXPECTED에서 빼라` : '')
// 🚨 양성 — 목록이 비면 위 둘은 공허하게 초록이다
check('적색 목록이 실제로 비어 있지 않다(공허 방지)', red.length > 0, `${red.length}장`)

/* ══════════════════════ [8] PDF 대조 — 「데이터는 있는데 엑셀만 공란」 ══════════════════════
 *  🚨 **판정 방법이 핵심이다.** 「HTML에 '1.10.3'이 들어 있는가」로 재면 **제목만 있어도 초록**이
 *    된다(모양만 보는 단언 — 이 저장소가 반복해 데인 함정). 대신 **그 고객에게만 있는 마커 값**을
 *    픽스처에 심고 HTML에 나타나는지로 판정한다.
 *
 *  이 목록이 곧 **6단계 우선순위 ①**이다 — 조회 변경 0, 앵커와 값만 더하면 된다.
 *  (소방계획서_50 §5-3) */
console.log('\n[8] PDF는 인쇄하는데 엑셀만 공란인 시트')
const { buildFirePlanHtml } = await import('../src/lib/fire-plan-template.ts')
const MARK = (s: string) => `__${s}__`
const fixture = {
  year: 2026, buildingName: '가상건물', address: '어딘가', purpose: '공동주택',
  // ⚠ 조립기가 `.length`를 무조건 부르는 배열은 **전부** 채운다(`d.brigade`·`d.zones`·`d.evacRoutes`).
  //   비우면 픽스처가 아니라 TypeError로 죽어 이 블록이 통째로 안 돈다.
  // ⚠ 조립기가 `.length`를 무조건 부르는 배열은 **전부** 채운다(`d.brigade`·`d.zones`·`d.evacRoutes`).
  //   비우면 픽스처가 아니라 TypeError로 죽어 이 블록이 통째로 안 돈다.
  facilities: [], brigade: [], zones: [], trainingMonth: null,
  hazards: [{ place: MARK('HAZ'), location: '지하1층', factors: ['유류'] }],
  // 🚨 피난 경로는 `forms.evacPlan`이 **아니라** 최상위 `d.evacRoutes`다(템플릿 57줄 주석).
  //   처음엔 `forms.evacPlan`에 심어 마커가 안 나왔는데, 그게 「템플릿이 안 찍는다」인지
  //   「내 픽스처가 틀렸다」인지 갈라야 했다 — 답은 후자였다.
  evacRoutes: [{ floor: '2층', route: MARK('EVAC'), guide: '', equip: '' }],
  forms: {
    // 🚨 `multiUse`는 **행 배열이 아니라 단일 객체**다(`users`·`capacity`·`categories`).
    multiUse: { applicable: true, users: MARK('MU'), capacity: '50' },
    // ⚠ 화재이력의 날짜 칸은 `at`이지 `date`가 아니다
    fireHistory: [{ kind: '화재', at: '2025-03-01', place: MARK('FIRE'), cause: '', action: '' }],
    training: { scenario: MARK('TRAIN'), eduMonths: [3], drillMonths: [9] },
  },
} as unknown as Parameters<typeof buildFirePlanHtml>[0]
const html = buildFirePlanHtml(fixture)
/** 마커 → 그 데이터가 인쇄되는 워크북 시트 */
const MARKERS: Array<[string, string]> = [
  ['HAZ', '1.2.2 화재취약장소 현황'],
  ['MU', '1.10.3 다중이용업소 관리현황'],
  ['FIRE', '1.10.4 화재·비화재보 이력'],
  ['TRAIN', '1.11.3 소방훈련 시나리오'],
  ['EVAC', '3.4 피난유도 절차·경로'],
]
const printed = MARKERS.filter(([m]) => html.includes(MARK(m)))
// 🚨 **전건**을 요구한다. `> 0`으로 두었더니 5개 중 2개가 조용히 안 나왔고, 그게
//   「템플릿이 안 찍는다」인지 「내 픽스처 모양이 틀렸다」인지 알 수 없는 채로 초록이었다
//   (답은 후자였다 — multiUse는 단일 객체, 경로는 최상위 `evacRoutes`).
//   전건을 요구하면 픽스처가 양식과 어긋나는 순간 **여기서** 드러난다.
const unprinted = MARKERS.filter(([m]) => !html.includes(MARK(m)))
check('심은 마커가 **전부** 인쇄됐다', unprinted.length === 0,
  `${printed.length}/${MARKERS.length}${unprinted.length ? ' — 안 나온 것: ' + unprinted.map(([m]) => m).join(',') : ''}`)
// 음성 — 심지 않은 마커는 나타나면 안 된다(HTML이 아무 글자나 담고 있지 않다는 대조)
check('음성 — 심지 않은 마커는 HTML에 없다', !html.includes(MARK('NOPE')))

const gap = printed.filter(([, sheet]) => untouched(all.find(r => r.sheet === sheet)!))
console.log('   ⬇ 6단계 우선순위 ① — 데이터는 있는데 엑셀만 공란')
for (const [m, sheet] of gap) console.log(`      ${sheet}  (마커 ${m})`)
// 래칫 — 배선하면 이 수가 줄고, 줄면 여기가 붉어져 목록을 갱신하게 된다.
// ⭐ 실제로 한 번 내렸다: 2026-09-16 **1.10.4 화재이력을 배선**하자 5 → 4가 됐다.
//   이 단언이 그 순간을 잡아 「기준선을 내려라」로 알려 준 것이 래칫이 일한 모습이다.
const GAP_EXPECTED = 2
check(`「PDF는 인쇄·엑셀은 공란」 ${GAP_EXPECTED}장`, gap.length === GAP_EXPECTED,
  `${gap.length}/${printed.length} — 줄었으면 그 장이 배선된 것이다(이 수를 내려라)`)

/* ══════════════════════ [9] 작업 대기열 — 콘솔 산출물도 계약이다 ══════════════════════ */
console.log('\n[9] 6단계 대기열 (슬롯+상자 많은 순, 상위 10장)')
for (const r of all.filter(untouched).sort((a, b) => (b.slots + b.boxes) - (a.slots + a.boxes)).slice(0, 10)) {
  console.log(`   슬롯 ${String(r.slots).padStart(4)} · 상자 ${String(r.boxes).padStart(4)}   ${r.sheet}`)
}

console.log(`\n=== pass ${pass} / fail ${fail} ===`)
process.exit(fail ? 1 : 0)
