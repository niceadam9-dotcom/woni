/** 소방계획서 엑셀 앵커 맵 — 소방계획서_42 S4.
 *
 *  갑지(`xlsx-anchors.ts`)와 **같은 규약**이다: 좌표를 쓰되 좌표만 믿지 않는다. 앵커마다
 *  라벨 셀을 하나 물려 두고, 그 셀의 실값이 기대 라벨과 다르면 주입을 아예 시작하지 않는다
 *  (법정 문서에선 조용히 붙이는 것도 조용히 버리는 것도 안 된다). 타입·`validateAnchors`·
 *  자가치유는 전부 `xlsx-anchors.ts`에서 가져온다 — **그 파일은 건드리지 않는다**(F-5).
 *
 *  ⭐ **라벨 문구를 여기에 베껴 적지 않는다.** `labelAt()`이 manifest에서 꺼낸다. 법정 자구는
 *    한 글자만 달라도 다른 문서가 되고, 베낀 쪽은 양식이 개정돼도 옛 문구를 들고 있는다.
 *    좌표가 밀리면 `labelAt`이 **모듈 적재 시점에 throw** 한다 — 라우트는 그걸 500으로 낸다.
 *
 *  좌표 원천: `scripts/build-fire-plan-template.mts`가 법정 양식 hwpx에서 뽑은 manifest.
 *  초안은 `scripts/_probe-42-anchor-draft.mts`가 `{{token}}` 56칸으로 자동 생성했고,
 *  아래 §검토 기록대로 **사람이 라벨을 보며 재승인**했다(S4-2).
 */
import type { Anchor } from '@/lib/xlsx-anchors'
import { labelAt, labelBlockRows, sheetManifest, tokenRowBudget } from '@/lib/fire-plan-xlsx-manifest'

/* ────────────────────────── 시트명 (manifest 키) ────────────────────────── */

export const FP_SHEET = {
  COVER: '표지',
  F1_1: '1.1 건축물 일반현황',
  F1_2_1: '1.2.1 구역별 세부현황',
  F1_3_ROUTE: '1.3 소방차 진입경로',
  F1_5_1: '1.5.1 피난·방화시설 현황',
  F1_7_1: '1.7.1 소방안전관리자 선임현황',
  F1_8: '1.8 업무대행 현황',
  // ⚠ manifest에 `1.11.4`로 시작하는 시트가 **둘**이다(앞쪽·뒷쪽) — 용도 칸은 앞쪽에만 있다
  F1_11_4: '1.11.4 훈련·교육 결과기록부',
  // 제2장(2026-09-08 2단계)
  F2_2: '2.2 자위소방대 편성표',
  F2_14: '2.14 교육·훈련 결과기록부',
  // 제3장(2026-09-09 B-15) — 3.1은 용도 칸만 배선한다(나머지는 별건)
  F3_1: '3.1 피난시설 일반현황',
} as const

/** 라벨은 manifest가, 좌표·필드는 여기가 — 한 곳에서만 정한다 */
type Seed = { field: string; sheet: string; cell: string; labelCell: string }

