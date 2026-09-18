/** 소방계획서 엑셀 값 축 — 소방계획서_42 S5.
 *
 *  입력은 `assembleFirePlan()`이 만든 `FirePlanGenData` **하나뿐**이다(재조회 없음).
 *  PDF(`buildFirePlanHtml`)와 엑셀이 **같은 조립 결과**를 먹으므로 두 산출물의 값이 갈라질 수
 *  없다 — 42가 조립을 공유하기로 한 이유가 이것이다.
 *
 *  규약 셋:
 *   · **S5-2 숫자도 전부 문자열.** 칸에 단위(㎡·명·대)가 인쇄돼 있고 계산 요구가 없다.
 *     `isoToSerial`을 쓰지 않는다 — 우리 셀엔 `numFmt`가 없어 시리얼을 넣으면 `45678`이
 *     인쇄된다(갑지가 쓴 이유는 원본 .xls 셀이 날짜 서식을 갖고 있었기 때문이다).
 *   · **S5-4 빈 값은 `''`.** `toInjectTargets`가 `null`(완전 덮어쓰기)로 바꾼다. 수식이 한 개도
 *     없으므로 `keepFormulaWhenEmpty`는 한 건도 쓰지 않는다.
 *   · **F-6 상자 글자는 셀별 원본을 되쓴다.** 원본이 `□`(449)와 `☐`(212)를 섞어 써서 전역
 *     어휘를 강제하면 어느 쪽을 골라도 최소 212칸이 원본과 갈라진다.
 *
 *  ⚠ 값이 **없어서** 비는 것과 **필드를 안 만들어서** 비는 것은 다르다. 앞은 정상이고 뒤는
 *    버그다. 그래서 `buildFirePlanValues`는 앵커 전 필드를 반드시 채우고, 라우트가 그걸
 *    `toInjectTargets`의 `unmapped`로 다시 확인한다(`?? '(없음)'`로 감싸면 오타가 공허 통과한다).
 */
import type { CellValue } from '@/lib/xlsx-inject'
import type { BrigadeRow, FirePlanGenData } from '@/lib/fire-plan-template'
import { formatTel } from '@/lib/format-contact'
import {
  BRIG_ROWS, FIRE_PLAN_ANCHORS, FORM14_NAME_CELL, FORM14_NAME_FIELD, FORM14_ROWS, FORM14_SHEET,
  FP_SHEET, ZONE_ROWS, ZONE_SHEET, FIREHIST_ROWS, HAZARD_SHEET, HAZARD_PLACE_ROWS, HAZARD_BOXES,
  MU_SHEET, MU_VALUE_CELLS, MU_HOURS_CELLS, MU_USER_BOXES,
  TRAIN_SHEET, TRAIN_ROWS, TRAIN_MONTH_COLS, TRAIN_TARGETS,
  EVAC1_SHEET, EVAC1_STAIR_CELLS, EVAC1_ETC_CELLS, EVAC1_ELEVATOR_CELL,
  BRIG1_SHEET, BRIG1_GRADE_CELLS, BRIG1_HEADCOUNT_BANDS, BRIG1_TYPE_CELLS, BRIG1_TEAM_CELLS,
  FIREWORK_ROWS, FIREWORK_COLS,
  CONSTRUCTION_ROWS, CONSTRUCTION_COLS,
  EVAC3_ROWS,
  BRIG9_SHEET, BRIG9_RUNNING_CELL, BRIG9_TOTAL_CELL, BRIG9_TEAM_CELLS, BRIG9_EMER_ROWS, BRIG9_FIELD_ROWS,
  REC14_SHEET, REC14_GRADE_CELLS,
  ATT14_SHEET, ATT14_CAPACITY,
  VUL_SHEET, VUL_WORK_CELLS, VUL_USE_CELLS, VUL_PLAN_ROWS, VUL_PLAN_COLS,
  VUL9_SHEET, VUL9_BOX_CELLS, VUL9_ROWS, VUL9_FIRST_ROW,
  EVAC34_SHEET, EVAC34_ROUTE_COLS,
  VUL36_SHEET, VUL36_ROWS, VUL36_TYPES,
  ORG23_SHEET,
  TENANT_SHEET, TENANT_ROWS, TENANT_COLS, TENANT_FIRST_ROW, isDashPlaceholderAnchor,
  RESP13_SHEET,
  EQUIP37_ROWS, EQUIP37_COLS,
  ETC61_SHEET,
  HAZ61_ROWS, HAZ61_COLS, HAZ12_SHEET, HAZ12_ROWS, HAZ12_COLS,
  VAL12_ROWS, VAL12_COLS,
  EVDET32_ROWS, EVDET32_COLS,
  REV_ROWS, REV_COLS,
  CARD24_SHEET, CARD24_CELLS,
  EVAC210_SHEET, EVAC210_ROUTE_CELLS,
  EXT29_SHEET, HAZ29_ROWS,
  CONTACT26_SHEET, ALERT28_SHEET, RESCUE211_SHEET,
} from '@/lib/fire-plan-anchors'
import { boxGlyphAt, labelAt, tokenTemplateAt } from '@/lib/fire-plan-xlsx-manifest'
import { purposeCover, purposeShort } from '@/lib/purpose-label'
/* 주차장 체크 판정 — 별지 9호 2쪽이 쓰는 그 함수(사본 금지). 순수 함수라 클라이언트도 쓴다 */
import { parseParkingSummary, parseParkingByType, parseParkingEv } from '@/lib/doc-templates/report9'
/* 계단·승강기 상자 판정 — PDF와 **같은 술어**(의존 없는 순수 모듈, 사본 금지) */
import { stairChecks } from '@/lib/facility-status'
import { compartmentApplies, compartmentHasArea, compartmentHasFloor } from '@/lib/evac-compartment'
import { isMultiUseApplicable, isMultiUseNone } from '@/lib/multi-use'
/* 1.10.1 연간 점검 계획 — PDF와 **같은 해석기**(사본 금지) */
import { hasComprehensiveBlock, resolveInspectionPlan } from '@/lib/fire-plan-inspection-plan'
import { planMonthParts } from '@/lib/plan-month'

/* ────────────────────────── 표기 ────────────────────────── */

const txt = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return ''
  const s = String(v).trim()
  return s === '0' ? '' : s   // 0은 '미입력'의 표현이다(개소·대수 칸의 종전 규약과 같은 축)
}

/** 날짜 `YYYY. M. D.` — 법정 서식의 표기다(갑지 `ymdDots`와 같은 어휘, 앞자리 0 없음).
 *  ISO가 아니면 **손대지 않고 그대로** 흘린다 — 이미 사람이 쓴 표기일 수 있다. */
export function planDate(v: string | null | undefined): string {
  const s = txt(v)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return s
  return `${m[1]}. ${Number(m[2])}. ${Number(m[3])}.`
}

/**
 * **주용도 표기** — 규칙과 유래는 전부 `@/lib/purpose-label`에 있다(47 B-15에서 떼어냈다).
 *
 * ⭐ 왜 여기가 아니라 거기인가: PDF(`fire-plan-template.ts`)도 같은 표기를 쓰는데, 이 파일에서
 *   import 하면 HTML 경로가 `fire-plan-anchors` → manifest까지 물고 와 **엑셀 격자가 밀리면
 *   PDF도 500**이 된다(manifest `labelAt`은 모듈 적재 시점에 throw). 표기는 격자와 무관하므로
 *   의존 없는 소모듈에 둔다. 기존 호출부가 안 깨지도록 **여기서 그대로 다시 내보낸다**.
 */
export { purposeShort, purposeCover, isNeighborhoodFacility, NEIGHBORHOOD_FACILITY } from '@/lib/purpose-label'

/**
 * 체크 상자 한 칸 — **미체크면 manifest의 원본 글자를, 체크면 `■`를 쓴다**(S5-1).
 *
 * 원본에서 체크 표시는 `■` 한 종류이고 `☑`는 0회라 방향이 하나다. 라벨이 상자와 한 셀에
 * 붙어 있는 경우(`■소화기구 및 자동소화장치`)는 **manifest의 원본 자구**를 그대로 이어 붙인다 —
 * 손으로 베끼면 법정 자구가 갈라진다. 갑지 별지의 `[√]`는 다른 양식의 어휘라 쓰지 않는다.
 */
export function checkCell(sheet: string, cell: string, on: boolean, label: string): string {
  const box = on ? '■' : boxGlyphAt(sheet, cell)
  return label ? `${box}${label.startsWith(' ') ? '' : ' '}${label}` : box
}

/**
 * **상자칸** — 법정 자구를 이고 있는 칸의 상자 글자만 갈아 끼운다(앵커 §상자칸).
 *
 * `checkCell`은 '빈 칸 + 라벨'을 조립하지만, 1.5.1의 체크칸은 템플릿에 이미 `□ 면적별`이
 * 찍혀 있다. 손으로 `'■ 면적별'`을 만들면 양식이 개정돼도 코드가 옛 문구를 들고 있으므로
 * manifest 원문을 읽어 **n번째 상자**만 바꾼다. 미체크 상자는 원본 글자를 그대로 둔다(F-6).
 *
 * 🚨 상자가 하나도 없으면 throw — 좌표가 밀렸는데 조용히 라벨만 되쓰면 영영 미체크로 나간다.
 */
function stampBoxes(sheet: string, cell: string, on: (i: number) => boolean): string {
  const tpl = labelAt(sheet, cell)
  if (!/[□☐]/.test(tpl)) throw new Error(`fire-plan-xlsx-values: ${sheet}!${cell} 에 빈 상자가 없다 — 체크칸이 아니다`)
  let i = 0
  return tpl.replace(/[□☐]/g, g => (on(i++) ? '■' : g))
}

/** 상자 하나 + 라벨이 한 칸인 칸(`□ 면적별`) */
export function boxLabelCell(sheet: string, cell: string, on: boolean): string {
  return stampBoxes(sheet, cell, i => i === 0 && on)
}

/**
 * **단위칸** — 자구가 값 **뒤에** 붙는 칸(`대상물 급수 [2]급` · `건축면적 [1234]㎡` · `[100] 명`).
 *
 * 상자칸과 같은 부류다: 템플릿이 공란이 아니라 법정 자구(`급`·`㎡`·` 명`)를 이고 있고, 우리는
 * 그 앞에 값을 끼운다. 손으로 `` `${n}명` `` 이라 적지 않는 이유도 같다 — 양식이 `명`을
 * `인`으로 개정하면 코드가 옛 자구를 들고 있는다. manifest 원문을 읽어 조립한다.
 *
 * ⚠ 값이 이미 단위로 끝나면(`특급`·`2급`) 겹쳐 찍지 않는다 — `특급급`이 인쇄되면 안 된다.
 * ⚠ 값이 없으면 자구만 남긴다(빈 서식). 지워 버리면 `급`·`㎡`가 사라져 서식이 훼손된다.
 */
export function unitCell(sheet: string, cell: string, value: string | number | null | undefined): string {
  const unit = labelAt(sheet, cell)
  const v = txt(value)
  if (!v) return unit
  const bare = unit.trim()
  const core = bare && v.endsWith(bare) ? v.slice(0, v.length - bare.length).trim() : v
  return core ? `${core}${unit}` : unit
}

/**
 * **다중상자칸** — 한 칸에 상자가 여럿인 칸(`☐ 승용 ☐ 비상용 ☐ 피난용`, 3.1 승강기).
 *
 * `boxLabelCell`은 첫 상자만 갈지만 여기는 **n번째**를 각각 정한다. `yesNoCell`의 일반형이다.
 * ⚠ 상자 수와 `on` 길이가 다르면 조용히 어긋난다 — 그래서 **개수를 맞추라고 throw** 한다.
 */
