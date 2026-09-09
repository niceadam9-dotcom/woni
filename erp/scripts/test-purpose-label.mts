/** 소방계획서 **용도 표기** 축 — 소방계획서_47 B-15.
 *
 *  한 값(`buildings.purpose`)이 산출물마다 다르게 인쇄된다. 그 갈래를 여기서 **한 실행에**
 *  고정한다 — 규칙이 코드 세 파일에 흩어져 있어서, 어느 한 쪽만 고쳐도 조용히 갈라진다.
 *
 *    · PDF      1.1 주용도 · 1.2.1 명칭/용도 · 3.1 용도  → **근린생활시설**
 *    · 엑셀     표지 · 3.1 용도 · 1.11.4 용도            → **근린생활시설**
 *    · 엑셀     1.1 주용도 · 1.2.1 구역 용도             → **근생** (칸이 좁다 · D-4 납품본)
 *
 *  🚨 **이 검사가 없던 동안 어느 쪽으로 고쳐도 스위트가 침묵했다.** 기존 픽스처의 용도가
 *    `업무시설`·`공동주택`·`근린생활시설`이라 **갈래를 타지 않는 값**이었기 때문이다
 *    ([[feedback_fixture_distribution_blind]] 그대로). 그래서 여기 픽스처는 갈래가 실제로
 *    갈리는 `제2종근린생활시설`이다.
 *
 *  ⚠ 항진명제를 막는 두 장치:
 *   ① **추출 성공부터 단언한다** — 세 자리를 뽑는 정규식이 빈손이면 '제2종이 없다'는 참이 된다.
 *      각 자리의 값이 실재함을 먼저 요구하고, 그 다음에 표기를 묻는다.
 *   ② **음성 대조** — 갈래가 아닌 용도(`업무시설`)는 여섯 자리 전부에서 **원값 그대로**여야 한다.
 *      가공이 무차별로 먹으면(예: 모든 값을 `근린생활시설`로) ①만으로는 초록이다.
 *
 *  실행: npx tsx --conditions=react-server scripts/test-purpose-label.mts
 *        (server-only 패키지를 무는 `fire-plan-template.ts`를 Next 런타임 밖에서 부른다)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { buildFirePlanHtml, type FirePlanGenData } from '../src/lib/fire-plan-template.ts'
import { buildFirePlanValues, missingValueFields } from '../src/lib/fire-plan-xlsx-values.ts'
import { FIRE_PLAN_ANCHORS, FP_SHEET } from '../src/lib/fire-plan-anchors.ts'
import { purposeCover, purposeShort } from '../src/lib/purpose-label.ts'
import { toInjectTargets } from '../src/lib/xlsx-workbook.ts'
import { injectWorkbook } from '../src/lib/xlsx-inject.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const XLSX_PATH = resolve(HERE, '../templates/fire-plan-workbook.xlsx')

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`) }
}

/* ══════════════════════ 픽스처 ══════════════════════
 *  실데이터가 아니라 결정적 상수다(고객 PII를 검사에 넣지 않는다).
 *  ⚠ `as unknown as` 캐스팅을 쓰지 않는다 — 캐스팅은 타입 검사를 끄는 것이지 통과시키는 게 아니다. */
const PLAIN = '업무시설'            // 갈래가 **아닌** 용도 — 음성 대조의 입력
const NEIGH = '제2종근린생활시설'   // 갈래 — 두 표기가 실제로 갈리는 입력
const ZONE_FREE = '사무실'          // 사람이 직접 적은 구역명 — 손대면 안 되는 값