/* ══════════════════════ §검토 기록 (S4-2 재승인, 2026-09-08) ══════════════════════
 *
 *  🚨 **고친 것 1건 — `1.1!I7`**. 양식 씨앗은 이 칸에 `{{owner_phone}}`을 두고 있었다.
 *     그런데 라벨 축을 보면 `G6='소방안전관리자'` 아래 `G7='연락처'` 칸이다 —
 *     **소방안전관리자 연락처 자리에 대표자 전화가 박혀 있었다.** 씨앗을 그대로 믿었으면
 *     전 고객 문서에 남의 전화가 인쇄된다. 필드를 `manager_phone`으로 바꿔 배선한다.
 *     (양식에 `{{manager_phone}}` 토큰은 **아예 없다** — 자동 생성만으로는 나올 수 없는 앵커다.)
 *
 *  ✅ **오배정이 아니라고 판정한 것 3건** — 같은 토큰이 두 번 쓰였으나 서식이 원래 반복한다:
 *     `customer_name`(표지·1.1) · `manager_name`(1.1·1.7.1) · `receiver_location`(1.1·1.3).
 *
 *  ✅ **씨앗의 구멍 — 2026-09-08 메웠다.** 아래 자리는 양식에 `{{token}}`이 없어 자동 생성이
 *     못 보던 칸이고, 라벨 축으로 좌표를 세워 배선했다:
 *     · 1.1 대상물 급수·건축면적 · 승강기 3 · 계단 4 · 운영시간 2+2 · 인원현황 3+3 ·
 *       업무대행 2 · 다중이용업 2 · 화재보험 가입/미가입 2  (아래 §시설현황·운영현황)
 *     · 1.2.1 **9열(관리주체/입주사)**  (아래 ZONE_COLS)
 *
 *  ⚠ **여전히 안 세운 칸과 그 이유** — 없어서가 아니라 **채울 근거가 없어서**다:
 *     · 1.1 주차장·공공기관·권원분리 / 1.2.1 0열(동)·인원 4칸·다중이용업 열 → 각 선언부의 주석.
 *     · 1.15 피해 복구의 기관 연락처 행 — 스크럽이 **라벨까지** 지워(표본 지역 기관이었다)
 *       어느 행이 관할소방서였는지 자산만으로는 정할 수 없고, 인근병원은 ERP에 데이터가 없다.
 *       좌표를 추측해 세우면 엉뚱한 행에 소방서가 찍힌다. `fire_station`은 1.3에 배선돼 있다.
 *
 *  ══════════════════════ §상자칸 (2026-09-08, 방화구획) ══════════════════════
 *
 *  앵커에는 갈래가 둘이다. **값칸**은 템플릿에서 공란이고 우리가 값을 채운다. **상자칸**은
 *  법정 자구를 이고 있고(`□ 면적별` · `□유 □무`) 우리는 **상자 글자만** `■`로 갈아 끼운다.
 *  라벨을 코드에 베껴 `'■ 면적별'`을 만들지 않는 이유는 값칸과 같다 — 양식이 개정되면
 *  코드가 옛 문구를 들고 있는다. 값 축의 `stampBoxes`가 manifest 원문을 읽어 조립한다.
 *
 *  🚨 상자칸은 **백지 불변식의 예외**다. `isBoxLabelAnchor`로 자기정의하고 손목록을 두지 않는다 —
 *    목록으로 봐주기 시작하면 진짜 오염이 그 목록에 숨는다.
 */

