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
import type { FirePlanGenData } from '@/lib/fire-plan-template'
import { FIRE_PLAN_ANCHORS, ZONE_ROWS, ZONE_SHEET } from '@/lib/fire-plan-anchors'
import { boxGlyphAt, tokenTemplateAt } from '@/lib/fire-plan-xlsx-manifest'

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
  v.set('cover_purpose', checkCell('표지', 'B1', false, txt(d.purpose)))

  // ── 서식 1.1 ──
  v.set('customer_name', txt(d.buildingName))
  v.set('address', txt(d.address))
  v.set('owner_name', txt(d.ownerName))
  v.set('owner_phone', txt(d.ownerPhone))
  v.set('manager_name', txt(d.managerName))
  // 🚨 양식 씨앗이 이 칸에 대표자 전화를 물려 두었던 자리다(R-1) — 소방안전관리자 전화가 맞다
  v.set('manager_phone', txt(d.managerPhone))
  v.set('receiver_location', txt(d.receiverLocation))
  v.set('purpose', txt(d.purpose))
  v.set('use_approval_date', planDate(d.useApprovalDate))
  v.set('total_area', txt(d.totalArea))
  v.set('floors', txt(d.floors))
  v.set('height', txt(d.height))
  v.set('main_structure', txt(d.structure))
  v.set('roof_structure', txt(d.roof))

  // 화재보험 — `ops`는 v2 확장이라 없을 수 있다(하위 호환). 미가입이면 네 칸을 **모두 비운다**:
  // 한 칸이라도 남으면 '미가입인데 보험사가 적힌' 문서가 나간다(체크 축과 값 축이 갈라지는 자리).
  // ⚠ `insuranceJoined`는 `null`(미입력)일 수 있다 — 그때는 값이 있으면 가입으로 본다.
  const ins = d.ops
  const joined = ins?.insuranceJoined ?? !!txt(ins?.insuranceCompany)
  v.set('insurance_company', joined ? txt(ins?.insuranceCompany) : '')
  v.set('insurance_period', joined ? txt(ins?.insurancePeriod) : '')
  v.set('insurance_amount_person', joined ? txt(ins?.insuranceAmountPerson) : '')
  v.set('insurance_amount_property', joined ? txt(ins?.insuranceAmountProperty) : '')

  // ── 서식 1.3 소방차 진입경로 ──
  v.set('fire_station', txt(d.fireStation))

  // ── 서식 1.7.1 선임현황 ──
  v.set('manager_selected_date', planDate(d.managerSelectedAt))

  // ── 서식 1.8 업무대행 계약기간 ──
  // 원문이 `{{contract_date}} ~ ` 라 물결표까지 한 칸에 있다. 리터럴을 손으로 베끼지 않고
  // manifest의 원본 문자열에 값을 끼워 넣는다 — 서식이 바뀌면 여기가 아니라 manifest가 바뀐다.
  v.set('agency_contract_period', fillTemplate('1.8 업무대행 현황', 'C10', { contract_date: planDate(d.contractStart) }))

  // ── 서식 1.2.1 구역별 세부현황 ──
  // S4-3: 양식 고정 행 수를 지킨다. 넘치는 구역은 **버리되 세어서** 라우트가 고지 헤더에 싣는다.
  const zones = d.zones ?? []
  for (let i = 0; i < ZONE_ROWS; i++) {
    const z = zones[i]
    v.set(`zone_${i}_floor`, txt(z?.zone))
    v.set(`zone_${i}_usage`, txt(z?.name))
    v.set(`zone_${i}_area`, txt(z?.area))
    v.set(`zone_${i}_contact`, txt(z?.contact))
  }

  return v
}

/** 넘쳐서 인쇄되지 못한 구역 수 — 0이면 손실 없음. 잘린 채로도 인쇄물은 멀쩡해 보인다 */
export function zoneRowOverflow(d: FirePlanGenData): number {
  return Math.max(0, (d.zones ?? []).length - ZONE_ROWS)
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

export { ZONE_ROWS, ZONE_SHEET }