export function multiBoxCell(sheet: string, cell: string, on: readonly boolean[]): string {
  const tpl = labelAt(sheet, cell)
  const n = (tpl.match(/[□☐]/g) ?? []).length
  if (n !== on.length) {
    throw new Error(`fire-plan-xlsx-values: ${sheet}!${cell} 상자 ${n}개인데 ${on.length}개를 줬다 — 좌표가 밀렸거나 목록이 낡았다`)
  }
  return stampBoxes(sheet, cell, i => !!on[i])
}

/**
 * **각괄호 상자칸** — 상자가 `□`가 아니라 `[  ]`인 갈래(2.14 결과기록부 등 별지 제13호 계열).
 *
 * `boxLabelCell`과 형제인데 **글리프도 표시도 다르다**: 상자는 각괄호이고 체크는 `■`가 아니라
 * `√`다. 시트가 스스로 그렇게 적어 놓았다 — `※ [ ]에는 해당되는 곳에 √표를 합니다`.
 * 손으로 `'[√]특급'`을 만들지 않는 이유는 형제들과 같다: 양식이 개정되면 코드가 옛 자구를 든다.
 *
 * ⚠ 각괄호 **안쪽만** 갈고 폭은 유지한다(`[  ]` → `[√ ]`) — 칸 폭이 좁아 글자가 밀리면
 *   뒤 자구가 다음 줄로 넘어간다. 🚨 각괄호가 없으면 throw(좌표가 밀렸는데 조용히 통과 금지).
 */
export function bracketBoxCell(sheet: string, cell: string, on: boolean): string {
  const tpl = labelAt(sheet, cell)
  if (!/\[\s+\]/.test(tpl)) {
    throw new Error(`fire-plan-xlsx-values: ${sheet}!${cell} 에 빈 각괄호가 없다 — 각괄호 상자칸이 아니다`)
  }
  if (!on) return tpl
  return tpl.replace(/\[(\s+)\]/, (_m, sp: string) => `[√${sp.slice(1)}]`)
}

/** 유·무가 한 칸인 칸(`□유 □무`). `null`(미입력)이면 **둘 다** 비운다 — 미입력과 '무'는 다르다 */
export function yesNoCell(sheet: string, cell: string, yes: boolean | null): string {
  return stampBoxes(sheet, cell, i => (i === 0 ? yes === true : i === 1 ? yes === false : false))
}

/**
 * **접두라벨칸** — 자구가 값 **앞에** 오는 칸(`■ 대상명 : {값}`). `unitCell`의 거울상이다.
 *
 * 손으로 `` `■ 대상명 : ${name}` `` 이라 적지 않는 이유도 같다 — 양식이 「대상명」을
 * 「대상물 명칭」으로 개정하면 코드가 옛 자구를 들고 있는다. manifest 원문을 읽어 잇는다.
 * ⚠ 값이 없어도 자구는 남긴다(빈 서식). 지우면 `대상명` 줄 자체가 사라진다.
 */
export function prefixCell(sheet: string, cell: string, value: string | null | undefined): string {
  const label = labelAt(sheet, cell)
  const v = txt(value)
  return v ? `${label}${label.endsWith(' ') ? '' : ' '}${v}` : label
}

/**
 * **자리표시칸** — 템플릿이 **보기(예시) 값**을 이고 있는 칸(`00시~00시`, 1.10.3 영업시간).
 *
 * 단위칸·접두라벨칸의 넷째 형제인데 성격이 반대다: 저쪽은 자구가 값과 **함께** 인쇄되지만,
 * 여기는 자리표시가 값에 **통째로 갈린다**. 값이 있으면 덮고, 없으면 자리표시를 그대로 둔다 —
 * 지우면 그 칸이 무엇을 적는 자리인지 알 수 없게 된다(빈 서식이 뜻을 잃는다).
 *
 * ⚠ `unitCell`로 대신할 수 없다. 저건 `'09:00~18:00' + '00시~00시'`를 만든다.
 */
export function placeholderCell(sheet: string, cell: string, value: string | null | undefined): string {
  return txt(value) || labelAt(sheet, cell)
}

/**
 * **감싼단위칸** — 자구가 값을 **양쪽에서** 감싸는 칸(`약     명`, 1.11.1 거주자 인원).
 *
 * 단위칸(`[값]명`)의 변종이다. `unitCell`을 쓰면 `'12약     명'`이 되어 뜻이 망가진다 —
 * 값은 **가운데 공백 자리**에 들어가야 한다(연월칸이 `년`·`월` 사이에 넣는 것과 같은 수법).
 *
 * ⚠ 값이 없으면 자구만 남긴다(빈 서식). `약`도 `명`도 법정 자구다.
 */
export function wrappedUnitCell(sheet: string, cell: string, value: string | number | null | undefined): string {
  const tpl = labelAt(sheet, cell)
  const s = txt(value)
  if (!s) return tpl
  // 가운데 공백 run을 값으로 갈아 끼운다 — 앞뒤 자구는 그대로 남는다
  return tpl.replace(/(\S)\s{2,}(\S)/, `$1 ${s} $2`)
}

/**
 * **연월칸** — 자구가 값 **사이사이에** 끼어 있는 칸(`'          년        월'`, 1.10.1 점검시기).
 *
 * 단위칸·접두라벨칸의 셋째 형제다. 여기서도 `` `${y}년 ${m}월` `` 을 손으로 짓지 않고 manifest
 * 원문의 공백 자리에 값을 끼운다 — 양식이 `년 월`을 `년도 월`로 개정하면 여기가 아니라
 * manifest가 바뀐다.
 *
 * ⚠ 값이 없으면 자구만 남긴다(빈 서식) — 지우면 무엇을 적는 자리인지 알 수 없게 된다.
 * 🚨 **형식을 못 맞추면 원문을 통째로 인쇄한다.** `년`·`월` 자구를 지키자고 값을 잃는 쪽이
 *   훨씬 나쁘다(레거시 자유 텍스트 안전망 — `planMonthParts`의 왕복 대조가 갈래를 가른다).
 */
export function yearMonthCell(sheet: string, cell: string, monthText: string | null | undefined): string {
  const tpl = labelAt(sheet, cell)
  if (!/년/.test(tpl) || !/월/.test(tpl)) {
    throw new Error(`fire-plan-xlsx-values: ${sheet}!${cell} 에 '년·월' 자구가 없다 — 연월칸이 아니다`)
  }
  const s = txt(monthText)
  if (!s) return tpl
  const p = planMonthParts(s)
  if (!p) return s
  return tpl.replace(/\s*년/, ` ${p.year}년`).replace(/\s*월/, ` ${p.month}월`)
}

/* ────────────────────────── 값 조립 ────────────────────────── */

/**
 * 앵커 필드 → 셀 값.
 *
 * 반환 맵은 **앵커의 모든 필드를 반드시 포함**한다. 비었으면 `''`(→ null → 완전 덮어쓰기)이지
 * '키 없음'이 아니다 — 키가 없으면 `toInjectTargets`가 그 앵커를 건너뛰어 템플릿 잔재가 남는다.
 */