const FIXED_SEEDS: Seed[] = [
  // ── 표지 ── 라벨로 쓸 만한 문구가 '용도' 하나뿐이다(제목 칸 자신은 공란이 된다).
  // ⚠ 필드가 `customer_name`이 **아니다**: 원문이 `[ {{customer_name}} ] 소방계획서`라 이 칸엔
  //   고객명만 넣으면 `] 소방계획서`가 통째로 사라진다. 값 축이 manifest 원문에 값을 끼워 조립한다.
  { field: 'cover_title', sheet: FP_SHEET.COVER, cell: 'A3', labelCell: 'A1' },
  // 🎯 강순기 대조가 찾아낸 칸 — 양식엔 `☐ 복합건축물`, 강순기엔 `☐ 근린생활시설`이라
  //   **용도는 고객별 값**임이 드러났다. 토큰이 없어 씨앗에는 안 잡히던 자리다(S4-2 §구멍).
  //   빌드가 라벨을 비워 상자만 남겼고, 값 축이 `☐ {용도}`로 다시 조립한다.
  { field: 'cover_purpose', sheet: FP_SHEET.COVER, cell: 'M1', labelCell: 'A1' },

  // ── 서식 1.1 건축물 일반현황 ──
  { field: 'customer_name', sheet: FP_SHEET.F1_1, cell: 'L4', labelCell: 'A4' },
  { field: 'address', sheet: FP_SHEET.F1_1, cell: 'L5', labelCell: 'A5' },
  { field: 'owner_name', sheet: FP_SHEET.F1_1, cell: 'X6', labelCell: 'L6' },
  { field: 'manager_name', sheet: FP_SHEET.F1_1, cell: 'AW6', labelCell: 'AJ6' },
  { field: 'owner_phone', sheet: FP_SHEET.F1_1, cell: 'X7', labelCell: 'L7' },
  // 🚨 씨앗은 `{{owner_phone}}`이었다 — §검토 기록 참조
  { field: 'manager_phone', sheet: FP_SHEET.F1_1, cell: 'AW7', labelCell: 'AJ7' },
  { field: 'receiver_location', sheet: FP_SHEET.F1_1, cell: 'L8', labelCell: 'D8' },
  { field: 'purpose', sheet: FP_SHEET.F1_1, cell: 'AJ9', labelCell: 'AB9' },
  { field: 'use_approval_date', sheet: FP_SHEET.F1_1, cell: 'BA9', labelCell: 'AS9' },
  { field: 'total_area', sheet: FP_SHEET.F1_1, cell: 'T10', labelCell: 'L10' },
  { field: 'floors', sheet: FP_SHEET.F1_1, cell: 'BA10', labelCell: 'AS10' },
  { field: 'height', sheet: FP_SHEET.F1_1, cell: 'T11', labelCell: 'L11' },
  { field: 'main_structure', sheet: FP_SHEET.F1_1, cell: 'AJ11', labelCell: 'AB11' },
  { field: 'roof_structure', sheet: FP_SHEET.F1_1, cell: 'BA11', labelCell: 'AS11' },
  // 보험 4칸은 왼쪽이 병합이라 라벨이 **위**에 있다
  { field: 'insurance_company', sheet: FP_SHEET.F1_1, cell: 'L26', labelCell: 'L25' },
  { field: 'insurance_period', sheet: FP_SHEET.F1_1, cell: 'AB26', labelCell: 'AB25' },
  { field: 'insurance_amount_person', sheet: FP_SHEET.F1_1, cell: 'AW26', labelCell: 'AS26' },
  { field: 'insurance_amount_property', sheet: FP_SHEET.F1_1, cell: 'AW27', labelCell: 'AS27' },

  /* ── 서식 1.1 §시설현황·운영현황 (2026-09-08, S4-2 §구멍 메우기) ──────────────────
   *
   *  씨앗(`{{token}}`)이 없어 자동 생성에 안 잡히던 자리다. 라벨 축으로 좌표를 세웠고,
   *  갈래는 셋이다 — **단위칸**(`급`·`㎡`·` 명`처럼 자구가 값 뒤에 붙는다) · **상자칸**
   *  (`☐ 승용`) · **값칸**(공란).
   *
   *  ⚠ **데이터가 없어 일부러 안 세운 앵커**(조용히 넘기지 않는다):
   *    · 주차장 4칸(옥내·옥외·자주식·기계식)과 전기차충전소 — ERP에 주차장 입력 축이 없다.
   *    · 공공기관·권원분리 — 판정할 데이터가 없다. 미입력이면 빈 상자가 정답이다.
   *    · 승강기 대수·계단 개소 — 양식에 그 숫자를 적을 자리가 없다. 상자만 체크한다
   *      (PDF는 HTML이라 `(3대)`를 덧붙이지만, 법정 서식 칸에 없는 글자를 넣지 않는다).
   */
  // 규모/구조 — `대상물 급수` 뒤의 `급`, `건축면적` 뒤의 `㎡`가 그 칸의 자구다
  { field: 'grade', sheet: FP_SHEET.F1_1, cell: 'T9', labelCell: 'L9' },
  { field: 'building_area', sheet: FP_SHEET.F1_1, cell: 'AJ10', labelCell: 'AB10' },
  // 승강기 3종 · 계단 4종 — 상자칸
  { field: 'elevator_passenger', sheet: FP_SHEET.F1_1, cell: 'L12', labelCell: 'D12' },
  { field: 'elevator_emergency', sheet: FP_SHEET.F1_1, cell: 'AB12', labelCell: 'D12' },
  { field: 'elevator_evac', sheet: FP_SHEET.F1_1, cell: 'AS12', labelCell: 'D12' },
  { field: 'stair_special', sheet: FP_SHEET.F1_1, cell: 'L15', labelCell: 'D15' },
  { field: 'stair_direct', sheet: FP_SHEET.F1_1, cell: 'AJ15', labelCell: 'D15' },
  { field: 'stair_escape', sheet: FP_SHEET.F1_1, cell: 'L16', labelCell: 'D15' },
  { field: 'stair_outdoor', sheet: FP_SHEET.F1_1, cell: 'AJ16', labelCell: 'D15' },
  // 운영시간 — 상자는 평일·휴일만 켠다. ⚠ 주간/야간은 켜지 않는다: ERP는 평일·휴일에 각
  //   **한 값**만 저장해 어느 쪽 시간인지 모른다. 시간 글자는 주간 줄의 빈칸에 싣는다
  //   (미입력과 '야간 아님'은 다르다 — 모르는 것을 단정하지 않는 S5 규약).
  { field: 'ophours_weekday', sheet: FP_SHEET.F1_1, cell: 'L17', labelCell: 'D17' },
  { field: 'ophours_weekday_time', sheet: FP_SHEET.F1_1, cell: 'AB17', labelCell: 'D17' },
  { field: 'ophours_holiday', sheet: FP_SHEET.F1_1, cell: 'AJ17', labelCell: 'D17' },
  { field: 'ophours_holiday_time', sheet: FP_SHEET.F1_1, cell: 'BA17', labelCell: 'D17' },
  // 인원현황 — 상자 3 + 단위칸 3. 🎯 J19는 표본 고객의 답 `100명`을 이고 있던 자리다
  //   (형제 칸 D19·G19는 ` 명`인데 이 칸만 값이 있었다 — 빌드의 규칙 축이 걷어냈다)
  { field: 'headcount_worker_on', sheet: FP_SHEET.F1_1, cell: 'L19', labelCell: 'D19' },
  { field: 'headcount_worker', sheet: FP_SHEET.F1_1, cell: 'T19', labelCell: 'D19' },
  { field: 'headcount_resident_on', sheet: FP_SHEET.F1_1, cell: 'AB19', labelCell: 'D19' },
  { field: 'headcount_resident', sheet: FP_SHEET.F1_1, cell: 'AJ19', labelCell: 'D19' },
  { field: 'headcount_max_on', sheet: FP_SHEET.F1_1, cell: 'AS19', labelCell: 'D19' },
  { field: 'headcount_max', sheet: FP_SHEET.F1_1, cell: 'BA19', labelCell: 'D19' },
  // 업무대행 · 다중이용업 · 화재보험 — 「해당 / 해당없음」이 **두 칸**이라 각각 앵커를 문다
  { field: 'agency_yes', sheet: FP_SHEET.F1_1, cell: 'L21', labelCell: 'D21' },
  { field: 'agency_no', sheet: FP_SHEET.F1_1, cell: 'AJ21', labelCell: 'D21' },
  { field: 'multiuse_yes', sheet: FP_SHEET.F1_1, cell: 'L23', labelCell: 'D23' },
  { field: 'multiuse_no', sheet: FP_SHEET.F1_1, cell: 'AJ23', labelCell: 'D23' },
  { field: 'insurance_yes', sheet: FP_SHEET.F1_1, cell: 'L24', labelCell: 'A24' },
  { field: 'insurance_no', sheet: FP_SHEET.F1_1, cell: 'AJ24', labelCell: 'A24' },

  // ── 서식 1.3 소방차 진입경로 ── 서식이 수신기 위치를 두 곳에 반복한다(같은 값·같은 필드)
  { field: 'receiver_location', sheet: FP_SHEET.F1_3_ROUTE, cell: 'AW3', labelCell: 'AK3' },
  { field: 'fire_station', sheet: FP_SHEET.F1_3_ROUTE, cell: 'P5', labelCell: 'G5' },

  // ── 서식 1.5.1 방화구획 ── **라벨동반 상자칸**(§상자칸 참조). 다른 앵커와 달리 템플릿에서
  //   공란이 아니라 법정 자구(`□ 면적별`)를 이고 있다 — 값 축이 상자 글자만 갈아 끼운다.
  //   ⚠ `J14 □ 용도별`은 배선하지 않는다: ERP 입력에 그 갈래가 없으므로 늘 미체크가 맞다.
  { field: 'compartment_applies', sheet: FP_SHEET.F1_5_1, cell: 'H15', labelCell: 'H14' },
  { field: 'compartment_area', sheet: FP_SHEET.F1_5_1, cell: 'P14', labelCell: 'A14' },
  { field: 'compartment_floor', sheet: FP_SHEET.F1_5_1, cell: 'AE14', labelCell: 'A14' },

  // ── 서식 1.7.1 선임현황 ── 왼쪽 칸(B4)은 공백 한 칸뿐이라 **열 머리**를 라벨로 쓴다
  { field: 'manager_name', sheet: FP_SHEET.F1_7_1, cell: 'V4', labelCell: 'V3' },
  { field: 'manager_selected_date', sheet: FP_SHEET.F1_7_1, cell: 'AE4', labelCell: 'AE3' },

  // ── 서식 1.8 업무대행 ── 원문이 `{{contract_date}} ~ ` 라 값 함수가 물결표까지 조립한다
  { field: 'agency_contract_period', sheet: FP_SHEET.F1_8, cell: 'U10', labelCell: 'K10' },

  /* ── 서식 2.2 자위소방대 편성표 · 지휘통제팀 (2단계 · Q-1 자동 채움) ─────────────
   *  양식 씨앗이 이 두 줄에만 토큰을 두었다(`{{brig_l_*}}`·`{{brig_d_*}}`).
   *  ⚠ 소속 칸을 `customer_name` 필드로 잇지 않는다 — 그러면 대원이 없는 줄에도 건물명이
   *    찍혀 **이름 없는 소속**이 인쇄된다. 대원이 있을 때만 채우도록 별도 필드로 둔다.
   */
  { field: 'brig_lead_org', sheet: FP_SHEET.F2_2, cell: 'N5', labelCell: 'F5' },
  { field: 'brig_lead_name', sheet: FP_SHEET.F2_2, cell: 'X5', labelCell: 'F5' },
  { field: 'brig_lead_duty', sheet: FP_SHEET.F2_2, cell: 'AG5', labelCell: 'F5' },
  { field: 'brig_lead_phone', sheet: FP_SHEET.F2_2, cell: 'AZ5', labelCell: 'F5' },
  { field: 'brig_dep_org', sheet: FP_SHEET.F2_2, cell: 'N6', labelCell: 'F6' },
  { field: 'brig_dep_name', sheet: FP_SHEET.F2_2, cell: 'X6', labelCell: 'F6' },
  { field: 'brig_dep_duty', sheet: FP_SHEET.F2_2, cell: 'AG6', labelCell: 'F6' },
  { field: 'brig_dep_phone', sheet: FP_SHEET.F2_2, cell: 'AZ6', labelCell: 'F6' },

  // ── 서식 2.14 결과기록부 ── 별지 제13호서식의 「대상명」. 씨앗이 여기에도 고객명을 둔다
  { field: 'customer_name', sheet: FP_SHEET.F2_14, cell: 'R6', labelCell: 'J6' },

  /* ── 용도 두 칸 (2026-09-09 · 47 B-15) ─────────────────────────────────────
   *  납품본(강순기)에는 이 두 칸에 「근린생활시설」이 적혀 있는데 ERP는 **미배선이라 공란**으로
   *  나가고 있었다. 씨앗(`{{token}}`)이 없어 자동 생성이 못 보던 자리라 §구멍과 같은 갈래다 —
   *  좌표는 **라벨 축**으로 세웠다(둘 다 라벨 문구가 「용도」, 값 칸은 그 오른쪽 병합칸).
   *
   *  · 3.1     `AU4='용도'` → 값칸 `AY4`(AY4:BH4 병합, 템플릿 공란)
   *  · 1.11.4  `AR5='용도'` → 값칸 `AZ5`(AZ5:BH5 병합, 템플릿 공란) — `AR6='전화번호'`가 아래에
   *            있어 행이 밀리면 그 자구가 라벨 대조에서 곧바로 붉어진다.
   *
   *  ⚠ 필드가 `purpose`가 **아니다**. 1.1·1.2.1은 칸이 좁아 `근생`으로 줄여 적고(D-4) 이 두 칸은
   *    `근린생활시설`이다 — 한 필드로 묶으면 **같은 값이 두 표기를 가질 수 없어** 한쪽이 틀린다.
   */
  { field: 'purpose_full', sheet: FP_SHEET.F3_1, cell: 'AY4', labelCell: 'AU4' },
  { field: 'purpose_full', sheet: FP_SHEET.F1_11_4, cell: 'AZ5', labelCell: 'AR5' },
]

