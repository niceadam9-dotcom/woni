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
import { BRIG_ROWS, FIRE_PLAN_ANCHORS, FP_SHEET, ZONE_ROWS, ZONE_SHEET } from '@/lib/fire-plan-anchors'
import { boxGlyphAt, labelAt, tokenTemplateAt } from '@/lib/fire-plan-xlsx-manifest'
import { purposeCover, purposeShort } from '@/lib/purpose-label'
import { compartmentApplies, compartmentHasArea, compartmentHasFloor } from '@/lib/evac-compartment'
import { isMultiUseApplicable, isMultiUseNone } from '@/lib/multi-use'

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

/** 유·무가 한 칸인 칸(`□유 □무`). `null`(미입력)이면 **둘 다** 비운다 — 미입력과 '무'는 다르다 */
export function yesNoCell(sheet: string, cell: string, yes: boolean | null): string {
  return stampBoxes(sheet, cell, i => (i === 0 ? yes === true : i === 1 ? yes === false : false))
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
  v.set('elevator_evac', boxLabelCell(FP_SHEET.F1_1, 'AS12', !!txt(el?.evac)))

  // 계단 — `stairs`는 '종류 → 개소' 지도이고 `''`가 미설치다(plan-form15.tsx). 양식 1.1에는
  //   개소를 적을 자리가 없어 **상자만** 켠다(개소는 서식 1.5.1이 받는다).
  const stairs = d.forms?.evacFire?.stairs
  const hasStair = (kind: string) => !!txt(stairs?.[kind])
  v.set('stair_special', boxLabelCell(FP_SHEET.F1_1, 'L15', hasStair('특별피난계단')))
  v.set('stair_direct', boxLabelCell(FP_SHEET.F1_1, 'AJ15', hasStair('직통계단')))
  v.set('stair_escape', boxLabelCell(FP_SHEET.F1_1, 'L16', hasStair('피난계단')))
  v.set('stair_outdoor', boxLabelCell(FP_SHEET.F1_1, 'AJ16', hasStair('옥외계단')))

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
  v.set('headcount_max_on', boxLabelCell(FP_SHEET.F1_1, 'AS19', !!hcMax))
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

  // ── 서식 1.2.1 구역별 세부현황 ──
  // S4-3: 양식 고정 행 수를 지킨다. 넘치는 구역은 **버리되 세어서** 라우트가 고지 헤더에 싣는다.
  const zones = d.zones ?? []
  for (let i = 0; i < ZONE_ROWS; i++) {
    const z = zones[i]
    v.set(`zone_${i}_floor`, txt(z?.zone))
    // 1.1 주용도와 **같은 성격의 칸**이라 같은 표기를 쓴다(사용자 승인 2026-09-08).
    // ⚠ `d.purpose`가 아니라 구역 레코드의 `name`이다 — 구역마다 다를 수 있고, 근린생활시설
    //   갈래가 아니면 `purposeShort`가 그대로 통과시킨다(사무실·창고 등은 손대지 않는다).
    v.set(`zone_${i}_usage`, purposeShort(z?.name))
    v.set(`zone_${i}_area`, txt(z?.area))
    v.set(`zone_${i}_company`, txt(z?.managerCo))
    v.set(`zone_${i}_contact`, txt(z?.contact))
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
  const lead = brig.find(b => (b.team ?? '').startsWith('자위소방대장'))
  const deputy = brig.find(b => (b.team ?? '').startsWith('부대장'))
  const fieldTeam = brig.filter(b => b !== lead && b !== deputy)
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

  for (let i = 0; i < BRIG_ROWS; i++) {
    const b = fieldTeam[i]
    v.set(`brig_f${i}_org`, org(b))
    v.set(`brig_f${i}_name`, txt(b?.name))
    v.set(`brig_f${i}_duty`, txt(b?.duty))
    v.set(`brig_f${i}_phone`, formatTel(txt(b?.phone)))
  }

  return v
}

/** 넘쳐서 인쇄되지 못한 구역 수 — 0이면 손실 없음. 잘린 채로도 인쇄물은 멀쩡해 보인다 */
export function zoneRowOverflow(d: FirePlanGenData): number {
  return Math.max(0, (d.zones ?? []).length - ZONE_ROWS)
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