export function buildFirePlanValues(d: FirePlanGenData): Map<string, CellValue> {
  const v = new Map<string, CellValue>()

  // ── 표지 ── 원문이 `[ {{customer_name}} ] 소방계획서` 라 리터럴까지 함께 조립한다.
  // 손으로 `[ ${name} ] 소방계획서`라 적으면 양식이 바뀌어도 코드가 옛 문구를 들고 있는다.
  v.set('cover_title', fillTemplate('표지', 'A3', { customer_name: txt(d.buildingName) }))
  // 용도 — 상자는 **체크하지 않는다**. 양식도 강순기도 이 칸의 상자는 비어 있고 라벨만 바뀐다
  // (선택지 목록이 아니라 '용도를 적는 칸'이라 체크할 대상이 없다).
  v.set('cover_purpose', checkCell('표지', 'M1', false, purposeCover(d.purpose)))

  // ── 서식 1.1 ──
  v.set('customer_name', txt(d.buildingName))
  v.set('address', txt(d.address))
  v.set('owner_name', txt(d.ownerName))
  v.set('owner_phone', txt(d.ownerPhone))
  v.set('manager_name', txt(d.managerName))
  // 🚨 양식 씨앗이 이 칸에 대표자 전화를 물려 두었던 자리다(R-1) — 소방안전관리자 전화가 맞다
  v.set('manager_phone', txt(d.managerPhone))
  v.set('receiver_location', txt(d.receiverLocation))
  // 표기 축 — 칸이 좁아 `제2종근린생활시설`이 두 줄로 접히며 옆 칸을 밀었다(사용자 지시 2026-09-08).
  // ⚠ 표지는 `근생`이 아니라 `근린생활시설`이다 — `purposeCover`를 쓴다(같은 값, 다른 표기).
  v.set('purpose', purposeShort(d.purpose))
  v.set('use_approval_date', planDate(d.useApprovalDate))
  v.set('total_area', txt(d.totalArea))
  v.set('floors', txt(d.floors))
  v.set('height', txt(d.height))
  v.set('main_structure', txt(d.structure))
  v.set('roof_structure', txt(d.roof))

  /* ── 서식 1.1 §시설현황·운영현황 (2026-09-08) ────────────────────────────────
   *  단위칸은 `unitCell`, 상자칸은 `boxLabelCell`이 **manifest 자구**를 읽어 조립한다.
   *  ⚠ 상자를 켜는 조건은 전부 '값이 있는가'다. 값이 없으면 끄는 게 아니라 **안 켠다** —
   *    미입력과 '해당없음'은 다르고, 후자는 반대편 칸(`해당없음`)이 따로 표현한다.
   */
  v.set('grade', unitCell(FP_SHEET.F1_1, 'T9', d.grade))
  v.set('building_area', unitCell(FP_SHEET.F1_1, 'AJ10', d.buildingArea))

  const el = d.elevators
  v.set('elevator_passenger', boxLabelCell(FP_SHEET.F1_1, 'L12', !!txt(el?.passenger)))
  v.set('elevator_emergency', boxLabelCell(FP_SHEET.F1_1, 'AB12', !!txt(el?.emergency)))
  v.set('elevator_evac', boxLabelCell(FP_SHEET.F1_1, 'AR12', !!txt(el?.evac)))

  /* 주차장 — 승강기 바로 아래 같은 모양의 체크 행(2026-09-09 배선). 판정은 별지 9호 2쪽과
   * **한 함수**를 쓴다(사본을 만들면 두 서식이 같은 값을 다르게 읽는 날이 온다).
   * ⚠ **옥상**은 양식 1.1에 칸이 없다(별지 9호에만 있다) — 그 값은 PDF의 원문 병기로만 보인다.
   *   종전 주석은 여기에 「기계식」도 함께 적어 두었는데 **거짓이었다** — 14행에 네 칸이 실재한다. */
  const pk = parseParkingSummary(d.parkingSummary ?? '')
  v.set('parking_indoor', boxLabelCell(FP_SHEET.F1_1, 'L13', pk.pkIn))
  v.set('parking_outdoor', boxLabelCell(FP_SHEET.F1_1, 'AB13', pk.pkOut))
  /* 13행 셋째 칸 전기차충전소(2026-09-16 배선). 별지 9호엔 이 칸이 없어 판정 술어도 따로다
   * (`parseParkingEv` — `parseParkingSummary`에 섞으면 별지 9호가 못 쓰는 축을 들게 된다). */
  v.set('parking_ev', boxLabelCell(FP_SHEET.F1_1, 'AR13', parseParkingEv(d.parkingSummary ?? '')))
  // 14행 — 편(옥내/옥외)별 자주식·기계식. 구간 분절 판정이라 「옥내 기계식, 옥외 자주식」이 갈린다
  const pkt = parseParkingByType(d.parkingSummary ?? '')
  v.set('parking_in_self', boxLabelCell(FP_SHEET.F1_1, 'L14', pkt.inSelf))
  v.set('parking_in_mech', boxLabelCell(FP_SHEET.F1_1, 'T14', pkt.inMech))
  v.set('parking_out_self', boxLabelCell(FP_SHEET.F1_1, 'AB14', pkt.outSelf))
  v.set('parking_out_mech', boxLabelCell(FP_SHEET.F1_1, 'AJ14', pkt.outMech))

  /* 계단 — 양식 1.1에는 개소를 적을 자리가 없어 **상자만** 켠다(개소는 서식 1.5.1이 받는다).
   *
   *  🚨 원천이 바뀌었다(2026-09-16 마이그 165): 종전엔 1.5 탭 JSON(`forms.evacFire.stairs`)을
   *    봤는데, 그 탭을 채운 고객이 **306명 중 4명**이라 나머지 302명은 네 칸이 영영 공란이었다.
   *    이제 건물이 원천이고 조립기가 한 번 해석해 준다(`d.stairCounts` — PDF도 같은 값을 쓴다).
   *  🚨 판정도 `!!txt(...)`에서 `stairChecks`로 바뀌었다. `!!`는 문자열 `'0'`을 켜서
   *    「0개소인데 ■」를 인쇄했다(송학떡집 `옥외계단:'0'` 실측). `checkFromCount`는 1 이상만 켠다. */
  const stairOn = stairChecks(d.stairCounts ?? {})
  v.set('stair_special', boxLabelCell(FP_SHEET.F1_1, 'L15', stairOn.special))
  v.set('stair_direct', boxLabelCell(FP_SHEET.F1_1, 'AJ15', stairOn.direct))
  v.set('stair_escape', boxLabelCell(FP_SHEET.F1_1, 'L16', stairOn.escape))
  v.set('stair_outdoor', boxLabelCell(FP_SHEET.F1_1, 'AJ16', stairOn.outdoor))

  const opw = txt(d.ops?.opHoursWeekday)
  const oph = txt(d.ops?.opHoursHoliday)
  v.set('ophours_weekday', boxLabelCell(FP_SHEET.F1_1, 'L17', !!opw))
  v.set('ophours_weekday_time', opw)
  v.set('ophours_holiday', boxLabelCell(FP_SHEET.F1_1, 'AJ17', !!oph))
  v.set('ophours_holiday_time', oph)

  const hcWorker = txt(d.ops?.headcountWorker)
  const hcResident = txt(d.ops?.headcountResident)
  const hcMax = txt(d.ops?.headcountMax)
  v.set('headcount_worker_on', boxLabelCell(FP_SHEET.F1_1, 'L19', !!hcWorker))
  v.set('headcount_worker', unitCell(FP_SHEET.F1_1, 'T19', hcWorker))
  v.set('headcount_resident_on', boxLabelCell(FP_SHEET.F1_1, 'AB19', !!hcResident))
  v.set('headcount_resident', unitCell(FP_SHEET.F1_1, 'AJ19', hcResident))
  v.set('headcount_max_on', boxLabelCell(FP_SHEET.F1_1, 'AR19', !!hcMax))
  v.set('headcount_max', unitCell(FP_SHEET.F1_1, 'BA19', hcMax))

  // 업무대행 — 대행업체가 배선돼 있으면 '해당'이다(서식 1.8이 그 업체로 채워진다).
  //   ⚠ PDF는 `■ 해당`을 **글자로 박아** 두어 대행이 없어도 늘 해당으로 인쇄된다.
  //     엑셀은 데이터를 따른다 — 같은 조립 결과를 쓰되 이 칸은 PDF 쪽이 낡은 것이다.
  const hasAgency = !!txt(d.companyName)
  v.set('agency_yes', boxLabelCell(FP_SHEET.F1_1, 'L21', hasAgency))
  v.set('agency_no', boxLabelCell(FP_SHEET.F1_1, 'AJ21', !hasAgency))

  // 다중이용업 — 1.10.3에서 '해당'을 명시적으로 켠 경우에만 참(isMultiUseApplicable 규약).
  //   여집합이 '해당없음'이라 미입력은 해당없음 쪽에 붙는다 — 그 판정은 multi-use.ts가 단일 원천.
  const mu = d.forms?.multiUse
  v.set('multiuse_yes', boxLabelCell(FP_SHEET.F1_1, 'L23', isMultiUseApplicable(mu)))
  v.set('multiuse_no', boxLabelCell(FP_SHEET.F1_1, 'AJ23', isMultiUseNone(mu)))

  // 화재보험 — `ops`는 v2 확장이라 없을 수 있다(하위 호환). 미가입이면 네 칸을 **모두 비운다**:
  // 한 칸이라도 남으면 '미가입인데 보험사가 적힌' 문서가 나간다(체크 축과 값 축이 갈라지는 자리).
  // ⚠ `insuranceJoined`는 `null`(미입력)일 수 있다 — 그때는 값이 있으면 가입으로 본다.
  const ins = d.ops
  const joined = ins?.insuranceJoined ?? !!txt(ins?.insuranceCompany)
  v.set('insurance_company', joined ? txt(ins?.insuranceCompany) : '')
  v.set('insurance_period', joined ? txt(ins?.insurancePeriod) : '')
  v.set('insurance_amount_person', joined ? txt(ins?.insuranceAmountPerson) : '')
  v.set('insurance_amount_property', joined ? txt(ins?.insuranceAmountProperty) : '')
  // 가입/미가입 상자 — ⚠ **셋째 상태가 있다**. `ops`가 없거나 `insuranceJoined`가 null이면
  //   둘 다 빈 상자로 둔다(미입력). '미가입'을 찍는 건 관계인이 그렇게 답한 경우뿐이다.
  v.set('insurance_yes', boxLabelCell(FP_SHEET.F1_1, 'L24', joined))
  v.set('insurance_no', boxLabelCell(FP_SHEET.F1_1, 'AJ24', ins?.insuranceJoined === false))

  /* ── 용도 두 칸 (3.1 · 1.11.4) ── 2026-09-09 · 47 B-15
   *  같은 `d.purpose`인데 표기가 1.1·1.2.1과 다르다(`근생` vs `근린생활시설`) — 납품본이 그렇다.
   *  그래서 필드를 나눠 둔다. 값 자체는 하나이므로 두 칸이 갈라질 수 없다(앵커 둘·필드 하나). */
  v.set('purpose_full', purposeCover(d.purpose))

  // ── 서식 1.3 소방차 진입경로 ──
  v.set('fire_station', txt(d.fireStation))
  /* ── 서식 1.4 소방시설 현황 (2026-09-14) ────────────────────────────────────
   *  🚨 이 시트는 통째로 미배선이라 **40종 전부**가 `□`로 나가고 있었다(앵커 §1.4 참조).
   *  값은 새로 계산하지 않는다 — PDF(`facilityRows`)가 쓰는 `d.facilities` **그대로**다.
   *  두 산출물이 같은 집합을 보므로 갈라질 수 없다(D-7). 상자만 갈아 끼운다(§상자칸).
   *  ⚠ `d.facilities`는 이미 표준 코드로 정규화·필터된 값(`assembleFirePlan`)이지만, 비교는
   *    `xlsx-form4`와 같은 공백무시 규약을 쓴다 — 대장 어휘의 띄어쓰기 흔들림을 흡수한다.
   */
  const facSet = new Set((d.facilities ?? []).map(c => c.replace(/\s+/g, '')))
  for (const r of FORM14_ROWS) {
    v.set(r.field, boxLabelCell(FORM14_SHEET, r.cell, facSet.has(r.code.replace(/\s+/g, ''))))
  }
  v.set(FORM14_NAME_FIELD, prefixCell(FORM14_SHEET, FORM14_NAME_CELL, d.buildingName))

  // ── 서식 1.5.1 방화구획 ── 화면의 네 갈래(면적별·층별·면적별·층별·해당없음)를 법정 상자 축으로 편다.
  // ⭐ '면적별·층별'은 **새 상자가 아니다** — 양식엔 상자가 둘뿐이고 둘을 함께 체크하는 것이 그 표기다.
  //    그래서 키를 그대로 찍지 않고 `hasArea/hasFloor`로 푼다(PDF의 `compartmentBoxes`와 같은 규약).
  // ⚠ 미입력(`''`)이면 유·무를 **둘 다** 비운다. '무'를 찍으면 안 물어본 칸이 '해당없음'으로 나간다.
  const comp = d.forms?.evacFire?.compartment
  v.set('compartment_applies', yesNoCell(FP_SHEET.F1_5_1, 'H15', compartmentApplies(comp)))
  v.set('compartment_area', boxLabelCell(FP_SHEET.F1_5_1, 'P14', compartmentHasArea(comp)))
  v.set('compartment_floor', boxLabelCell(FP_SHEET.F1_5_1, 'AE14', compartmentHasFloor(comp)))

  // ── 서식 1.7.1 선임현황 ──
  v.set('manager_selected_date', planDate(d.managerSelectedAt))

  // ── 서식 1.8 업무대행 계약기간 ──
  // 원문이 `{{contract_date}} ~ ` 라 물결표까지 한 칸에 있다. 리터럴을 손으로 베끼지 않고
  // manifest의 원본 문자열에 값을 끼워 넣는다 — 서식이 바뀌면 여기가 아니라 manifest가 바뀐다.
  v.set('agency_contract_period', fillTemplate('1.8 업무대행 현황', 'U10', { contract_date: planDate(d.contractStart) }))

  /* ── 서식 1.10.1 연간 점검 계획 (2026-09-14) ─────────────────────────────────
   *  🚨 이 시트도 앵커가 **0개**라 사용승인일·자체점검 체크·점검시기가 통째로 공란이었다
   *    (사용자 신고). 값은 새로 계산하지 않는다 — PDF와 **한 해석기**를 쓴다(§사본 금지).
   *  ⭐ 상자를 켜면 양식 컨트롤도 함께 켜진다: 체크박스의 상태는 `fire-plan-checkbox-controls`가
   *    **이 계층이 칸에 적어 놓은 `■` 여부**로 정한다(그래서 여기만 고치면 된다).
   */
  const ip = resolveInspectionPlan(d.forms?.inspection, d)
  const compBlock = hasComprehensiveBlock(ip)
  const F1101 = FP_SHEET.F1_10_1
  v.set('f1101_use_approval_date', prefixCell(F1101, 'A4', planDate(d.useApprovalDate)))

  /* 작동점검 — **늘 체크한다**. 여기만 '값이 있는가'를 안 묻는 이유: 작동점검은 자체점검 대상
   * 전건의 법정 필수라 켤지 말지를 고르는 칸이 아니다(PDF도 `■ 작동점검`을 조건 없이 인쇄한다).
   * 시기를 아직 못 정한 고객은 상자만 켜지고 연월칸은 빈 서식으로 남는다 — 그게 맞는 상태다. */
  v.set('f1101_op_check', boxLabelCell(F1101, 'D5', true))
  v.set('f1101_op_month', yearMonthCell(F1101, 'V5', ip.opMonth))
  v.set('f1101_op_self', boxLabelCell(F1101, 'V7', ip.opInspector === '자체'))
  v.set('f1101_op_outsource', boxLabelCell(F1101, 'AF7', ip.opInspector === '외주'))

  /* 종합점검 — 머리 상자는 안쪽 세 줄 중 하나라도 켜질 때만(`hasComprehensiveBlock`).
   * ⚠ 2차(특급대상물)는 **고객이 적었을 때만** 켠다. 실측 3건 전부 공란이라 사실상 늘 빈 상자지만
   *   (사용자 결정 2026-09-14: 공란 유지), 적어 넣은 값을 버리지는 않는다 — PDF는 그 값을
   *   인쇄하므로 여기서만 삼키면 두 산출물이 갈라진다. '공란 유지'와 '값 버리기'는 다르다. */
  v.set('f1101_comp_check', boxLabelCell(F1101, 'D8', compBlock))
  v.set('f1101_initial_check', boxLabelCell(F1101, 'V8', ip.isInitial))
  v.set('f1101_initial_month', yearMonthCell(F1101, 'AP8', ip.isInitial ? ip.initialMonth : ''))
  v.set('f1101_comp_box', boxLabelCell(F1101, 'V9', !!ip.compMonth))
  v.set('f1101_comp_month', yearMonthCell(F1101, 'AP9', ip.compMonth))
  v.set('f1101_comp2_box', boxLabelCell(F1101, 'V10', !!ip.comp2Month))
  v.set('f1101_comp2_month', yearMonthCell(F1101, 'AP10', ip.comp2Month))
  // 점검자 — 블록이 꺼져 있으면 **둘 다 비운다**(종합을 안 하는데 점검자만 찍히면 자기모순이다)
  v.set('f1101_comp_self', boxLabelCell(F1101, 'V12', compBlock && ip.compInspector === '자체'))
  v.set('f1101_comp_outsource', boxLabelCell(F1101, 'AF12', compBlock && ip.compInspector === '외주'))

  // ── 서식 1.2.1 구역별 세부현황 ──
  // S4-3: 양식 고정 행 수를 지킨다. 넘치는 구역은 **버리되 세어서** 라우트가 고지 헤더에 싣는다.
  const zones = d.zones ?? []
  for (let i = 0; i < ZONE_ROWS; i++) {
    for (const [k, val] of Object.entries(zoneRowValues(zones[i]))) v.set(`zone_${i}_${k}`, val)
  }

  /* ── 서식 3.3 피난인원현황 (2026-09-17) ────────────────────────────────────
   *
   *  ⭐ **1.2.1의 쌍둥이다.** `zoneRowValues()`를 나눠 쓰므로 같은 구역이 두 시트에서
   *    다르게 인쇄될 **방법이 없다**(사본 금지 — 규칙을 두 벌 두지 않는다).
   *  ⭐ 3.3이 19행, 1.2.1이 8행이라 **9번째 구역부터는 3.3에만 실린다** — 갈라짐이 아니라
   *    양식의 용량 차이다.
   *  ⚠ 인원 3칸·동 칸은 비운다(앵커 §3.3 참조).
   */
  for (let i = 0; i < EVAC3_ROWS; i++) {
    for (const [k, val] of Object.entries(zoneRowValues(zones[i]))) v.set(`evac3_${i}_${k}`, val)
  }

  /* ── 서식 1.10.4 화재·비화재보 이력 (2026-09-16) ──────────────────────────────
   *
   *  🚨 이 시트는 **PDF가 이미 인쇄하는데 엑셀만 공란**이었다(소방계획서_50 §5-3의 마커 대조가
   *    확정했다). 데이터도 입력 화면(`plan-form110`의 `c-1.10.4` 카드)도 이미 있었고 **앵커만
   *    없었다** — 「앵커 0칸」의 다섯 번째다.
   *
   *  ⚠ **PDF와 같은 원천·같은 필드명**을 읽는다 — `fire-plan-template.ts`의 `histRows`가 쓰는
   *    `forms.fireHistory`의 `kind·at·place·cause·action` 그대로다. 여기서 이름을 바꿔 적으면
   *    두 표면이 갈라진다(이 저장소가 반복해 데인 축).
   *  ⚠ PDF는 빈 행을 3줄까지 `pad`로 채워 표 모양을 만들지만 **엑셀은 그러지 않는다** —
   *    양식이 이미 15행을 그려 두었고, 빈 칸은 빈 칸으로 남는 것이 맞다(없는 사실을 지어내지 않는다).
   */
  /* ── 서식 1.12.1 화기취급작업 현황 (2026-09-17) ─────────────────────────────
   *
   *  ⚠ **양식의 `연락처`는 안 채운다** — ERP에 축이 없다. 반대로 ERP의 `measure`(안전조치)는
   *    양식에 칸이 없다. 🚨 그걸 `연락처` 칸에 넣으면 **머리글이 거짓말을 한다**.
   *  ⚠ 넘치는 행은 버리되 **세어서** 라우트가 고지에 싣는다(구역·대원과 같은 규약).
   */
  const fwLog = (d.forms?.fireworkLog ?? []) as Array<Record<string, string>>
  for (let i = 0; i < FIREWORK_ROWS; i++) {
    const r = fwLog[i]
    for (const [, key] of FIREWORK_COLS) v.set(`firework_${i}_${key}`, txt(r?.[key]))
  }

  /* ── 서식 1.13 소방시설 공사·정비 기록 (2026-09-17) ───────────────────────────
   *
   *  🚨 열 수만 5:5이고 **뜻은 3열만 겹친다**(anchors §1.13 대조표 참조).
   *    `작업책임자`에 ERP의 `company`(시공업체)를 넣으면 **법인을 사람 자리에 찍는 것**이고,
   *    `확인일자`는 ERP가 모르는 사실이다 — 둘 다 비운다.
   *  ⚠ 갈 곳 없는 `facility`·`company`는 버리되 `constructionUnmapped()`가 센다.
   */
  const cvLog = (d.forms?.constructionLog ?? []) as Array<Record<string, string>>
  for (let i = 0; i < CONSTRUCTION_ROWS; i++) {
    const r = cvLog[i]
    for (const [, key] of CONSTRUCTION_COLS) v.set(`construction_${i}_${key}`, txt(r?.[key]))
  }

  /* ── 서식 2.1 자위소방대 일반현황 (2026-09-17) ──────────────────────────────
   *
   *  ⭐ 대부분 **1.1이 이미 쓰는 그 원천**이다(명칭·주소·등급·근무인원) — 같은 사실을
   *    두 시트가 다르게 찍으면 D-7 갈라짐이다.
   *  ⭐ 팀 상자는 **어간**으로 맞춘다(양식 `비상연락팀` ↔ ERP `비상연락`·`비상연락반`).
   *    2.2 배선이 「팀 구분 문자열의 단일 원천이 없다」고 기록해 둔 그 문제다 —
   *    목록을 세 번째로 베끼지 않고 꼬리(팀·반)를 떼어 비교한다.
   *  ⚠ 팀별 **인원**은 비운다 — 상자는 어간으로 맞출 수 있지만 수는 한쪽 목록에서만 맞는다.
   *    상자는 「그 팀이 있다」는 사실이고 수는 **틀리면 거짓**이다.
   */
  const brigList = d.brigade ?? []
  v.set('brig1_name', txt(d.buildingName))
  v.set('brig1_address', txt(d.address))
  for (const [cell, g] of BRIG1_GRADE_CELLS) {
    v.set(`brig1_grade_${g}`, boxLabelCell(BRIG1_SHEET, cell, txt(d.grade) === g))
  }
  // 상시근무인원 — 값이 없으면 **어느 구간도 켜지 않는다**(0명은 「50명 미만」이 아니라 미입력이다)
  const hcw = Number(txt(d.ops?.headcountWorker))
  BRIG1_HEADCOUNT_BANDS.forEach(([cell, lo, hi], i) => {
    v.set(`brig1_hc${i}`, boxLabelCell(BRIG1_SHEET, cell,
      Number.isFinite(hcw) && hcw > 0 && hcw >= lo && hcw < hi))
  })
  const btype = txt(d.forms?.brigadeGeneral?.type)
  BRIG1_TYPE_CELLS.forEach(([cell, mark], i) => {
    v.set(`brig1_type${i}`, boxLabelCell(BRIG1_SHEET, cell, !!btype && btype.includes(mark)))
  })
  v.set('brig1_total', unitCell(BRIG1_SHEET, 'V13', String(brigList.length || '')))
  for (const [k, stemWant, comp, duty] of BRIG1_TEAM_CELLS) {
    const on = brigList.some(b => teamStem(b.team) === stemWant)
    v.set(`brig1_team_${k}_c`, boxLabelCell(BRIG1_SHEET, comp, on))
    v.set(`brig1_team_${k}_d`, boxLabelCell(BRIG1_SHEET, duty, on))
  }

  /* ── 서식 3.1 피난시설 일반현황 (2026-09-17) ────────────────────────────────
   *
   *  ⭐ **1.1·1.5가 이미 쓰는 그 원천을 그대로 쓴다**(사본 금지) — 계단은 `stairChecks`,
   *    승강기는 `d.elevators`, 기타 피난시설은 `evacFire.etc`. 같은 사실을 두 시트가
   *    다르게 인쇄하면 그게 D-7 갈라짐이다.
   *  ⚠ 근거가 없는 상자(화재경보 방식·피난기구·인명구조기구·유도등 선식·방화시설)는
   *    **안 건드린다** — 사유는 앵커 선언부에 적었다.
   */
  const ef1 = d.forms?.evacFire
  // ⭐ 1.1 15~16행과 **같은 호출**이다(`d.stairCounts`) — 두 시트가 같은 사실을 다르게 찍으면 D-7 갈라짐이다
  const st1 = stairChecks(d.stairCounts ?? {})
  for (const [cell, kind] of EVAC1_STAIR_CELLS) {
    v.set(`evac1_stair_${kind}`, boxLabelCell(EVAC1_SHEET, cell, !!st1[kind as keyof typeof st1]))
  }
  for (const [cell, kind] of EVAC1_ETC_CELLS) {
    v.set(`evac1_etc_${kind}`, boxLabelCell(EVAC1_SHEET, cell, !!ef1?.etc?.includes(kind)))
  }
  // 한 칸에 상자 셋 — 순서는 양식 그대로(승용·비상용·피난용)
  v.set('evac1_elevators', multiBoxCell(EVAC1_SHEET, EVAC1_ELEVATOR_CELL, [
    !!txt(d.elevators?.passenger), !!txt(d.elevators?.emergency), !!txt(d.elevators?.evac),
  ]))

  /* ── 서식 1.11.1 소방훈련·교육 연간계획 (2026-09-17) ─────────────────────────
   *
   *  🚨 상자 72칸이 통째로 비어 있던 시트다. 양식 행이 PDF 표와 한 줄씩 대응하므로
   *    **PDF와 같은 폴백**을 쓴다 — 세부 월이 없으면 `d.trainingMonth` 한 달(구 자유 입력).
   *    여기서 폴백을 다르게 적으면 두 산출물이 갈라진다.
   *  ⚠ 대상자 인원은 1.1 인원현황과 **같은 원천**이다(`ops.headcount*`). 자위소방대 인원은
   *    편성표 행 수가 유일한 근거다 — 없으면 상자도 안 켠다(0명인데 ■는 거짓이다).
   */
  const tr1 = d.forms?.training
  const eduM = tr1?.eduMonths?.length ? tr1.eduMonths : d.trainingMonth != null ? [d.trainingMonth] : []
  const drillM = tr1?.drillMonths?.length ? tr1.drillMonths : d.trainingMonth != null ? [d.trainingMonth] : []
  for (const [row, key, kind] of TRAIN_ROWS) {
    const months = kind === 'edu' ? eduM : drillM
    TRAIN_MONTH_COLS.forEach((col, m) => {
      v.set(`train_${key}_m${m + 1}`, boxLabelCell(TRAIN_SHEET, `${col}${row}`, months.includes(m + 1)))
    })
  }
  const trCount: Record<string, string> = {
    worker: txt(d.ops?.headcountWorker),
    resident: txt(d.ops?.headcountResident),
    brigade: String((d.brigade ?? []).length || ''),
  }
  for (const [key, boxCell, cntCell] of TRAIN_TARGETS) {
    // 🚨 인원이 있을 때만 대상자 상자를 켠다 — 0명인데 체크하면 없는 사실을 인쇄하는 것이다
    v.set(`train_t_${key}`, boxLabelCell(TRAIN_SHEET, boxCell, !!trCount[key]))
    // ⚠ 거주자 칸만 자구가 값을 **감싼다**(`약     명`) — `unitCell`을 쓰면 `12약  명`이 된다
    v.set(`train_n_${key}`, /\S\s{2,}\S/.test(labelAt(TRAIN_SHEET, cntCell))
      ? wrappedUnitCell(TRAIN_SHEET, cntCell, trCount[key])
      : unitCell(TRAIN_SHEET, cntCell, trCount[key]))
  }

  /* ── 서식 1.10.3 다중이용업소 관리현황 (2026-09-17) ──────────────────────────
   *
   *  🚨 **해당 없으면 전부 비운다.** 다중이용업소가 아닌 대상물에 사업장명·영업시간을 인쇄하면
   *    없는 사실을 지어내는 것이다. 판정은 **PDF와 같은 술어**(`isMultiUseApplicable` — 사본 금지).
   *  ⚠ 업종은 `categories`(업종→개소 맵)라 여러 개일 수 있다. 양식 칸은 하나뿐이므로
   *    `업종(개소)` 꼴로 이어 붙인다 — PDF의 `muCats`와 **같은 조립**이다.
   *  ⚠ 영업시간은 `hoursDetail`(평일/휴일 × 주간/야간)이 정본이고 `hours`는 레거시 자유 텍스트다.
   *    상자는 **시간이 실제로 있을 때만** 켠다(빈 상자 옆 빈 시간이 정답이다).
   */
  const mu3 = d.forms?.multiUse
  const muOn = isMultiUseApplicable(mu3)
  const hd = mu3?.hoursDetail
  for (const [k, cell] of MU_VALUE_CELLS) {
    const src: Record<string, string | undefined> = {
      bizname: mu3?.bizName,
      // PDF `muCats`와 같은 조립 — 개소가 있으면 `업종(개소)`
      category: Object.entries(mu3?.categories ?? {}).map(([n, c]) => (c ? `${n}(${c})` : n)).join(', '),
      location: mu3?.location,
      owner: mu3?.owner,
      phone: mu3?.phone,
    }
    v.set(`mu_${k}`, muOn ? txt(src[k]) : '')
    void cell
  }
  const muTime: Record<string, string | undefined> = {
    wkday_at: hd?.wkDay, wknight_at: hd?.wkNight, holday_at: hd?.holDay, holnight_at: hd?.holNight,
  }
  const muBoxOn: Record<string, boolean> = {
    wk: !!(txt(hd?.wkDay) || txt(hd?.wkNight)),
    hol: !!(txt(hd?.holDay) || txt(hd?.holNight)),
    wkday_box: !!txt(hd?.wkDay), wknight_box: !!txt(hd?.wkNight),
    holday_box: !!txt(hd?.holDay), holnight_box: !!txt(hd?.holNight),
  }
  for (const [k, cell, kind] of MU_HOURS_CELLS) {
    v.set(`mu_${k}`, kind === 'box'
      ? boxLabelCell(MU_SHEET, cell, muOn && !!muBoxOn[k])
      : placeholderCell(MU_SHEET, cell, muOn ? muTime[k] : ''))
  }
  for (const [k, cell, label] of MU_USER_BOXES) {
    v.set(`mu_${k}`, boxLabelCell(MU_SHEET, cell, muOn && !!mu3?.userTypes?.includes(label)))
  }
  v.set('mu_capacity', unitCell(MU_SHEET, 'AS8', muOn ? mu3?.capacity : ''))

  /* ── 서식 1.2.2 화재취약장소 현황 (2026-09-17) ──────────────────────────────
   *
   *  🚨 **장소 이름은 쓰지 않는다.** 양식이 보일러실·주방·전기실을 **인쇄해 두었고**(법정 자구),
   *    우리가 채우는 것은 위치 칸과 체크상자뿐이다. 이름을 덮어쓰면 서식이 훼손된다.
   *
   *  ⭐ 매칭은 **양식 자신의 라벨**로 한다(`labelAt`) — 여기에 `'보일러실'`이라 베껴 적으면
   *    양식이 개정될 때 코드가 옛 이름으로 찾다가 조용히 아무것도 못 채운다.
   *  ⚠ `A8` 라벨은 앞에 공백이 있다(`' 주방'`) — `trim()`으로 맞춘다.
   */
  const hz = d.hazards ?? []
  for (let p = 0; p < HAZARD_PLACE_ROWS.length; p++) {
    const row = HAZARD_PLACE_ROWS[p]
    const placeLabel = labelAt(HAZARD_SHEET, `A${row}`).trim()
    const h = hz.find(x => txt(x.place) === placeLabel)
    v.set(`hazard_${p}_location`, txt(h?.location))
    for (const [col, dy, factor] of HAZARD_BOXES) {
      v.set(`hazard_${p}_${col}${dy}`,
        boxLabelCell(HAZARD_SHEET, `${col}${row + dy}`, !!h?.factors?.includes(factor)))
    }
  }

  const hist = d.forms?.fireHistory ?? []
  for (let i = 0; i < FIREHIST_ROWS; i++) {
    const h = hist[i]
    v.set(`firehist_${i}_kind`, txt(h?.kind))
    v.set(`firehist_${i}_at`, txt(h?.at))
    v.set(`firehist_${i}_place`, txt(h?.place))
    v.set(`firehist_${i}_cause`, txt(h?.cause))
    v.set(`firehist_${i}_action`, txt(h?.action))
  }

  /* ── 서식 2.2 자위소방대 편성표 (2단계 · Q-1 자동 채움) ────────────────────────
   *  `d.brigade`는 `fire_brigade_members`를 sort_order 순으로 담은 것이고, 양식은 그 대원을
   *  **지휘통제팀(대장·부대장)** 과 **현장대응팀**으로 가른다.
   *
   *  ⚠ 팀 구분 문자열의 단일 원천이 **없다** — 입력 화면 두 곳이 서로 다른 목록을 들고 있다
   *    (`fire-plan-info-panel.tsx` 는 `비상연락`, `plan-ch2.tsx` 는 `비상연락반`). 다만 두 목록
   *    **모두** 앞 둘은 `자위소방대장`·`부대장`으로 같다. 그래서 그 둘만 접두사로 가르고
   *    나머지는 전부 현장대응팀으로 보낸다 — 목록을 새로 베껴 세 번째 원천을 만들지 않는다.
   */
  const brig = d.brigade ?? []
  const { lead, deputy, rest: fieldTeam } = brigadeHeads(brig)
  // 소속은 **대원이 있을 때만** 채운다 — 빈 줄에 건물명만 찍히면 '이름 없는 소속'이 인쇄된다
  const org = (b: BrigadeRow | undefined) => (b ? txt(d.buildingName) : '')

  v.set('brig_lead_org', org(lead))
  v.set('brig_lead_name', txt(lead?.name))
  v.set('brig_lead_duty', txt(lead?.duty))
  v.set('brig_lead_phone', formatTel(txt(lead?.phone)))
  v.set('brig_dep_org', org(deputy))
  v.set('brig_dep_name', txt(deputy?.name))
  v.set('brig_dep_duty', txt(deputy?.duty))
  v.set('brig_dep_phone', formatTel(txt(deputy?.phone)))

  /* ── 서식 1.9 자위소방대 현황 (2026-09-17) ─────────────────────────────────
   *
   *  ⭐ 2.1·2.2의 요약본이다. 대장·부대장은 **같은 술어**(`brigadeHeads`)로 뽑고
   *    편성인원은 2.1 `brig1_total`과 **같은 수**다 — 갈라질 수 없다.
   *  ⭐ 구분이 넷이라 비상연락 대원을 제 줄에 놓는다(어간 판정, 앵커 §1.9 참조).
   *  ⚠ 해당없음·근무형태·팀별 인원·사무실 칸은 비운다 — 사유는 앵커 선언부.
   */
  const b9emer = fieldTeam.filter(b => teamStem(b.team) === '비상연락')
  const b9field = fieldTeam.filter(b => !b9emer.includes(b))
  v.set('brig9_running', boxLabelCell(BRIG9_SHEET, BRIG9_RUNNING_CELL, brig.length > 0))
  v.set('brig9_total', unitCell(BRIG9_SHEET, BRIG9_TOTAL_CELL, String(brig.length || '')))
  for (const [k, stemWant, cell] of BRIG9_TEAM_CELLS) {
    // 지휘통제팀은 ERP에 그 이름의 팀이 없다 — **대장·부대장이 곧 지휘통제**다
    const on = stemWant === '지휘통제'
      ? !!(lead || deputy)
      : brig.some(b => teamStem(b.team) === stemWant)
    v.set(`brig9_team_${k}`, boxLabelCell(BRIG9_SHEET, cell, on))
  }
  // 소속은 **대원이 있을 때만** — 2.2와 같은 규약(빈 줄에 건물명만 찍히면 '이름 없는 소속')
  const put9 = (pfx: string, b: BrigadeRow | undefined) => {
    v.set(`${pfx}_org`, org(b))
    v.set(`${pfx}_name`, txt(b?.name))
    v.set(`${pfx}_phone`, formatTel(txt(b?.phone)))
  }
  put9('brig9_lead', lead)
  put9('brig9_dep', deputy)
  BRIG9_EMER_ROWS.forEach((_, i) => put9(`brig9_emer${i}`, b9emer[i]))
  for (let i = 0; i < BRIG9_FIELD_ROWS; i++) put9(`brig9_fld${i}`, b9field[i])

  /* ── 서식 2.14 교육·훈련 결과기록부 앞쪽 (2026-09-17) ───────────────────────
   *
   *  ⭐ 1.1 · 1.7.1 · 2.2의 사실을 **다시 인쇄하는 시트**다. 전부 같은 원천·같은 표기를 쓴다
   *    (등급·관리자 성명·연락처·선임일자·대장). 여기서 값을 새로 만들면 D-7 갈라짐이다.
   *  ⭐ 상자가 `[  ]`라 `bracketBoxCell`을 쓴다 — 표시도 `■`가 아니라 `√`(양식이 그렇게 적었다).
   *  ⚠ 안 채우는 칸은 앵커 선언부에 전부 적었다(근무인원 축 불일치·보조자·표본 문장 등).
   */
  for (const [cell, g] of REC14_GRADE_CELLS) {
    v.set(`rec14_grade_${g}`, bracketBoxCell(REC14_SHEET, cell, txt(d.grade) === g))
  }
  v.set('rec14_mgr_name', txt(d.managerName))
  v.set('rec14_mgr_date', planDate(d.managerSelectedAt))   // 1.7.1과 **같은 표기**
  v.set('rec14_mgr_phone', txt(d.managerPhone))
  // 13행은 양식이 「소방안전관리자」 블록의 첫 줄로 그려 둔 자리다 — 보조자가 아니다
  v.set('rec14_mgr_main', bracketBoxCell(REC14_SHEET, 'AG13', !!txt(d.managerName)))
  v.set('rec14_mgr_sub', bracketBoxCell(REC14_SHEET, 'AK13', false))
  v.set('rec14_brig_total', txt(String(brig.length || '')))
  v.set('rec14_brig_lead', txt(lead?.name))
  /* ── 서식 2.14 뒷쪽 참석확인 명단 ──
   *  🚨 `확인` 칸은 앵커가 **아예 없다** — 서명 자리다. 거기 무엇이든 찍으면 그 순간
   *    **참석을 단언하게 된다**(앞쪽 참석/미참석 인원을 비운 것과 같은 이유).
   *  ⚠ 직책은 `team`(1.9·2.2 구분 축)이다. `duty`는 개별임무라 직책이 아니다. */
  for (let i = 0; i < ATT14_CAPACITY; i++) {
    const m = brig[i]
    v.set(`att14_${i}_role`, txt(m?.team))
    v.set(`att14_${i}_name`, txt(m?.name))
  }
  v.set('rec14_brig_phone', formatTel(txt(lead?.phone)))

  /* ── 서식 2.3 조직도 (2026-09-17) ──────────────────────────────────────────
   *  ⭐ 대장·부대장은 2.2·1.9·2.14와 **같은 술어**(`brigadeHeads`) — 네 시트가 같은 사람.
   *  ⭐ 현장대응팀 표는 첫 행에만 건물명·대원 수 — ERP 편성표에 조직(부서) 축이 없다.
   */
  v.set('org23_lead_org', org(lead))
  v.set('org23_lead_name', txt(lead?.name))
  v.set('org23_dep_org', org(deputy))
  v.set('org23_dep_name', txt(deputy?.name))
  v.set('org23_field_org', fieldTeam.length ? txt(d.buildingName) : '')
  v.set('org23_field_n', fieldTeam.length ? String(fieldTeam.length) : '')

  for (let i = 0; i < BRIG_ROWS; i++) {
    const b = fieldTeam[i]
    v.set(`brig_f${i}_org`, org(b))
    v.set(`brig_f${i}_name`, txt(b?.name))
    v.set(`brig_f${i}_duty`, txt(b?.duty))
    v.set(`brig_f${i}_phone`, formatTel(txt(b?.phone)))
  }

  /* ── 서식 3.5 피난약자 현황·계획 (2026-09-17) ────────────────────────────────
   *
   *  🚨 ①류다 — PDF가 이미 인쇄하던 사실을 엑셀이 통째로 비워 두고 있었다.
   *  ⚠ `none === true`면 **상자를 하나도 켜지 않는다**(「해당없음」은 곧 「해당 유형이 없다」).
   *  ⚠ 시설이용자는 인원 칸이 없다 — 상자만 켠다.
   *  ⚠ 구역은 **전부 아니면 전무**로 쪼갠다(`splitAreaDongFloor`).
   */
  const vul = d.forms?.vulnerable
  const vulNone = vul?.none === true
  const vulCount = (t: string, k: 'work' | 'use') => (vulNone ? '' : txt(vul?.counts?.[t]?.[k]))
  for (const [t, box, n] of VUL_WORK_CELLS) {
    v.set(`vul_work_${t}_box`, boxLabelCell(VUL_SHEET, box, !!vulCount(t, 'work')))
    v.set(`vul_work_${t}_n`, unitCell(VUL_SHEET, n, vulCount(t, 'work')))
  }
  for (const [t, box] of VUL_USE_CELLS) {
    v.set(`vul_use_${t}_box`, boxLabelCell(VUL_SHEET, box, !!vulCount(t, 'use')))
  }
  const vulPlans = vulNone ? [] : (vul?.plans ?? [])
  for (let i = 0; i < VUL_PLAN_ROWS; i++) {
    const p = vulPlans[i] as Record<string, string> | undefined
    for (const [, key] of VUL_PLAN_COLS) v.set(`vul_plan${i}_${key}`, txt(p?.[key]))
    const split = splitAreaDongFloor(p?.area)
    v.set(`vul_plan${i}_dong`, split?.dong ?? '')
    v.set(`vul_plan${i}_floor`, split?.floor ?? '')
  }

  /* ── 서식 3.4 피난유도 절차·경로 (2026-09-17) ────────────────────────────────
   *
   *  🚨 ①류다 — PDF가 비화재보·피난경로·집결지를 이미 인쇄하는데 엑셀만 공란이었다.
   *    막고 있던 건 좌표가 아니라 **법정 예시문**이다(`isSampleTextAnchor` — 아홉째 갈래).
   *  ⭐ 집결지는 **두 칸에 같은 값**(경로표 AT10 · 집결지 블록 T13) — 한 곳만 고치면 한 장
   *    안에서 갈라진다. 그래서 값을 한 번 만들어 나눠 넣는다.
   *  ⚠ `화재 시` 네 칸·`동별`·`피난경로 개수`·`확인사항`은 비운다(앵커 §3.4 참조).
   */
  const route0 = (d.evacRoutes ?? [])[0] as Record<string, string> | undefined
  const assembly34 = txt(d.assembly)
  v.set('evac34_false_alarm', placeholderCell(EVAC34_SHEET, 'G4', d.evacFalseAlarm))
  v.set('evac34_route_text', placeholderCell(EVAC34_SHEET, 'A11', route0?.route))
  v.set('evac34_assembly_row', placeholderCell(EVAC34_SHEET, 'AT10', assembly34))
  v.set('evac34_assembly', placeholderCell(EVAC34_SHEET, 'T13', assembly34))
  for (const [, key] of EVAC34_ROUTE_COLS) v.set(`evac34_${key}`, txt(route0?.[key]))

  /* ── 서식 2.10 피난유도팀 (2026-09-18) ────────────────────────────────────
   *  값을 새로 만들지 않는다 — 절차 두 칸은 2.13(resp13_*)·3.4와 **같은 원천**
   *  (evacFalseAlarm·evacNote), 방법·집결지는 evacMethod·assembly, 경로는 evacRoutes,
   *  비상방송설비 상자는 1.4와 같은 집합(facSet). 한 워크북 안 네 시트가 갈라질 수 없다.
   */
  v.set('evac210_false_alarm', txt(d.evacFalseAlarm))
  v.set('evac210_procedure', txt(d.evacNote))
  v.set('evac210_method', txt(d.evacMethod))
  v.set('evac210_assembly', assembly34)
  v.set('evac210_broadcast', boxLabelCell(EVAC210_SHEET, 'AU6', facSet.has('비상방송설비')))
  const evRoutes = (d.evacRoutes ?? []) as Array<Record<string, string>>
  EVAC210_ROUTE_CELLS.forEach(([box], i) => {
    v.set(`evac210_route${i + 1}`, boxLabelCell(EVAC210_SHEET, box, !!evRoutes[i]))
    v.set(`evac210_route${i + 1}_text`, txt(evRoutes[i]?.route))
  })

  /* ── 서식 2.9 초기소화팀 (2026-09-18) ────────────────────────────────────
   *  예시문칸 셋은 PDF 「초기대응 개요」의 `teamTextOr(brigadeTeams, …)`와 같은 원천 —
   *  값이 없으면 예시가 남고 그 예시가 곧 PDF의 폴백 문구다(두 산출물이 같은 것을 인쇄).
   *  취약장소 3행은 1.2.2와 같은 축(hz) — 여긴 자유 기입 표라 목록 순서대로 싣는다.
   */
  const teams29 = (d.forms?.brigadeTeams ?? {}) as Record<string, string>
  v.set('ext29_method_ground', placeholderCell(EXT29_SHEET, 'AC6', teams29.extinguish))
  v.set('ext29_method_under', placeholderCell(EXT29_SHEET, 'AC7', teams29.extinguish))
  v.set('ext29_gas', placeholderCell(EXT29_SHEET, 'AC9', teams29.protect))
  HAZ29_ROWS.forEach((_, i) => {
    v.set(`haz29_${i}_place`, txt(hz[i]?.place))
    v.set(`haz29_${i}_location`, txt(hz[i]?.location))
  })

  /* ── 2.6·2.8 설비 파생 상자 + 2장 팀별 대상명 (2026-09-18) ─────────────────
   *  비상방송설비·자동화재속보설비는 설비가 자동으로 수행하는 전파라 설비 존재 = 가용
   *  (facSet — 1.4·2.10과 같은 집합). 대상명 넷은 1.4·2.13과 같은 접두라벨칸이다. */
  v.set('contact26_name', prefixCell(CONTACT26_SHEET, 'A2', d.buildingName))
  v.set('contact26_broadcast', boxLabelCell(CONTACT26_SHEET, 'Q10', facSet.has('비상방송설비')))
  v.set('contact26_autodial', boxLabelCell(CONTACT26_SHEET, 'Q13', facSet.has('자동화재속보설비')))
  v.set('alert28_broadcast', boxLabelCell(ALERT28_SHEET, 'K6', facSet.has('비상방송설비')))
  v.set('alert28_autodial', boxLabelCell(ALERT28_SHEET, 'K8', facSet.has('자동화재속보설비')))
  v.set('ext29_name', prefixCell(EXT29_SHEET, 'A2', d.buildingName))
  v.set('evac210_name', prefixCell(EVAC210_SHEET, 'A2', d.buildingName))
  v.set('rescue211_name', prefixCell(RESCUE211_SHEET, 'A2', d.buildingName))

  /* ── 서식 1.9.3 입주사 현황 (2026-09-17) ──────────────────────────────────
   *  🚨 ④ 첫 사례 — `forms.tenants` 축을 이 커밋에서 신설했다(화면·PDF·엑셀 동시).
   *  ⚠ `관리구역`은 값이 없으면 양식의 `-`를 남긴다(placeholderCell — 17행만 라벨이 없어
   *    txt로 흘린다). 빈 행의 다른 열은 그냥 빈 칸이다.
   */
  const tenants = (d.forms?.tenants ?? []) as Array<Record<string, string>>
  for (let i = 0; i < TENANT_ROWS; i++) {
    const t = tenants[i]
    for (const [col, key] of TENANT_COLS) {
      const cell = `${col}${TENANT_FIRST_ROW + i}`
      const raw = key === 'phone' ? formatTel(txt(t?.[key])) : txt(t?.[key])
      // 관리구역 3~16행은 라벨(`-`)이 있어 placeholderCell, 17행은 라벨이 없어 그대로
      v.set(`tenant_${i}_${key}`,
        key === 'zone' && isDashPlaceholderAnchor({ sheet: TENANT_SHEET, cell })
          ? placeholderCell(TENANT_SHEET, cell, raw)
          : raw)
    }
  }

  /* ── 서식 3.6 피난약자 유형별 피난 방법 (2026-09-17) ──────────────────────────
   *  3.4가 세운 **법정 예시문칸**으로 열렸다 — 네 줄이 통째로 예시문이었다.
   *  ⭐ 유형 이름은 **양식 A열 라벨**이고 ERP `vulnerableMethods`의 열쇠와 같다(사본 없음).
   *  ⚠ 양식은 4종뿐 — ERP의 `영유아`·`기타`는 갈 줄이 없어 버리되 센다.
   */
  const vmethods = (d.forms?.vulnerableMethods ?? {}) as Record<string, string>
  VUL36_ROWS.forEach(([a, k]) => {
    const t = labelAt(VUL36_SHEET, a).trim()
    v.set(`vul36_${t}`, placeholderCell(VUL36_SHEET, k, vmethods[t]))
  })

  /* ── 서식 2.13 초기대응체계 — 3절만 (2026-09-17) ──────────────────────────
   *  ⭐ 3.4와 **같은 원천**(`evacFalseAlarm`·`evacNote`) — 값을 새로 만들지 않는다.
   *  ⭐ 3.4의 「화재 시」는 네 칸 표라 비웠지만 여긴 **한 칸**이라 그대로 들어간다.
   *  ⚠ 편성·장비는 보류(앵커 §2.13) — 근무조 축이 없고 evacEquip은 3.7 축이다.
   */
  v.set('resp13_name', prefixCell(RESP13_SHEET, 'A2', d.buildingName))
  v.set('resp13_false_alarm', txt(d.evacFalseAlarm))
  v.set('resp13_fire', txt(d.evacNote))

  /* ── 서식 3.7 피난기구·유도장비 (2026-09-17) ──────────────────────────────
   *  🚨 ①류 사각지대였다 — PDF는 `evacEquip`을 인쇄 중, 엑셀만 공란.
   *  ⭐ 블록 1(완강기 예시)은 안 덮는다 — 사용방법(A5)과 쌍이다(앵커 §3.7).
   *    그래서 evacEquip[0]은 **블록 2**부터 들어간다.
   */
  const eq37 = (d.forms?.evacEquip ?? []) as Array<Record<string, string>>
  EQUIP37_ROWS.forEach((_, i) => {
    for (const [, key] of EQUIP37_COLS) v.set(`equip37_${i}_${key}`, txt(eq37[i]?.[key]))
  })

  /* ── 서식 1.6.1 기타시설 일반현황 (2026-09-17) ─────────────────────────────
   *  🚨 ①류 사각지대였다 — PDF는 `etcFacility` 전부를 인쇄 중, 엑셀은 앵커 0.
   *  ⚠ 차단기구 □유□무는 **켜기만**(boolean은 미입력과 「무」를 못 가른다 — PDF도 같은 판정).
   *  ⚠ 가스 예시 행(9행)은 값이 있으면 덮고 없으면 남는다(§1.6.1).
   */
  const etc61 = d.forms?.etcFacility
  v.set('etc61_kw', unitCell(ETC61_SHEET, 'R4', etc61?.electric?.kw))
  v.set('etc61_kva', unitCell(ETC61_SHEET, 'R5', etc61?.electric?.kva))
  v.set('etc61_loc', txt(etc61?.electric?.location))
  v.set('etc61_qty', unitCell(ETC61_SHEET, 'AZ5', etc61?.electric?.qty))
  v.set('etc61_gen_kw', unitCell(ETC61_SHEET, 'R6', etc61?.electric?.genKw))
  v.set('etc61_gen_loc', txt(etc61?.electric?.genLocation))
  v.set('etc61_gen_qty', unitCell(ETC61_SHEET, 'AZ6', etc61?.electric?.genQty))
  v.set('etc61_elec_note', txt(etc61?.electric?.note))
  v.set('etc61_gas_kind', placeholderCell(ETC61_SHEET, 'J9', etc61?.gas?.kind))
  v.set('etc61_gas_loc', placeholderCell(ETC61_SHEET, 'R9', etc61?.gas?.location))
  v.set('etc61_gas_usage', placeholderCell(ETC61_SHEET, 'AA9', etc61?.gas?.usage))
  v.set('etc61_gas_reg_loc', placeholderCell(ETC61_SHEET, 'AI9', etc61?.gas?.regulatorLocation))
  v.set('etc61_gas_shutoff', yesNoCell(ETC61_SHEET, 'AR9', etc61?.gas?.shutoff === true ? true : null))
  v.set('etc61_gas_shutoff_loc', placeholderCell(ETC61_SHEET, 'AZ9', etc61?.gas?.shutoffLocation))
  v.set('etc61_haz_none', boxLabelCell(ETC61_SHEET, 'J18', etc61?.hazmat?.none === true))
  v.set('etc61_haz_note', txt(etc61?.hazmat?.note))

  /* ── 위험물 세부 — 1.6.1 + 2.12가 **한 목록**을 나눠 쓴다 (2026-09-17) ──────
   *  `none === true`면 목록도 비운다(3.5 해당없음과 같은 규약 — 켜 두고 목록을 찍으면 모순).
   */
  const hazItems = (etc61?.hazmat?.none ? [] : (etc61?.hazmat?.items ?? [])) as Array<Record<string, string>>
  HAZ61_ROWS.forEach((_, i) => {
    for (const [, key] of HAZ61_COLS) v.set(`haz61_${i}_${key}`, txt(hazItems[i]?.[key]))
  })
  v.set('haz12_name', prefixCell(HAZ12_SHEET, 'A2', d.buildingName))
  HAZ12_ROWS.forEach((_, i) => {
    for (const [, key] of HAZ12_COLS) v.set(`haz12_${i}_${key}`, txt(hazItems[i]?.[key]))
  })

  /* ── 2.9 층별·시설별 상자 (2026-09-18 둘째) ────────────────────────────────
   *  층별은 표시 문자열(d.floors) 파싱이 아니라 **구조화 원시값**으로 판정한다 —
   *  null = 미입력 = 안 켠다(지어내지 않는다). 시설별은 1.6.1과 같은 축(etc61·hazItems)
   *  이라 여기(정의 뒤)에 둔다 — 2.9 블록에 두면 TDZ다. */
  v.set('ext29_box_high', boxLabelCell(EXT29_SHEET, 'O5', (d.floorsAbove ?? 0) >= 30))
  v.set('ext29_box_ground', boxLabelCell(EXT29_SHEET, 'O6', (d.floorsAbove ?? 0) >= 1))
  v.set('ext29_box_under', boxLabelCell(EXT29_SHEET, 'O7', (d.floorsBelow ?? 0) >= 1))
  v.set('ext29_box_electric', boxLabelCell(EXT29_SHEET, 'O8',
    !!(txt(etc61?.electric?.kw) || txt(etc61?.electric?.kva) || txt(etc61?.electric?.location))))
  v.set('ext29_box_gas', boxLabelCell(EXT29_SHEET, 'O9',
    !!(txt(etc61?.gas?.kind) || txt(etc61?.gas?.location) || txt(etc61?.gas?.usage))))
  v.set('ext29_box_hazmat', boxLabelCell(EXT29_SHEET, 'O10', hazItems.length > 0))

  // 비상반출물품 — ④ 셋째 축. locked 미입력('')이면 칸이 빈다
  const valuables12 = (d.forms?.valuables ?? []) as Array<Record<string, string>>
  VAL12_ROWS.forEach((_, i) => {
    for (const [, key] of VAL12_COLS) v.set(`val12_${i}_${key}`, txt(valuables12[i]?.[key]))
  })

  /* ── 서식 3.2 피난시설 세부현황 (2026-09-18) ────────────────────────────────
   *  🚨 사각지대 ①류 셋째 — PDF는 `evacDetail`을 인쇄 중, 엑셀만 공란이었다.
   *  ⚠ `status`는 양식에 열이 없어 버리되 센다. 시설구분 상자는 추측 금지로 안 켠다.
   */
  const evDetail = (d.forms?.evacDetail ?? []) as Array<Record<string, string>>
  for (let i = 0; i < EVDET32_ROWS; i++) {
    for (const [, key] of EVDET32_COLS) v.set(`evdet32_${i}_${key}`, txt(evDetail[i]?.[key]))
  }

  /* ── 개정이력 (2026-09-18) — 사각 ①류 넷째. PDF와 같은 `d.revisions`를 먹는다 ── */
  const revs = (d.revisions ?? []) as Array<Record<string, string>>
  for (let i = 0; i < REV_ROWS; i++) {
    for (const [, key] of REV_COLS) v.set(`rev_${i}_${key}`, txt(revs[i]?.[key]))
  }

  /* ── 서식 2.4 개별임무카드 — 성명 칸 (2026-09-18) ─────────────────────────
   *  임무 문구는 양식이 전부 인쇄해 두었다 — 사람 이름만 채운다(팀 판정은 `teamStem` 공유).
   *  대원이 여럿이면 쉼표로 잇는다 — 카드 한 장에 그 팀 전원이 실리는 서식이다.
   */
  for (const [cell, stem] of CARD24_CELLS) {
    const names = brig.filter(m => teamStem(m.team) === stem).map(m => txt(m.name)).filter(Boolean)
    v.set(`card24_${stem}`, names.join(', '))
  }

  /* ── 1.9 피난약자 블록 — **3.5의 축약본** ──
   *  같은 워크북 안에서 3.5는 인쇄하는데 1.9만 비면 그게 D-7 갈라짐이다. 상자 판정도 표 값도
   *  위와 **같은 것을 나눠 쓴다**(`vulCount` · `vulPlans` · `splitAreaDongFloor`). */
  for (const [t, cell] of VUL9_BOX_CELLS) {
    v.set(`vul9_box_${t}`, boxLabelCell(VUL9_SHEET, cell, !!vulCount(t, 'work')))
  }
  for (let i = 0; i < VUL9_ROWS; i++) {
    const p = vulPlans[i] as Record<string, string> | undefined
    v.set(`vul9_${i}_type`, txt(p?.type))
    v.set(`vul9_${i}_helper`, txt(p?.helper))
    // 활동 구역은 단위칸(`    층`) — 3.5가 쪼갠 **층 조각**만 들어간다(못 쪼개면 자구만 남는다)
    v.set(`vul9_${i}_floor`,
      unitCell(VUL9_SHEET, `H${VUL9_FIRST_ROW + i}`, splitAreaDongFloor(p?.area)?.floor ?? ''))
  }

  return v
}