/* ══════════════════ 2.2 편성표 「현장대응팀」 — 반복 행 ══════════════════
 *
 *  대장·부대장을 뺀 나머지 대원이 들어가는 구간이다. 씨앗에 토큰이 없고 0열에 번호도 없어
 *  `tokenRowBudget`·`numberedRuns` 둘 다 쓸 수 없다 — **라벨 블록**으로 센다:
 *  `A9='현장대응팀'` 부터 다음 A열 라벨(`A23='초기대응체계'`) 직전까지 = 14행.
 *  어느 쪽이든 규약은 같다: **행 수를 코드에 적지 않는다**(S4-3).
 */
export const BRIG_SHEET = FP_SHEET.F2_2
/** 블록 머리 = 「현장대응팀」 라벨 행. 이 한 좌표만 적고 행 수는 아래에서 파생시킨다 */
export const BRIG_FIRST_ROW = 9
export const BRIG_ROWS = labelBlockRows(BRIG_SHEET, `A${BRIG_FIRST_ROW}`)

/** 현장대응팀 행에서 배선한 열 — [엑셀 열, 필드 접미사] (라벨은 블록 머리 A9 하나를 함께 문다) */
/* ⚠ 미세 격자 전환(소방계획서_47 Q-9)으로 열 문자가 옮겨졌다. 계산형 앵커는 행 번호와
 *   조합해 주소를 만들므로 좌표 치환기가 못 옮긴다 — 사상표(`_47-colmap.mts`)로 손수 옮겼다.
 *   옛 격자: C·D·F·H (8열) → 새 격자: N·X·AG·AZ (60열) */