const fixture = (purpose: string): FirePlanGenData => ({
  year: 2026, revisionDate: '2026-01-02', revisionNote: '최초 작성', revisions: [],
  buildingName: '검사용 표준건물', address: '서울특별시 중구 세종대로 110',
  grade: '2급', purpose, useApprovalDate: '2010-03-04',
  totalArea: '4500', buildingArea: '900', floors: '지하1층 / 지상5층', height: '21',
  structure: '철근콘크리트', roof: '슬래브', receiverLocation: '1층 방재실',
  ownerName: '표준소유자', ownerPhone: '02-0000-0000',
  managerName: '표준관리자', managerPhone: '010-0000-0000', managerSelectedAt: '2025-01-02',
  fireStation: '중부소방서', stationDistance: '2.4', stationEta: '6',
  facilities: ['소화기구 및 자동소화장치', '옥내소화전설비'],
  companyName: '표준소방', companyAddress: '서울특별시 중구 1', companyPhone: '02-1111-1111',
  contractStart: '2025-01-01', inspectionCycle: '매월 1회',
  operationMonth: '2026년 7월', comprehensiveMonth: '',
  trainingMonth: null,
  brigade: [{ team: '자위소방대장', name: '표준관리자', duty: '총괄', phone: '010-0000-0000' }],
  evacRoutes: [{ floor: '5층', route: '동편 계단', guide: '표준관리자', equip: '완강기' }],
  assembly: '건물 앞 주차장', evacNote: '방송 후 계단으로 유도한다.',
  evacFalseAlarm: '수신기에서 발신 지구를 확인한다.', evacMethod: '연기를 피해 낮은 자세로 대피한다.',
  /* 🎯 구역 두 줄을 **다르게** 둔다. 첫 줄은 조립기 폴백(`name: buildings.purpose`)이 만드는
   *   모양이고, 둘째 줄은 사람이 직접 적은 구역명이다 — 가공이 무차별이면 둘째가 붉어진다. */
  zones: [
    { zone: '전층', name: purpose, area: '4500', weekday: '20', holiday: '2', managerCo: '표준소방', contact: '02-1111-1111' },
    { zone: '2층', name: ZONE_FREE, area: '900', weekday: '5', holiday: '0', managerCo: '표준소방', contact: '02-1111-1111' },
  ],
  hazards: [{ place: '전기실', location: '지하1층', factors: ['전기적 요인'] }],
  photos: [],
})

/* ══════════════════════ [0] 순수 함수 축 ══════════════════════ */
console.log('\n[0] 표기 함수 — 갈래는 갈리고, 나머지는 통과한다')
check(`purposeShort('${NEIGH}') = 근생`, purposeShort(NEIGH) === '근생', purposeShort(NEIGH))
check(`purposeCover('${NEIGH}') = 근린생활시설`, purposeCover(NEIGH) === '근린생활시설', purposeCover(NEIGH))
check('제1종도 같이 걸린다(제2종만 고치면 다음에 넘친다)',
  purposeCover('제1종근린생활시설') === '근린생활시설' && purposeShort('제1종근린생활시설') === '근생')
check(`갈래가 아니면 원값 통과 — '${PLAIN}'`,
  purposeCover(PLAIN) === PLAIN && purposeShort(PLAIN) === PLAIN, `${purposeCover(PLAIN)} / ${purposeShort(PLAIN)}`)
check("자유 입력 구역명도 원값 통과 — '사무실'", purposeCover(ZONE_FREE) === ZONE_FREE)
check('빈 값은 빈 문자열', purposeCover(null) === '' && purposeCover(undefined) === '' && purposeShort('') === '')
// ⚠ `문화및집회시설`은 **일부러 줄이지 않는다**(통용 약어가 없다) — 규칙이 번지면 여기가 붉어진다
check('근린생활시설 밖으로 규칙이 번지지 않았다',
  purposeCover('문화및집회시설') === '문화및집회시설' && purposeShort('문화및집회시설') === '문화및집회시설')

/* ══════════════════════ [1] PDF 축 ══════════════════════ */
console.log('\n[1] PDF(buildFirePlanHtml) — 세 자리가 「근린생활시설」인가')

/** 서식 구간을 잘라 본다 — 문서 전체에서 문자열을 세면 어느 자리인지 모른다 */
const between = (html: string, from: string, to: string): string => {
  const i = html.indexOf(from)
  const j = html.indexOf(to, i + from.length)
  return i < 0 || j < 0 ? '' : html.slice(i, j)
}
/** 세 자리의 실제 인쇄값 — 정규식이 빈손이면 `null`(그 자체가 실패 신호다) */
const pdfSpots = (html: string) => {
  const s11 = between(html, '서식 1.1', '서식 1.2')
  const s121 = between(html, '1.2.1 구역별 세부현황', '1.2.2 화재취약장소')
  const s31 = between(html, '서식 3.1', '서식 3.2')
  const zoneCells = [...s121.matchAll(/<td class="l">([^<]*)<\/td>/g)].map(m => m[1].trim())
  return {
    f11: /주용도:\s*([^<]*)</.exec(s11)?.[1]?.trim() ?? null,
    f121a: zoneCells[0] ?? null,
    f121b: zoneCells[1] ?? null,
    f31: /<th>용도<\/th><td class="l">([^<]*)</.exec(s31)?.[1]?.trim() ?? null,
    s11, s121, s31,
  }
}