/** 넘쳐서 인쇄되지 못한 구역 수 — 0이면 손실 없음. 잘린 채로도 인쇄물은 멀쩡해 보인다 */
export function zoneRowOverflow(d: FirePlanGenData): number {
  return Math.max(0, (d.zones ?? []).length - ZONE_ROWS)
}

/** 화기취급작업 표(1.12.1)가 못 담은 행 수 — 구역·대원과 같은 축(라우트가 고지에 싣는다) */
export function fireworkRowOverflow(d: FirePlanGenData): number {
  return Math.max(0, ((d.forms?.fireworkLog ?? []) as unknown[]).length - FIREWORK_ROWS)
}

/** 팀 이름의 **어간** — 양식 `비상연락팀` ↔ ERP `비상연락`·`비상연락반`.
 *  팀 구분 문자열의 단일 원천이 없어(입력 화면 둘이 다른 목록을 든다) 꼬리를 떼어 비교한다.
 *  목록을 새로 베껴 세 번째 원천을 만들지 않는다 — 2.1·1.9가 이 함수 하나를 쓴다. */
const teamStem = (s: string | undefined) => txt(s).replace(/[팀반]$/, '')

/** 대장·부대장 가르기 — **2.2와 1.9가 나눠 쓴다**(같은 사람이 두 시트에서 달리 뽑히면 안 된다).
 *  두 입력 화면의 팀 목록이 서로 다르지만 **앞 둘은 양쪽 다** `자위소방대장`·`부대장`이다. */