const BRIG_COLS: ReadonlyArray<readonly [string, string]> = [
  ['N', 'org'],    // 소속        (옛 C)
  ['X', 'name'],   // 성명        (옛 D)
  ['AG', 'duty'],  // 개별임무     (옛 F)
  ['AZ', 'phone'], // 비상연락체계(개인) (옛 H)
]

const BRIG_SEEDS: Seed[] = Array.from({ length: BRIG_ROWS }, (_, i) =>
  BRIG_COLS.map(([col, key]) => ({
    field: `brig_f${i}_${key}`,
    sheet: BRIG_SHEET,
    cell: `${col}${BRIG_FIRST_ROW + i}`,
    labelCell: `A${BRIG_FIRST_ROW}`,
  })),
).flat()

/* ══════════════════════ 1.2.1 구역별 세부현황 — 반복 행 ══════════════════════
 *
 *  S4-3: **양식 고정 행 수**를 지킨다. 서버가 행을 늘리면 납품 서식이 아니게 되고, 계획서는
 *  파일을 저장하지 않으므로 사용자가 엑셀에서 행을 끼워 넣어도 ERP가 되읽지 않는다 —
 *  고정 좌표는 **생성 시점에만** 유효하면 된다.
 *
 *  ⭐ 행 수를 손으로 `8`이라 적지 않는다. manifest의 토큰 씨앗에서 **센다**
 *  (`DEFECT_GROUP_ROWS`가 목록을 파생시키는 것과 같은 규약). 양식이 9행으로 늘면 여기도 는다.
 */