const htmlN = buildFirePlanHtml(fixture(NEIGH), [])
const N = pdfSpots(htmlN)
// ① 추출 성공부터 — 빈손이면 아래 '제2종 없음'이 항진명제가 된다
check('세 자리를 실제로 뽑았다(빈손이 아니다)',
  !!N.f11 && !!N.f121a && !!N.f121b && !!N.f31 && ![N.f11, N.f121a, N.f31].some(v => v === '&nbsp;'),
  `1.1='${N.f11}' 1.2.1[0]='${N.f121a}' 1.2.1[1]='${N.f121b}' 3.1='${N.f31}'`)
check('구간 분모가 0이 아니다', N.s11.length > 200 && N.s121.length > 200 && N.s31.length > 200,
  `${N.s11.length}/${N.s121.length}/${N.s31.length}자`)

check('PDF 1.1 주용도 = 근린생활시설', N.f11 === '근린생활시설', `'${N.f11}'`)
check('PDF 1.2.1 명칭/용도 = 근린생활시설(구역 미입력 폴백)', N.f121a === '근린생활시설', `'${N.f121a}'`)
check('PDF 3.1 용도 = 근린생활시설', N.f31 === '근린생활시설', `'${N.f31}'`)
// 🎯 사람이 적은 구역명은 손대지 않는다 — 폴백값만 가공된다는 증거(같은 칸, 다른 입력)
check("PDF 1.2.1 둘째 구역은 사용자 입력 그대로('사무실')", N.f121b === ZONE_FREE, `'${N.f121b}'`)
check('PDF 세 구간에 「제2종」이 없다',
  !N.s11.includes('제2종') && !N.s121.includes('제2종') && !N.s31.includes('제2종'))
check('PDF 문서 전체에 「제2종근린생활시설」 0회', !htmlN.includes(NEIGH),
  `${(htmlN.match(new RegExp(NEIGH, 'g')) ?? []).length}회`)

// ── 음성 대조 ── 갈래가 아닌 용도는 원값 그대로여야 한다
const htmlP = buildFirePlanHtml(fixture(PLAIN), [])
const P = pdfSpots(htmlP)
check(`PDF 음성 대조 — '${PLAIN}'이 세 자리에 원값 그대로`,
  P.f11 === PLAIN && P.f121a === PLAIN && P.f31 === PLAIN,
  `1.1='${P.f11}' 1.2.1='${P.f121a}' 3.1='${P.f31}'`)
check('PDF 음성 대조 — 「근린생활시설」이 새어 들어가지 않았다', !htmlP.includes('근린생활시설'))

/* ══════════════════════ [2] 엑셀 값 축 ══════════════════════ */
console.log('\n[2] 엑셀 값 맵 — 좁은 칸은 「근생」, 넓은 칸은 「근린생활시설」')
const valN = buildFirePlanValues(fixture(NEIGH))
const valP = buildFirePlanValues(fixture(PLAIN))
check('값 맵 완결(앵커 전 필드)', missingValueFields(valN).length === 0, missingValueFields(valN).join(','))
// 🚨 현행 유지 축 — 1.1·1.2.1은 사용자 별도 결정 대기 중이라 **바뀌면 안 된다**(회귀 감시)
check('엑셀 1.1 주용도 = 근생(현행 유지)', valN.get('purpose') === '근생', String(valN.get('purpose')))
check('엑셀 1.2.1 구역 용도 = 근생(현행 유지)', valN.get('zone_0_usage') === '근생', String(valN.get('zone_0_usage')))
check("엑셀 1.2.1 둘째 구역은 사용자 입력 그대로('사무실')",
  valN.get('zone_1_usage') === ZONE_FREE, String(valN.get('zone_1_usage')))
check('엑셀 표지 = 근린생활시설(제2종 없음)',
  String(valN.get('cover_purpose')).includes('근린생활시설') && !String(valN.get('cover_purpose')).includes('제2종'),
  String(valN.get('cover_purpose')))
check('엑셀 3.1·1.11.4 값(purpose_full) = 근린생활시설',
  valN.get('purpose_full') === '근린생활시설', String(valN.get('purpose_full')))
check(`엑셀 음성 대조 — '${PLAIN}'은 다섯 자리 전부 원값`,
  valP.get('purpose') === PLAIN && valP.get('zone_0_usage') === PLAIN && valP.get('purpose_full') === PLAIN
  && String(valP.get('cover_purpose')).includes(PLAIN),
  `${valP.get('purpose')} / ${valP.get('zone_0_usage')} / ${valP.get('purpose_full')} / ${valP.get('cover_purpose')}`)