function brigadeHeads(brig: readonly BrigadeRow[]) {
  const lead = brig.find(b => (b.team ?? '').startsWith('자위소방대장'))
  const deputy = brig.find(b => (b.team ?? '').startsWith('부대장'))
  return { lead, deputy, rest: brig.filter(b => b !== lead && b !== deputy) }
}

/** 구역 한 줄이 내는 값 — **1.2.1과 3.3이 나눠 쓴다.**
 *
 *  ⭐ 두 시트의 머리글 자구가 글자까지 같다(`명칭/용도`·`(바닥)면적`·`관리주체(입주사)`·
 *    `담당자(연락처)`). 같은 사실을 다르게 찍으면 D-7 갈라짐이므로 **여기서 한 번만 만든다.**
 *  ⚠ `purposeShort`는 1.1 주용도와 같은 표기(사용자 승인 2026-09-08). `d.purpose`가 아니라
 *    구역 레코드의 `name`이다 — 구역마다 다를 수 있고, 근린생활시설 갈래가 아니면
 *    그대로 통과시킨다(사무실·창고 등은 손대지 않는다).
 */
function zoneRowValues(z: FirePlanGenData['zones'][number] | undefined) {
  return {
    floor: txt(z?.zone),
    usage: purposeShort(z?.name),
    area: txt(z?.area),
    company: txt(z?.managerCo),
    contact: txt(z?.contact),
  }
}