export const ZONE_SHEET = FP_SHEET.F1_2_1
export const ZONE_ROWS = tokenRowBudget(ZONE_SHEET, 'zone')

/** 구역 표의 첫 데이터 행(1-based 엑셀 행) — manifest의 토큰 좌표에서 파생 */
export const ZONE_FIRST_ROW = (() => {
  const cells = Object.keys(sheetManifest(ZONE_SHEET).tokenCells)
  const rows = cells.map(r => Number(/\d+$/.exec(r)?.[0] ?? 0)).filter(Boolean)
  if (!rows.length) throw new Error('fire-plan-anchors: 1.2.1 구역 토큰 칸이 없다 — 좌표를 파생할 수 없다')
  return Math.min(...rows)
})()

/** 구역 표에서 배선된 열 — [엑셀 열, 필드 접미사, 열 머리 라벨 셀] */
/* ⚠ 미세 격자 전환(Q-9)으로 열 문자가 옮겨졌다 — 옛 B·C·D·J·K(12열) → 새 D·H·O·AL·AR(60열).
 *   라벨 셀은 좌표 치환기가 이미 옮겼으므로 여기서도 같은 사상을 쓴다. */
const ZONE_COLS: ReadonlyArray<readonly [string, string, string]> = [
  ['D', 'floor', 'D6'],    // 층                 (옛 B / B6)
  ['H', 'usage', 'H4'],    // 명칭/용도           (옛 C / C4)
  ['O', 'area', 'O4'],     // (바닥)면적          (옛 D / D4)
  ['AL', 'company', 'AL4'], // 관리주체(입주사)    (옛 J / J4)
  ['AR', 'contact', 'AR4'], // 담당자 (연락처)     (옛 K / K4)
]