/* ══════════════════════ [3] 엑셀 착지 축 ══════════════════════
 *  `validateAnchors`가 통과하는 것은 증거가 못 된다 — 라벨을 manifest에서 가져오므로 항진명제다.
 *  여기서는 **자산 워크북의 그 칸**을 직접 읽어 ① 라벨이 실제로 「용도」인지 ② 템플릿에서
 *  공란이었는지 ③ 주입 뒤 우리 값이 앉았는지를 차례로 묻는다. */
console.log('\n[3] 엑셀 착지 — 3.1!용도 · 1.11.4!용도 두 칸')
const bytes = new Uint8Array(readFileSync(XLSX_PATH))
const wb0 = XLSX.read(bytes, { cellStyles: false })
const cellText = (wb: XLSX.WorkBook, s: string, c: string) =>
  String((wb.Sheets[s]?.[c] as XLSX.CellObject | undefined)?.v ?? '').trim()

// ⚠ 좌표를 검사에 베껴 적지 않는다(47 Q-9에서 11건이 한꺼번에 죽었다) — **필드로 앵커에게 묻는다**
const anchorsOf = (field: string) => FIRE_PLAN_ANCHORS.filter(a => a.field === field)
const two = anchorsOf('purpose_full')
check('purpose_full 앵커가 두 칸이다(3.1 · 1.11.4)', two.length === 2,
  two.map(a => `${a.sheet}!${a.cell}`).join(' · '))
check('두 칸이 서로 다른 시트다', new Set(two.map(a => a.sheet)).size === 2)
check('배선한 시트가 3.1과 1.11.4다',
  two.some(a => a.sheet === FP_SHEET.F3_1) && two.some(a => a.sheet === FP_SHEET.F1_11_4),
  two.map(a => a.sheet).join(' · '))

for (const a of two) {
  // ① 라벨 — manifest 경유가 아니라 **자산의 그 칸**에서 직접 읽는다(좌표가 밀리면 여기가 붉다)
  check(`${a.sheet}!${a.labelCell} 라벨이 「용도」`, cellText(wb0, a.sheet, a.labelCell) === '용도',
    `'${cellText(wb0, a.sheet, a.labelCell)}'`)
  // ② 값칸은 템플릿에서 공란(백지 불변식) — 표본의 답이 남아 있으면 우리 값과 섞인다
  check(`${a.sheet}!${a.cell} 템플릿 공란`, cellText(wb0, a.sheet, a.cell) === '',
    `'${cellText(wb0, a.sheet, a.cell)}'`)
}

const { targets, unmapped } = toInjectTargets(valN, FIRE_PLAN_ANCHORS)
check('unmapped 0', unmapped.length === 0, unmapped.slice(0, 5).map(a => a.field).join(','))
const inj = await injectWorkbook(bytes, targets)
check('missed 0 — 전 대상 착지', inj.missed.length === 0, inj.missed.slice(0, 5).join(','))
const wb1 = XLSX.read(inj.bytes, { cellStyles: false })
for (const a of two) {
  check(`${a.sheet}!${a.cell} 착지값 = 근린생활시설`, cellText(wb1, a.sheet, a.cell) === '근린생활시설',
    `'${cellText(wb1, a.sheet, a.cell)}'`)
  check(`${a.sheet}!${a.labelCell} 라벨 무손상(값이 라벨을 덮지 않았다)`,
    cellText(wb1, a.sheet, a.labelCell) === '용도', `'${cellText(wb1, a.sheet, a.labelCell)}'`)
}
// 음성 대조 — 같은 두 칸에 갈래 아닌 용도가 원값으로 앉는가
const injP = await injectWorkbook(bytes, toInjectTargets(valP, FIRE_PLAN_ANCHORS).targets)
const wbP = XLSX.read(injP.bytes, { cellStyles: false })
check(`엑셀 착지 음성 대조 — 두 칸 모두 '${PLAIN}'`,
  two.every(a => cellText(wbP, a.sheet, a.cell) === PLAIN),
  two.map(a => `${a.cell}='${cellText(wbP, a.sheet, a.cell)}'`).join(' · '))

console.log(`\n=== pass ${pass} / fail ${fail} ===`)
process.exit(fail ? 1 : 0)