/**
 * **구역 문자열을 동·층 두 칸으로** — 3.5 피난계획 표가 그 둘을 나눠 그린다.
 *
 * ERP는 한 칸이다(입력 힌트가 `구역(동·층)`). 🚨 쪼개되 **전부 아니면 전무**로 한다:
 * 토큰이 **모두** `동`·`층`으로 끝나고 각각 하나 이하일 때만 넣고, 하나라도 남으면 `null`.
 * 조각만 넣으면 `3동 4층 로비`의 `로비`가 **조용히 사라진다** — 조용한 절단은 조용한 누락이다.
 *
 * 받는 예: `3층` · `1동 3층` · `B1층`.  물러나는 예: `로비` · `3동 4층 로비` · `1층~3층`.
 */
export function splitAreaDongFloor(area: string | undefined): { dong: string; floor: string } | null {
  const s = txt(area)
  if (!s) return { dong: '', floor: '' }
  let dong = '', floor = ''
  for (const t of s.split(/\s+/).filter(Boolean)) {
    if (t.endsWith('동') && !dong) dong = t
    else if (t.endsWith('층') && !floor) floor = t
    else return null          // 해석 못 한 토큰이 하나라도 있으면 통째로 물러난다
  }
  return { dong, floor }
}

/** 3.5 피난계획에서 **구역을 동·층으로 못 쪼갠** 행 수 — 라우트가 고지에 싣는다 */
export function vulnerableAreaUnsplit(d: FirePlanGenData): number {
  return (d.forms?.vulnerable?.plans ?? [])
    .slice(0, VUL_PLAN_ROWS)
    .filter((p: { area?: string }) => splitAreaDongFloor(p?.area) === null).length
}