/* ⚠ 이 표에서 **일부러 안 세운 열**(S4-2 §구멍의 나머지):
 *   · A열 `동` — `ZoneRow`에 동 필드가 없다. `zone` 한 칸이 동/층을 겸하고 그것을 B(층)에 싣는다.
 *     동을 따로 채우려면 입력 축을 쪼개야 하고 그건 화면·저장 구조 변경이라 이 작업 범위 밖이다.
 *   · E~I열 `근무자 및 거주자 (평일 주간/야간 · 휴일 주간/야간)` — 양식은 네 칸인데 ERP는
 *     평일·휴일에 각 **한 값**만 저장한다(`workersWeekday`·`workersHoliday`). 어느 것이 주간인지
 *     모르는 채 넷 중 하나에 넣으면 **모르는 것을 단정하는 것**이라 비워 둔다.
 *   · L열 `다중이용업 해당시 √` — 구역별 다중이용업 여부는 입력 축이 없다(1.10.3은 건물 단위).
 */

const ZONE_SEEDS: Seed[] = Array.from({ length: ZONE_ROWS }, (_, i) =>
  ZONE_COLS.map(([col, key, labelCell]) => ({
    field: `zone_${i}_${key}`,
    sheet: ZONE_SHEET,
    cell: `${col}${ZONE_FIRST_ROW + i}`,
    labelCell,
  })),
).flat()

/* ══════════════════════ 조립 ══════════════════════ */

/**
 * 🚨 **한 칸에 앵커는 하나**. 둘이 붙으면 뒤엣것이 앞엣것을 덮어 어느 값이 인쇄되는지가
 * 배열 순서에 달리게 된다 — 조용한 오적용이다.
 *
 * 반대로 **같은 필드가 여러 칸에 붙는 것은 정상**이다. `toInjectTargets`는 필드로 값을 찾으므로
 * 한 값이 여러 칸에 간다 — 서식이 실제로 명칭·소방안전관리자·수신기 위치를 두 곳에 반복해
 * 적게 돼 있고, 그 칸들이 갈라지면 그게 결함이다.
 */
function assemble(seeds: Seed[]): Anchor[] {
  const seen = new Set<string>()
  return seeds.map(s => {
    const key = `${s.sheet}!${s.cell}`
    if (seen.has(key)) throw new Error(`fire-plan-anchors: 같은 칸에 앵커가 둘 — ${key}`)
    seen.add(key)
    return { field: s.field, sheet: s.sheet, cell: s.cell, labelCell: s.labelCell, label: labelAt(s.sheet, s.labelCell) }
  })
}

export const FIRE_PLAN_ANCHORS: Anchor[] = assemble([...FIXED_SEEDS, ...ZONE_SEEDS, ...BRIG_SEEDS])

/**
 * **라벨동반 상자칸인가**(§상자칸) — 그 칸의 manifest 라벨이 빈 상자를 품고 있는가.
 *
 * 백지 불변식('앵커 칸은 템플릿에서 공란')이 이 갈래만 예외로 둔다. 예외를 좌표 목록으로 적으면
 * 나중에 진짜 오염이 그 목록 뒤에 숨으므로, **'상자를 가진 라벨 칸인가'** 로 자기정의한다.
 */
export function isBoxLabelAnchor(a: { sheet: string; cell: string }): boolean {
  const lbl = sheetManifest(a.sheet).labels[a.cell]
  return !!lbl && /[□☐]/.test(lbl)
}

/**
 * **단위칸인가**(§단위칸) — 그 칸의 자구가 `급`·`㎡`·`명` 같은 **한두 글자 단위**뿐인가.
 *
 * 상자칸과 함께 백지 불변식의 예외를 이룬다. 여기서 규칙을 좁게 잡는 것이 핵심이다 —
 * `셀 글자 == manifest 라벨`은 **항진명제**이므로(manifest 라벨이 자산에서 파생된다) 예외의
 * 판별을 그 등식에 맡길 수 없다. 대신 **'남은 글자가 단위처럼 생겼는가'**를 묻는다:
 * 숫자·괄호·공백 섞인 자유 텍스트는 통과하지 못하므로 표본 답이 이 예외 뒤에 숨지 못한다
 * (실제로 이 칸들에 `100명`·`1 개소`가 남아 있었고, 빌드의 규칙 축이 걷어냈다).
 */
export function isUnitLabelAnchor(a: { sheet: string; cell: string }): boolean {
  const lbl = sheetManifest(a.sheet).labels[a.cell]
  return !!lbl && /^[가-힣㎡]{1,2}$/.test(lbl.trim())
}

/** 값 맵이 반드시 채워야 하는 필드 전수(중복 제거) — S7-2 완결성 검사와 S5가 같은 목록을 본다 */
export const FIRE_PLAN_FIELDS: string[] = [...new Set(FIRE_PLAN_ANCHORS.map(a => a.field))]