/** 개정이력이 못 담은 행 수 — 양식은 연번 11행 */
export function revisionRowOverflow(d: FirePlanGenData): number {
  return Math.max(0, (d.revisions ?? []).length - REV_ROWS)
}

/** 3.2가 못 담은 행 수 + 갈 곳 없는 `상태` 값 수 — PDF는 상태를 인쇄하는데 양식엔 열이 없다 */
export function evacDetailOverflow(d: FirePlanGenData): number {
  return Math.max(0, ((d.forms?.evacDetail ?? []) as unknown[]).length - EVDET32_ROWS)
}
export function evacDetailStatusUnmapped(d: FirePlanGenData): number {
  return ((d.forms?.evacDetail ?? []) as Array<{ status?: string }>)
    .slice(0, EVDET32_ROWS).filter(r => txt(r?.status)).length
}

/** 비상반출물품(2.12)이 못 담은 행 수 — 양식 3행 */
export function valuableRowOverflow(d: FirePlanGenData): number {
  return Math.max(0, ((d.forms?.valuables ?? []) as unknown[]).length - VAL12_ROWS.length)
}

/** 위험물 세부(1.6.1·2.12 공용 3행)가 못 담은 행 수 */
export function hazmatItemOverflow(d: FirePlanGenData): number {
  const h = d.forms?.etcFacility?.hazmat
  if (h?.none) return 0
  return Math.max(0, ((h?.items ?? []) as unknown[]).length - HAZ61_ROWS.length)
}

/** 피난기구 표(3.7)가 못 담은 행 수 — 배선 블록은 3개(블록 1은 완강기 예시로 고정) */
export function equipRowOverflow(d: FirePlanGenData): number {
  return Math.max(0, ((d.forms?.evacEquip ?? []) as unknown[]).length - EQUIP37_ROWS.length)
}

/** 입주사 표(1.9.3)가 못 담은 행 수 — 양식 15행 고정 */
export function tenantRowOverflow(d: FirePlanGenData): number {
  return Math.max(0, ((d.forms?.tenants ?? []) as unknown[]).length - TENANT_ROWS)
}

/** 3.6이 못 담은 피난약자 유형 — 양식은 **4종**뿐이라 `영유아`·`기타`는 갈 줄이 없다 */
export function vulnerableMethodsUnmapped(d: FirePlanGenData): string[] {
  const m = (d.forms?.vulnerableMethods ?? {}) as Record<string, string>
  return Object.keys(m).filter(t => txt(m[t]) && !VUL36_TYPES.includes(t))
}

/** 3.4가 못 담은 피난경로 수 — 양식이 **한 줄**만 그려 두었다 */
export function evacRouteOverflow(d: FirePlanGenData): number {
  return Math.max(0, (d.evacRoutes ?? []).length - 1)
}

/** 3.5 피난계획 표가 못 담은 행 수 */
export function vulnerablePlanOverflow(d: FirePlanGenData): number {
  return Math.max(0, (d.forms?.vulnerable?.plans ?? []).length - VUL_PLAN_ROWS)
}

/** 참석확인 명단(2.14 뒷쪽)에 못 담은 대원 수 — 양식 정원은 50명이다 */
export function attendanceOverflow(d: FirePlanGenData): number {
  return Math.max(0, (d.brigade ?? []).length - ATT14_CAPACITY)
}

/** 3.3 피난인원현황이 못 담은 구역 수 — 1.2.1(8행)과 **예산이 달라** 따로 센다(19행) */
export function evac3RowOverflow(d: FirePlanGenData): number {
  return Math.max(0, (d.zones ?? []).length - EVAC3_ROWS)
}

/** 2.10 피난유도팀이 못 담은 피난경로 수 — 3.4(한 줄)와 **예산이 달라** 따로 센다(세 줄) */
export function evac210RouteOverflow(d: FirePlanGenData): number {
  return Math.max(0, (d.evacRoutes ?? []).length - EVAC210_ROUTE_CELLS.length)
}

/** 2.9 취약장소 표(3행)가 못 담은 장소 수 — 1.2.2(고정 3개소 매칭)와 축이 같고 그릇이 다르다 */
export function haz29Overflow(d: FirePlanGenData): number {
  return Math.max(0, (d.hazards ?? []).length - HAZ29_ROWS.length)
}

/** 공사·정비 기록(1.13)이 못 담은 행 수 — 화기취급과 같은 축 */
export function constructionRowOverflow(d: FirePlanGenData): number {
  return Math.max(0, ((d.forms?.constructionLog ?? []) as unknown[]).length - CONSTRUCTION_ROWS)
}

/** 1.13에서 **양식에 갈 칸이 없어 버려진** 축을 쓴 행 수 — `[대상 설비, 시공업체]` 각각.
 *
 *  🚨 넘침(`constructionRowOverflow`)과 성격이 다르다 — 저기는 「줄이 모자랐다」이고
 *    여기는 **「양식에 그 열이 아예 없다」**다. PDF는 이 둘을 인쇄하는데 엑셀은 못 하므로,
 *    말해 주지 않으면 사용자는 **엑셀이 값을 빠뜨렸다고 오해하고 손으로 적으러 간다** —
 *    이 과제가 없애려는 바로 그 행동이다.
 */
export function constructionUnmapped(d: FirePlanGenData): { facility: number; company: number } {
  const rows = ((d.forms?.constructionLog ?? []) as Array<Record<string, string>>)
    .slice(0, CONSTRUCTION_ROWS)
  const n = (k: string) => rows.filter(r => txt(r?.[k]).trim() !== '').length
  return { facility: n('facility'), company: n('company') }
}

/** 1.2.2 양식의 고정 3개소에 **맞물리지 못한** 화재취약장소 이름들.
 *
 *  🚨 구역 넘침과 성격이 다르다 — 저기는 「칸이 모자라 잘렸다」이고 여기는 **「이름이 달라
 *    어디에도 못 넣었다」**다. 사용자가 [행 추가]로 '창고'를 넣으면 양식에 그 줄이 없다.
 *    버리되 **이름을 세어서** 라우트가 고지에 싣는다 — 조용한 절단은 조용한 누락이다.
 */
export function hazardUnmatched(d: FirePlanGenData): string[] {
  const fixed = new Set(HAZARD_PLACE_ROWS.map(r => labelAt(HAZARD_SHEET, `A${r}`).trim()))
  return (d.hazards ?? []).map(h => txt(h.place)).filter(p => p && !fixed.has(p))
}

/** 현장대응팀 칸을 넘어 인쇄되지 못한 대원 수 — 구역과 같은 축(라우트가 고지 헤더에 싣는다) */
export function brigadeRowOverflow(d: FirePlanGenData): number {
  const brig = d.brigade ?? []
  const lead = brig.find(b => (b.team ?? '').startsWith('자위소방대장'))
  const deputy = brig.find(b => (b.team ?? '').startsWith('부대장'))
  return Math.max(0, brig.filter(b => b !== lead && b !== deputy).length - BRIG_ROWS)
}

/**
 * manifest의 토큰 원문에 값을 끼워 넣는다(`[ {{customer_name}} ] 소방계획서` 같은 칸).
 *
 * ⚠ 채워지지 않은 토큰이 남으면 **빈 문자열**로 지운다 — `{{contract_date}}`가 그대로
 *   인쇄되는 것이 최악이다.
 */
export function fillTemplate(sheet: string, cell: string, values: Record<string, string>): string {
  const tpl = tokenTemplateAt(sheet, cell)
  const out = tpl.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, k: string) => values[k] ?? '')
  // 값이 전부 비면 리터럴 껍데기만 남는다(`[  ] 소방계획서`). 그건 서식이므로 남긴다.
  return out.replace(/[ \t]{2,}/g, ' ').trim()
}

/* ────────────────────────── 완결성 ────────────────────────── */

/**
 * 앵커가 요구하는 필드 중 값 맵이 빠뜨린 것.
 *
 * 🚨 라우트가 이걸 보고 **500으로 끊는다**. 조용히 넘기면 그 칸만 템플릿 잔재로 남아
 *   '거의 맞는 문서'가 나가는데, 법정 서식에서 그건 틀린 문서다.
 */
export function missingValueFields(v: Map<string, CellValue>): string[] {
  return [...new Set(FIRE_PLAN_ANCHORS.map(a => a.field))].filter(f => !v.has(f))
}

export { BRIG_ROWS, ZONE_ROWS, ZONE_SHEET }
