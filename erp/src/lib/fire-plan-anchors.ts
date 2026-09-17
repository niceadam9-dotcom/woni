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
import { labelAt, labelBlockRows, numberedRowBudget, sheetManifest, tokenRowBudget } from '@/lib/fire-plan-xlsx-manifest'
import { ALL_STANDARD_CODES } from '@/lib/facility-codes'
import { LOCATION_BOX_KINDS } from '@/lib/fire-plan-image-kinds'

/* ────────────────────────── 시트명 (manifest 키) ────────────────────────── */

export const FP_SHEET = {
  COVER: '표지',
  F1_1: '1.1 건축물 일반현황',
  F1_2_1: '1.2.1 구역별 세부현황',
  F1_3_ROUTE: '1.3 소방차 진입경로',
  // 사진·도면 상자만 있는 시트 둘 — 값 앵커는 아직 없다(§사진상자 참조)
  F1_3_LOC: '1.3 건축물 위치·운영현황',
  F1_4: '1.4 소방시설 현황',
  F1_5_1: '1.5.1 피난·방화시설 현황',
  F1_5_2: '1.5.2 방화·제연구획 현황도',
  F1_7_1: '1.7.1 소방안전관리자 선임현황',
  F1_8: '1.8 업무대행 현황',
  F1_10_1: '1.10.1 연간 점검 계획',
  // 2026-09-16~17 — PDF는 이미 인쇄하는데 엑셀만 공란이던 시트들(소방계획서_50 §5-3이 마커로 확정)
  F1_2_2: '1.2.2 화재취약장소 현황',
  F1_10_3: '1.10.3 다중이용업소 관리현황',
  F1_10_4: '1.10.4 화재·비화재보 이력',
  F1_11_1: '1.11.1 소방훈련·교육 연간계획',
  F1_12_1: '1.12.1 화기취급작업 현황',
  F1_13: '1.13 소방시설 공사·정비 기록',
  F3_3: '3.3 피난인원현황',
  F1_9: '1.9 자위소방대 현황',
  // ⚠ manifest에 `1.11.4`로 시작하는 시트가 **둘**이다(앞쪽·뒷쪽) — 용도 칸은 앞쪽에만 있다
  F1_11_4: '1.11.4 훈련·교육 결과기록부',
  // 제2장(2026-09-08 2단계)
  F2_1: '2.1 자위소방대 일반현황',
  F2_2: '2.2 자위소방대 편성표',
  F2_3: '2.3 조직도',
  F2_14: '2.14 교육·훈련 결과기록부',
  F2_14_BACK: '2.14 결과기록부 뒷쪽',
  // 제3장(2026-09-09 B-15) — 3.1은 용도 칸만 배선한다(나머지는 별건)
  F3_1: '3.1 피난시설 일반현황',
  F3_4: '3.4 피난유도 절차·경로',
  F3_5: '3.5 피난약자 현황·계획',
  F3_6: '3.6 피난약자 유형별 방법',
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
  { field: 'use_approval_date', sheet: FP_SHEET.F1_1, cell: 'BA9', labelCell: 'AR9' },
  { field: 'total_area', sheet: FP_SHEET.F1_1, cell: 'T10', labelCell: 'L10' },
  { field: 'floors', sheet: FP_SHEET.F1_1, cell: 'BA10', labelCell: 'AR10' },
  { field: 'height', sheet: FP_SHEET.F1_1, cell: 'T11', labelCell: 'L11' },
  { field: 'main_structure', sheet: FP_SHEET.F1_1, cell: 'AJ11', labelCell: 'AB11' },
  { field: 'roof_structure', sheet: FP_SHEET.F1_1, cell: 'BA11', labelCell: 'AR11' },
  // 보험 4칸은 왼쪽이 병합이라 라벨이 **위**에 있다
  { field: 'insurance_company', sheet: FP_SHEET.F1_1, cell: 'L26', labelCell: 'L25' },
  { field: 'insurance_period', sheet: FP_SHEET.F1_1, cell: 'AB26', labelCell: 'AB25' },
  { field: 'insurance_amount_person', sheet: FP_SHEET.F1_1, cell: 'AW26', labelCell: 'AR26' },
  { field: 'insurance_amount_property', sheet: FP_SHEET.F1_1, cell: 'AW27', labelCell: 'AR27' },

  /* ── 서식 1.1 §시설현황·운영현황 (2026-09-08, S4-2 §구멍 메우기) ──────────────────
   *
   *  씨앗(`{{token}}`)이 없어 자동 생성에 안 잡히던 자리다. 라벨 축으로 좌표를 세웠고,
   *  갈래는 셋이다 — **단위칸**(`급`·`㎡`·` 명`처럼 자구가 값 뒤에 붙는다) · **상자칸**
   *  (`☐ 승용`) · **값칸**(공란).
   *
   *  ⚠ **데이터가 없어 일부러 안 세운 앵커**(조용히 넘기지 않는다):
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
  { field: 'elevator_evac', sheet: FP_SHEET.F1_1, cell: 'AR12', labelCell: 'D12' },
  /* 주차장 13행 — 승강기 12행과 **같은 모양**의 체크 행인데 종전엔 미배선이었다. 사유 주석이
   * 「ERP에 주차장 입력 축이 없다」였는데 그 뒤 건물 폼에 주차장 칩이 생겨 **근거가 낡았다**
   * (2026-09-09 사용자 지적: 저장했는데 엑셀이 공란). 원천 `buildings.parking_summary`,
   * 체크 판정은 `parseParkingSummary`(별지 9호 2쪽과 같은 규칙 — 사본 금지).
   * 🚨 2026-09-16: 종전 주석이 「`AR13 전기차충전소`는 그 축이 ERP에 없어 여전히 안 세운다」였는데
   *   **또 근거가 낡았다** — 옥내·옥외 때와 같은 재발이다. 건물 폼 주차장 칩에 축을 신설했고
   *   판정은 `parseParkingEv`(별지 9호엔 이 칸이 없어 `parseParkingSummary`와 일부러 나눴다).
   *   ⚠ 라벨이 `☐ 전기차충전소\n   [서식1.6.3] 작성`이라 상자 뒤에 법정 지시문이 붙어 있다.
   *     `boxLabelCell`은 **첫 상자만** 갈므로 그 자구는 그대로 남는다(지우지 않는다).
   *   ⚠ 알려진 한계: 이 상자를 켜면 양식이 [서식1.6.3] 작성을 지시하는데, 우리 워크북엔
   *     1.6.x 중 `1.6.1 기타시설 일반현황`만 있고 1.6.3 시트가 없다. 상자는 **현황의 사실**이라
   *     켜는 것이 맞고, 1.6.3 신설은 별건이다(2026-09-16 결정). */
  { field: 'parking_indoor', sheet: FP_SHEET.F1_1, cell: 'L13', labelCell: 'D13' },
  { field: 'parking_outdoor', sheet: FP_SHEET.F1_1, cell: 'AB13', labelCell: 'D13' },
  { field: 'parking_ev', sheet: FP_SHEET.F1_1, cell: 'AR13', labelCell: 'D13' },
  /* 14행 자주식·기계식 4칸 — 13행 옥내·옥외의 **하위 상자**다(옥내: L14·T14 / 옥외: AB14·AJ14).
   * 🚨 2026-09-09: 종전 주석이 「양식 1.1에는 옥내·옥외 두 칸뿐이라 기계식은 켤 자리가 없다」였는데
   *   **manifest에 네 칸이 실재한다**(`184-191`). 법정 양식 hwpx 원문에서도 주차장 줄 아래
   *   `☐자주식 ☐기계식`이 두 벌 확인됐다 — 주석은 의도이지 증거가 아니었다.
   *   그래서 「옥외 자주식 8대」가 옥외만 켜고 **자주식은 빈 상자로 나갔다**. */
  { field: 'parking_in_self', sheet: FP_SHEET.F1_1, cell: 'L14', labelCell: 'D13' },
  { field: 'parking_in_mech', sheet: FP_SHEET.F1_1, cell: 'T14', labelCell: 'D13' },
  { field: 'parking_out_self', sheet: FP_SHEET.F1_1, cell: 'AB14', labelCell: 'D13' },
  { field: 'parking_out_mech', sheet: FP_SHEET.F1_1, cell: 'AJ14', labelCell: 'D13' },
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
  { field: 'headcount_max_on', sheet: FP_SHEET.F1_1, cell: 'AR19', labelCell: 'D19' },
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

  /* ── 서식 1.10.1 연간 점검 계획 (2026-09-14) ────────────────────────────────
   *  🚨 **이 시트도 통째로 미배선이었다**(사용자 지적: 「건축물 사용승인일·자체점검 체크가
   *    안 돼 있다」). 1.4·1.8과 같은 갈래로, 씨앗에 `{{token}}`이 하나도 없어 자동 생성이
   *    못 보던 자리다(`tokenCells: {}`). 그래서 사용승인일·점검시기·점검자가 전부 공란이고
   *    상자는 전부 `□`로 나갔다 — 같은 값을 **PDF는 인쇄하고 있었다**(D-7 갈라짐).
   *
   *  ⭐ 좌표는 자산 실측(`sheet16.xml` 병합표)으로 세웠다. 값칸은 전부 병합의 **시작 칸**이다:
   *    `V5:BH5` · `AP8:BH8` · `AP9:BH9` · `AP10:BH10`.
   *
   *  ⚠ **일부러 안 세운 칸** — 조용히 넘기지 않는다:
   *    · `D13`·`V13`·`V14`·`V15`·`AF15` 「외관점검(공공기관)」 한 벌 — ERP에 공공기관 판정 축이
   *      없다. 지어내면 아닌 대상에 체크가 찍힌다(사용자 결정 2026-09-14: 공란 유지).
   *    · `AX6`·`AX11` 「제출처」 두 칸 — 값은 관할 소방서인데, 지금 이 파일의 `fire_station`은
   *      고객 레코드만 읽고 PDF는 1.3 입력을 우선한다(두 표면이 이미 갈라져 있다). 여기에
   *      셋째 규칙을 더하지 않는다 — **그 축을 하나로 모으는 별건**에 함께 배선한다.
   *    · `D16`~`BE18` 일상점검·`M24`~`AH25` 관련서류 — 1.10.1이되 자체점검 축이 아니다(별건).
   */
  { field: 'f1101_use_approval_date', sheet: FP_SHEET.F1_10_1, cell: 'A4', labelCell: 'A4' },
  // 작동점검 3칸 — 상자칸 둘(점검자)과 연월칸 하나
  { field: 'f1101_op_check', sheet: FP_SHEET.F1_10_1, cell: 'D5', labelCell: 'D5' },
  { field: 'f1101_op_month', sheet: FP_SHEET.F1_10_1, cell: 'V5', labelCell: 'M5' },
  { field: 'f1101_op_self', sheet: FP_SHEET.F1_10_1, cell: 'V7', labelCell: 'V7' },
  { field: 'f1101_op_outsource', sheet: FP_SHEET.F1_10_1, cell: 'AF7', labelCell: 'AF7' },
  // 종합점검 — 머리 상자(D8) + 안쪽 세 줄(최초·종합·2차) + 점검자
  { field: 'f1101_comp_check', sheet: FP_SHEET.F1_10_1, cell: 'D8', labelCell: 'D8' },
  { field: 'f1101_initial_check', sheet: FP_SHEET.F1_10_1, cell: 'V8', labelCell: 'V8' },
  { field: 'f1101_initial_month', sheet: FP_SHEET.F1_10_1, cell: 'AP8', labelCell: 'M8' },
  { field: 'f1101_comp_box', sheet: FP_SHEET.F1_10_1, cell: 'V9', labelCell: 'V9' },
  { field: 'f1101_comp_month', sheet: FP_SHEET.F1_10_1, cell: 'AP9', labelCell: 'M8' },
  { field: 'f1101_comp2_box', sheet: FP_SHEET.F1_10_1, cell: 'V10', labelCell: 'V10' },
  { field: 'f1101_comp2_month', sheet: FP_SHEET.F1_10_1, cell: 'AP10', labelCell: 'M8' },
  { field: 'f1101_comp_self', sheet: FP_SHEET.F1_10_1, cell: 'V12', labelCell: 'V12' },
  { field: 'f1101_comp_outsource', sheet: FP_SHEET.F1_10_1, cell: 'AF12', labelCell: 'AF12' },
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

/* ══════════════════ 1.4 소방시설 현황 — 설비 체크칸 40 + 대상명 ══════════════════
 *
 *  🚨 **이 시트는 통째로 미배선이었다**(2026-09-14 사용자 지적: 「소화기구·유도등 체크가 안 돼 있다」).
 *  앵커가 한 칸도 없어 40종 **전부**가 템플릿 원본 `□` 그대로 인쇄됐고, 같은 시트의 대상명도
 *  공란이었다. 같은 값을 PDF(`fire-plan-template` facilityRows)는 `d.facilities`로 체크하고
 *  있었으므로 **PDF와 엑셀이 갈라진 상태**였다(D-7). 씨앗에 `{{token}}`이 없어 자동 생성이
 *  못 보던 자리라 §구멍·주차장 13행과 같은 갈래다.
 *
 *  ⭐ 좌표를 손으로 적되 **믿지는 않는다** — 아래 `FORM14_ROWS`가 모듈 적재 시점에
 *    `labelAt`의 자구와 대조해 하나라도 어긋나면 throw 한다(라우트가 500으로 낸다).
 *    좌표가 밀린 채 조용히 옆 줄을 체크하는 것이 이 서식에서 가장 위험한 방향이다.
 *  ⭐ 코드 문자열은 `ALL_STANDARD_CODES`의 그 항목명이다(설비 대장 어휘) — 전사(全射)를
 *    함께 단언하므로 서식에 줄이 생기거나 표준 코드가 늘면 여기가 먼저 붉어진다.
 *
 *  ⚠ **일부러 안 세운 칸** (조용히 넘기지 않는다):
 *    · `R16`·`R17` 피난기구 하위 8칸(공기안전매트·피난사다리·(간이)완강기·미끄럼대·구조대 /
 *      다수인피난장비·승강식피난기·하향식피난구용내림식사다리) — 그 축은 대장이 아니라
 *      **세부제원** `s36_evac.evac_equipment.types`(`evacTypesFromSpecs` 단일 원천)인데
 *      `assembleFirePlan`이 `customer_facility_specs`를 읽지 않는다. 여기서 질의를 새로 짜면
 *      `report9-assemble`의 건물 우선·공통 폴백 병합을 베끼는 두 번째 원천이 생긴다(사본 금지).
 *      → 조립에 `evacTypes`를 실어 주는 별건으로 남긴다. 부모 `J16 피난기구`는 대장 축이라 배선했다.
 *    · `AJ2 ※ □에는 해당되는 곳에 √표를 합니다` — 상자가 있지만 **안내문**이다(체크 대상 아님).
 */
export const FORM14_SHEET = FP_SHEET.F1_4

/** [설비 대장 코드, 설치 체크칸] — 서식 좌열(J)·우열(AJ/AI). 실측 2026-09-14(manifest labels 전수) */
const FORM14_CELLS: ReadonlyArray<readonly [code: string, cell: string]> = [
  // 소화설비 15
  ['소화기구 및 자동소화장치', 'J3'],
  ['옥내소화전설비', 'J4'],   ['옥외소화전설비', 'AJ4'],
  ['스프링클러설비', 'J5'],   ['이산화탄소소화설비', 'AJ5'],
  ['간이스프링클러설비', 'J6'], ['할론소화설비', 'AJ6'],
  ['화재조기진압용 스프링클러설비', 'J7'], ['할로겐화합물 및 불활성기체소화설비', 'AJ7'],
  ['물분무소화설비', 'J8'],   ['분말소화설비', 'AJ8'],
  ['미분무소화설비', 'J9'],   ['강화액소화설비', 'AJ9'],
  ['포소화설비', 'J10'],      ['고체에어로졸소화설비', 'AJ10'],
  // 경보설비 9
  ['단독경보형감지기', 'J11'], ['통합감시시설', 'AJ11'],
  ['비상경보설비', 'J12'],    ['자동화재속보설비', 'AJ12'],
  ['자동화재탐지설비 및 시각경보기', 'J13'], ['누전경보기', 'AJ13'],
  ['화재알림설비', 'J14'],    ['가스누설경보기', 'AJ14'],
  ['비상방송설비', 'J15'],
  // 피난구조설비 7 — 하위 8칸(R16·R17)은 위 ⚠ 참조
  ['피난기구', 'J16'],
  ['인명구조기구', 'J18'],    ['피난유도선', 'AJ18'],
  ['유도등', 'J19'],          ['비상조명등', 'AJ19'],
  ['유도표지', 'J20'],        ['휴대용비상조명등', 'AJ20'],
  // 소화용수설비 2
  ['상수도소화용수설비', 'J21'], ['소화수조 및 저수조', 'AJ21'],
  // 소화활동설비 7 — ⚠ 우열이 AJ가 아니라 **AI**다(23~25행)
  ['거실제연설비', 'J22'],
  ['부속실 등 제연설비', 'J23'], ['비상콘센트설비', 'AI23'],
  ['연결송수관설비', 'J24'],     ['무선통신보조설비', 'AI24'],
  ['연결살수설비', 'J25'],       ['연소방지설비', 'AI25'],
]

/** 상자 글자·공백을 걷어낸 비교 축 — 서식 자구와 대장 어휘의 띄어쓰기 흔들림만 흡수한다 */
const bareLabel = (s: string) => s.replace(/[□☐]/g, '').replace(/\s+/g, '')

export type Form14Row = { code: string; cell: string; field: string }

/** 설비 코드 ↔ 체크칸 — **적재 시점에 서식 자구와 대조**한다(좌표만 믿지 않는다) */
export const FORM14_ROWS: Form14Row[] = (() => {
  const rows = FORM14_CELLS.map(([code, cell]) => {
    const lbl = labelAt(FORM14_SHEET, cell)          // 없으면 여기서 throw
    if (bareLabel(lbl) !== bareLabel(code)) {
      throw new Error(`fire-plan-anchors: 1.4!${cell} 자구가 '${lbl.trim()}' 인데 코드는 '${code}' — 좌표가 밀렸다`)
    }
    // 필드 이름은 좌표에서 기계로 만든다(손으로 지으면 오타·중복이 가능해진다)
    return { code, cell, field: `f14_${cell}` }
  })
  // 🚨 전사(全射) — 표준 코드가 하나라도 칸을 못 얻으면 그 설비는 **영원히 미체크**로 인쇄된다.
  //   이 결함이 처음 샌 경로가 바로 '아무도 그 칸을 안 본다'였으므로 여기서 막는다.
  const wired = new Set(rows.map(r => r.code))
  const missing = ALL_STANDARD_CODES.filter(c => !wired.has(c))
  if (missing.length) throw new Error(`fire-plan-anchors: 1.4에 칸이 없는 표준 코드 — ${missing.join(', ')}`)
  const extra = rows.filter(r => !ALL_STANDARD_CODES.includes(r.code))
  if (extra.length) throw new Error(`fire-plan-anchors: 1.4에 미등록 코드 — ${extra.map(r => r.code).join(', ')}`)
  return rows
})()

/** 대상명 — 서식 자구가 `■ 대상명 : ` 이고 값이 **뒤에** 붙는다(§접두라벨칸) */
export const FORM14_NAME_FIELD = 'form14_target_name'
export const FORM14_NAME_CELL = 'A2'

const FORM14_SEEDS: Seed[] = [
  ...FORM14_ROWS.map(r => ({ field: r.field, sheet: FORM14_SHEET, cell: r.cell, labelCell: r.cell })),
  { field: FORM14_NAME_FIELD, sheet: FORM14_SHEET, cell: FORM14_NAME_CELL, labelCell: FORM14_NAME_CELL },
]

/* ══════════════════════ 서식 1.10.4 화재·비화재보 이력 (2026-09-16) ══════════════════════
 *
 *  🚨 이 시트는 **PDF가 이미 인쇄하는데 엑셀만 공란**이었다. 소방계획서_50 §5-3의 마커 대조가
 *    확정했다 — `forms.fireHistory`에 심은 `__FIRE__`가 PDF HTML에는 나타나고 엑셀 앵커는 0이었다.
 *    데이터도 입력 화면(`plan-form110`의 `c-1.10.4` 카드)도 이미 있고 **앵커만 없었다.**
 *
 *  머리글 5칸이 `FireHistoryRow`와 1:1이다 — 구분/발생일시/발생장소/발생원인/조치사항.
 *  값 슬롯이 정확히 75칸(15행 × 5열)이고 이 씨앗도 75개다(빈칸 보고의 분모와 맞물린다).
 */
export const FIREHIST_SHEET = FP_SHEET.F1_10_4

/** 데이터 행 수 — 좌표를 손으로 적지 않는다.
 *  `labelBlockRows('A2')`는 **머리글 행까지 포함해** 센다(A열에 그 아래 라벨이 없으므로 시트 끝까지).
 *  그래서 −1이 데이터 행 수다. 양식에 행이 끼거나 빠지면 이 수가 따라 움직인다. */
export const FIREHIST_ROWS = labelBlockRows(FIREHIST_SHEET, 'A2') - 1

/** 첫 데이터 행(1-based) — 머리글 바로 다음 */
export const FIREHIST_FIRST_ROW = 3

/** [엑셀 열, 필드 접미사, 열 머리 라벨 셀] — 라벨 셀이 좌표 검증의 닻이다 */
const FIREHIST_COLS: ReadonlyArray<readonly [string, string, string]> = [
  ['A', 'kind', 'A2'],      // 구분 (화재/비화재보)
  ['I', 'at', 'I2'],        // 발생일시
  ['Q', 'place', 'Q2'],     // 발생장소
  ['Z', 'cause', 'Z2'],     // 발생원인
  ['AM', 'action', 'AM2'],  // 조치사항
]

/* ══════════════════════ 서식 1.2.2 화재취약장소 현황 (2026-09-17) ══════════════════════
 *
 *  🚨 **이 표는 반복 행이 아니다.** 양식이 장소를 **세 개소로 고정**해 인쇄해 둔다
 *    (보일러실 4행 · 주방 8행 · 전기실 12행, 간격 4). 그래서 장소 이름은 **쓰지 않는다** —
 *    법정 자구이고, 덮어쓰면 서식이 훼손된다. 우리가 채우는 것은 **위치 칸과 체크상자**뿐이다.
 *
 *  ⭐ ERP 프리셋이 같은 세 개소다(`plan-form12.tsx`의 `HAZARD_PRESETS`) — 우연이 아니라
 *    이 서식을 보고 만든 것이라 이름으로 맞물린다. 사용자가 [행 추가]로 넷째를 넣으면
 *    양식에 자리가 없다 → **버리되 세어서** 라우트가 고지에 싣는다(ZONE 넘침과 같은 규약).
 *
 *  ⚠ 상자 어휘는 `HAZARD_FACTORS`(조립기가 `normHazardFactors`로 이미 그 어휘로 바꿔 준다)와
 *    **정확히 같다**. 여기서 다시 문자열을 적지 않고 그 상수를 쓴다.
 *  ⚠ `☐ 기타( )`는 ERP에 축이 없어 **일부러 안 세운다**(없는 근거로 체크하지 않는다).
 *  ⚠ 하단 블록(인명피해우려장소 16~20행, 시건장치)도 ERP에 축이 없어 비워 둔다.
 */
export const HAZARD_SHEET = FP_SHEET.F1_2_2

/** 고정 장소의 첫 행(1-based)과 행 간격 — 좌표를 손으로 적되 **라벨로 검증**한다.
 *  `labelAt(sheet, 'A4')`가 '보일러실'과 다르면 적재 시점에 throw 하므로, 양식이 바뀌면 멈춘다. */
export const HAZARD_FIRST_ROW = 4
export const HAZARD_ROW_STRIDE = 4
export const HAZARD_PLACE_ROWS = [0, 1, 2].map(i => HAZARD_FIRST_ROW + i * HAZARD_ROW_STRIDE)

/** 위험요소 상자 — [엑셀 열, 행 오프셋, `HAZARD_FACTORS`의 자구].
 *  양식 배치: 왼열(AB) 전기/기계/화학/가스누출 · 오른열(AO) 자연재해/부주의/기타. */
export const HAZARD_BOXES: ReadonlyArray<readonly [string, number, string]> = [
  ['AB', 0, '전기적 요인'],
  ['AB', 1, '기계적 요인'],
  ['AB', 2, '화학적 요인'],
  ['AB', 3, '가스누출(폭발)'],
  ['AO', 0, '자연재해'],
  ['AO', 1, '부주의'],
  // ['AO', 2, '기타( )'] — ERP에 축이 없다. 없는 근거로 체크하지 않는다.
]

/* ══════════════════════ 서식 1.10.3 다중이용업소 관리현황 (2026-09-17) ══════════════════════
 *
 *  🚨 PDF는 이미 인쇄하는데 엑셀만 공란이던 시트(소방계획서_50 §5-3 마커 `__MU__`로 확정).
 *    입력 화면은 `plan-multi-use-card.tsx`이고 2026-09-09에 1.10 → **1.4 「기타」 아래**로 이사했다.
 *
 *  **일반현황 블록만** 배선한다. 아래 축은 ERP에 데이터가 없어 **일부러 안 세운다**
 *  (없어서가 아니라 채울 근거가 없어서다 — 없는 근거로 체크하면 거짓을 인쇄하는 것이다):
 *   · 안전점검 분기 4상자(10행) — 분기별 점검 이력 축이 없다.
 *   · 안전시설 17상자(11~17행) — 다중이용업소 **전용** 설비 목록이라 1.4(대상물 전체)와 축이 다르다.
 *   · 확인사항 결과칸(19행~) — 점검 결과 축이 없다.
 *
 *  ⚠ 영업시간 시간칸 4개는 **자리표시칸**이다(`00시~00시`). 값이 없으면 그 자리표시를 남긴다 —
 *    지우면 무엇을 적는 칸인지 알 수 없게 된다(`placeholderCell`).
 */
export const MU_SHEET = FP_SHEET.F1_10_3

/** 값칸 — [필드 접미사, 셀, 라벨 셀] */
export const MU_VALUE_CELLS: ReadonlyArray<readonly [string, string, string]> = [
  ['bizname', 'N3', 'A3'],     // 사업장명
  ['category', 'AS3', 'AK3'],  // 업 종
  ['location', 'N4', 'F4'],    // 위 치
  ['owner', 'N5', 'F5'],       // 영 업 주
  ['phone', 'AS5', 'AK5'],     // 연 락 처
]

/** 영업시간 — 상자 6 + 자리표시 4. [필드 접미사, 셀, 갈래] */
export const MU_HOURS_CELLS: ReadonlyArray<readonly [string, string, 'box' | 'time']> = [
  ['wk', 'N6', 'box'],          // □ 평일
  ['wkday_box', 'V6', 'box'],   // □ 주간
  ['wkday_at', 'AD6', 'time'],
  ['wknight_box', 'V7', 'box'], // □ 야간
  ['wknight_at', 'AD7', 'time'],
  ['hol', 'AK6', 'box'],        // □ 휴일
  ['holday_box', 'AS6', 'box'], // □ 주간
  ['holday_at', 'BA6', 'time'],
  ['holnight_box', 'AS7', 'box'],
  ['holnight_at', 'BA7', 'time'],
]

/** 이용자 4상자 — [필드 접미사, 셀, `userTypes`의 자구] */
export const MU_USER_BOXES: ReadonlyArray<readonly [string, string, string]> = [
  ['u_old', 'N8', '노유자'],
  ['u_drunk', 'Z8', '주취자'],
  ['u_youth', 'N9', '청소년'],
  ['u_disabled', 'Z9', '신체부자유자'],
]

/* ══════════════════════ 서식 1.11.1 소방훈련·교육 연간계획 (2026-09-17) ══════════════════════
 *
 *  🚨 PDF는 이미 인쇄하는데 엑셀만 공란이던 시트 — 이번엔 **상자 72칸**이 통째로 비어 있었다.
 *    양식 행이 PDF 표와 **한 줄씩 그대로** 대응한다(`fire-plan-template.ts:723-729`):
 *      교육 = 소방교육(9) · 피난교육(10) · 자위소방대 및 초기대응체계(11)  → `eduMonths`
 *      훈련 = 소방훈련(15) · 피난훈련(16) · 자위소방대 및 초기대응체계(17) → `drillMonths`
 *
 *  ⚠ PDF의 **훈련** 블록엔 자위소방대 행이 없다(교육에만 있다). 양식에는 있으므로 그 행도
 *    켠다 — 추측이 아니라 **그 행이 속한 블록**(훈련)의 월을 쓰는 것이다.
 *  ⚠ 대상자 3칸은 1.1 인원현황과 **같은 원천**이다(`ops.headcount*`). 자위소방대 인원은
 *    편성표 행 수(`d.brigade.length`)가 유일한 근거다.
 */
export const TRAIN_SHEET = FP_SHEET.F1_11_1

/** 월 12칸의 열 — 교육·훈련 두 표가 **같은 열**을 쓴다 */
export const TRAIN_MONTH_COLS = ['L', 'Q', 'U', 'Y', 'AC', 'AG', 'AK', 'AO', 'AS', 'AW', 'BA', 'BE'] as const

/** [행, 필드 접두, 어느 월 배열인가] */
export const TRAIN_ROWS: ReadonlyArray<readonly [number, string, 'edu' | 'drill']> = [
  [9, 'edu_fire', 'edu'],      // 소방교육
  [10, 'edu_evac', 'edu'],     // 피난교육
  [11, 'edu_brig', 'edu'],     // 자위소방대 및 초기대응체계
  [15, 'drill_fire', 'drill'], // 소방훈련
  [16, 'drill_evac', 'drill'], // 피난훈련
  [17, 'drill_brig', 'drill'], // 자위소방대 및 초기대응체계(훈련 블록)
]

/** 대상자 — 상자 3 + 인원 단위칸 3. [필드 접미사, 상자 셀, 인원 셀] */
export const TRAIN_TARGETS: ReadonlyArray<readonly [string, string, string]> = [
  ['worker', 'I4', 'AA4'],    // □ 근무자 … 명
  ['resident', 'AH4', 'BB4'], // □ 거주자 … 약 명
  ['brigade', 'I5', 'AA5'],   // □ 자위소방대 및 초기대응체계 … 명
]

/* ══════════════════════ 서식 3.1 피난시설 일반현황 (2026-09-17) ══════════════════════
 *
 *  🚨 **이 시트의 상자 31칸은 축이 다 다르다.** 상자 수로 뭉뚱그려 배선하면 근거 없는 체크가
 *    섞인다. **근거가 확실한 셋만** 세운다 — 나머지는 아래에 이유를 적고 비워 둔다.
 *
 *  ✅ 세우는 것 — 전부 **1.1·1.5가 이미 쓰는 그 원천**이다(사본 금지):
 *    · 계단 4종(8~9행) ← `stairChecks`(1.1 15~16행과 **같은 술어**)
 *    · 기타 피난시설(10~11행) ← `evacFire.etc`(PDF `etcEvacKinds`와 같은 어휘)
 *    · 승강기(21행, 한 칸에 상자 셋) ← `d.elevators`(1.1 12행과 같은 원천)
 *
 *  ⚠ **안 세우는 것과 이유**(없어서가 아니라 채울 근거가 없어서다):
 *    · 화재경보 방식·경보수단(5~6행) — 전층/우선 경보는 ERP에 축이 없다. 경보수단 셋은
 *      1.4 설비 40종과 **입도가 다르다**(거기선 「자동화재탐지설비 및 시각경보기」가 한 항목).
 *    · 피난기구 6·인명구조기구 4(13~17행) — 같은 입도 문제다. 1.4는 「피난기구」가 한 항목이라
 *      완강기·미끄럼대를 가를 근거가 없다.
 *    · 유도등 2선식/3선식(19행) — ERP에 그 구분이 없다.
 *    · 방화시설(20행) — `evacFire.fireDoor`는 유·무뿐이고 양식은 방화문/셔터/스크린 셋이다.
 *    · 인증 대체시설·기타(11~12행) — ERP 어휘에 없다.
 *  🚨 ERP의 `옥상광장`은 **양식에 칸이 없다** — 버리되 세어서 고지에 싣는다(1.2.2 `창고`와 같은 축).
 */
export const EVAC1_SHEET = FP_SHEET.F3_1

/** 계단 4종 — [셀, `StairKind`]. 양식 배치는 직통·특별피난 / 피난·옥외 */
export const EVAC1_STAIR_CELLS: ReadonlyArray<readonly [string, string]> = [
  ['Q8', 'direct'], ['AM8', 'special'], ['Q9', 'escape'], ['AM9', 'outdoor'],
]

/** 기타 피난시설 — [셀, `evacFire.etc`의 자구]. ERP 어휘 4개 중 **3개만** 양식에 칸이 있다 */
export const EVAC1_ETC_CELLS: ReadonlyArray<readonly [string, string]> = [
  ['Q10', '대피공간'], ['AM10', '피난안전구역'], ['AM11', '경량칸막이'],
]

/** 승강기 — 한 칸에 상자 셋(`☐ 승용 ☐ 비상용 ☐ 피난용`) */
export const EVAC1_ELEVATOR_CELL = 'Q21'

/* ══════════════════════ 서식 2.1 자위소방대 일반현황 (2026-09-17) ══════════════════════
 *
 *  🚨 상자 35칸 중 **근거가 확실한 20칸 + 값칸 3**만 세운다(3.1과 같은 규약).
 *
 *  ✅ 세우는 것 — 대부분 **1.1이 이미 쓰는 그 원천**이다:
 *    · 명칭·도로명주소(5~6행) ← `buildingName`·`address`
 *    · 등급 4상자(7행) ← `d.grade` — 1.1 T9와 같은 원천
 *    · 상시근무인원 4상자(8행) ← `ops.headcountWorker`를 **구간**으로 판정
 *    · 편성표 Type 2상자(11~12행) ← `brigadeGeneral.type`
 *    · 자위소방대 총원(13행) ← `d.brigade.length`
 *    · 팀 상자 10(구성 15~17행 · 임무 23~27행) ← 편성표에 **그 팀 대원이 있는가**
 *
 *  ⚠ **안 세우는 것과 이유**:
 *    · 운영시간 시간칸(`시 ~ 시`, 9~10행) — ERP는 `09:00~18:00` 자유 텍스트라 양식의
 *      두 자리(`[N]시 ~ [M]시`)로 쪼갤 근거가 없다. 상자도 같이 비운다(반만 켜면 더 틀리다).
 *    · 근무형태 상근/교대(13·18행) · 초기대응체계 조 편성(18~20행) — ERP에 축이 없다.
 *    · 팀별 인원(15~17행 `명`) — 편성표 대원의 팀 문자열이 **두 목록으로 갈려 있어**
 *      (`비상연락` vs `비상연락반`) 수를 세면 한쪽 목록에서만 맞는다. 상자는 어간으로
 *      맞출 수 있지만 **수는 틀리면 거짓**이라 비운다.
 *
 *  ⭐ 팀 상자는 **어간**으로 맞춘다 — 양식은 `비상연락팀`인데 ERP는 `비상연락`·`비상연락반`
 *    둘 다 쓴다(2.2 배선이 남긴 기록). 꼬리(팀·반)를 떼고 비교하면 두 목록을 다 받는다.
 */
export const BRIG1_SHEET = FP_SHEET.F2_1

/** 등급 4상자 — [셀, `d.grade` 값] */
export const BRIG1_GRADE_CELLS: ReadonlyArray<readonly [string, string]> = [
  ['M7', '특급'], ['Y7', '1급'], ['AK7', '2급'], ['AU7', '3급'],
]

/** 상시근무인원 4상자 — [셀, 하한(이상), 상한(미만)]. 양식 구간을 그대로 옮긴다 */
export const BRIG1_HEADCOUNT_BANDS: ReadonlyArray<readonly [string, number, number]> = [
  ['M8', 0, 50], ['AA8', 50, 100], ['AN8', 100, 500], ['AX8', 500, Number.POSITIVE_INFINITY],
]

/** 편성표 서식 2상자 — [셀, `brigadeGeneral.type`에 들어 있어야 할 자구] */
export const BRIG1_TYPE_CELLS: ReadonlyArray<readonly [string, string]> = [
  ['M11', 'Ⅱ'], ['M12', 'Ⅲ'],
]

/** 팀 상자 — [필드 접미사, 어간, 구성 블록 셀, 임무 블록 셀] */
export const BRIG1_TEAM_CELLS: ReadonlyArray<readonly [string, string, string, string]> = [
  ['emer', '비상연락', 'AB15', 'M23'],
  ['fire', '초기소화', 'AB16', 'M24'],
  ['evac', '피난유도', 'AB17', 'M25'],
  ['aid', '응급구조', 'AR15', 'M26'],
  ['guard', '방호안전', 'AR16', 'M27'],
]

/* ══════════════════════ 서식 1.12.1 화기취급작업 현황 (2026-09-17) ══════════════════════
 *
 *  깨끗한 반복 표다 — 13행 × 5열. 입력 화면은 `plan-form1215`의 `fireworkLog`(`LogRow[]`).
 *
 *  ⚠ **5열 중 4열만 배선한다.** 양식의 `연락처`는 ERP에 축이 없고, 반대로 ERP의
 *    `measure`(안전조치)는 양식에 칸이 없다. 🚨 `measure`를 `연락처` 칸에 넣으면 **머리글이
 *    거짓말을 한다** — 비워 두는 쪽이 옳다.
 *  ⚠ 행 수는 손으로 적지 않는다 — 머리글(4행) 다음부터 시트 끝까지가 데이터 행이다.
 */
export const FIREWORK_SHEET = FP_SHEET.F1_12_1

/** 데이터 행 수 — `labelBlockRows('A4')`가 머리글 행까지 세므로 −1.
 *  ⚠ 18행부터는 「관련서류 보관방법」 블록이라 A열에 라벨이 있다 → 자동으로 거기서 끊긴다. */
export const FIREWORK_ROWS = labelBlockRows(FIREWORK_SHEET, 'A4') - 1
export const FIREWORK_FIRST_ROW = 5

/** [엑셀 열, `LogRow` 열쇠, 머리글 셀] */
export const FIREWORK_COLS: ReadonlyArray<readonly [string, string, string]> = [
  ['A', 'date', 'A4'],        // 작업일자 및 시간
  ['T', 'place', 'T4'],       // 작업장소
  ['AE', 'work', 'AE4'],      // 작업내용
  ['AO', 'supervisor', 'AO4'], // 작업책임자(업체명)
  // ['AY', ?, 'AY4'] 연락처 — ERP에 축이 없다. 안전조치를 여기 넣으면 머리글이 거짓이 된다.
]

const FIREWORK_SEEDS: Seed[] = Array.from({ length: FIREWORK_ROWS }, (_, i) =>
  FIREWORK_COLS.map(([col, key, labelCell]) => ({
    field: `firework_${i}_${key}`,
    sheet: FIREWORK_SHEET,
    cell: `${col}${FIREWORK_FIRST_ROW + i}`,
    labelCell,
  })),
).flat()

/* ─────────── 서식 1.13 소방시설 공사·정비 기록 (2026-09-17) ───────────
 *  14행 × 5열. 입력 화면은 `plan-form1215`의 `constructionLog`(`LogRow[]`).
 *
 *  🚨 **1.12.1과 달리 5:5로 겹치지 않는다.** 열 수만 같고 뜻이 어긋난다:
 *
 *    양식 머리글        ERP 필드            판정
 *    ──────────────────────────────────────────────────────────────
 *    작업내용     ←   content(공사·정비 내용)   ✅ 같은 뜻
 *    작업기간     ←   date(일자)               ✅ 하루짜리 기간이다
 *    작업책임자   ←   company(시공업체)         ❌ **업체는 사람이 아니다**
 *    확인일자     ←   (없음)                   ❌ ERP에 확인 축이 없다
 *    비고        ←   note(비고)               ✅ 같은 말
 *
 *  → **3열만 배선한다.** 시공업체를 「작업책임자」 밑에 찍으면 머리글이 거짓말을 한다
 *    (1.12.1 `연락처`와 같은 규약). `확인일자`는 관계인이 손으로 적을 칸이다.
 *  ⚠ 갈 곳 없는 두 축(`facility` 대상 설비 · `company` 시공업체)은 **버리되 센다** —
 *    `constructionUnmapped()`가 라우트 고지에 싣는다. PDF는 이 둘을 인쇄하는데 양식엔
 *    칸이 없으므로, 말해 주지 않으면 사용자는 **엑셀이 빠뜨렸다고 오해한다.**
 */
export const CONSTRUCTION_SHEET = FP_SHEET.F1_13

/** 데이터 행 수 — `labelBlockRows('A2')`가 머리글 행까지 세므로 −1(A열에 아래 라벨이 없어 시트 끝까지). */
export const CONSTRUCTION_ROWS = labelBlockRows(CONSTRUCTION_SHEET, 'A2') - 1
export const CONSTRUCTION_FIRST_ROW = 3

/** [엑셀 열, `LogRow` 열쇠, 머리글 셀] */
export const CONSTRUCTION_COLS: ReadonlyArray<readonly [string, string, string]> = [
  ['A', 'content', 'A2'],  // 작업내용
  ['O', 'date', 'O2'],     // 작업기간
  // ['X', ?, 'X2']  작업책임자 — 시공업체(법인)를 사람 자리에 넣지 않는다
  // ['AG', ?, 'AG2'] 확인일자 — ERP에 확인 축이 없다
  ['AP', 'note', 'AP2'],   // 비고
]

const CONSTRUCTION_SEEDS: Seed[] = Array.from({ length: CONSTRUCTION_ROWS }, (_, i) =>
  CONSTRUCTION_COLS.map(([col, key, labelCell]) => ({
    field: `construction_${i}_${key}`,
    sheet: CONSTRUCTION_SHEET,
    cell: `${col}${CONSTRUCTION_FIRST_ROW + i}`,
    labelCell,
  })),
).flat()

/* ─────────── 서식 3.3 피난인원현황 (2026-09-17) ───────────
 *  ⭐ **1.2.1 구역별 세부현황의 쌍둥이다.** 머리글 자구가 글자까지 같다 —
 *    `명칭/용도` · `(바닥)면적` · `관리주체\n(입주사)` · `담당자\n(연락처)`.
 *    같은 사실을 두 시트가 다르게 찍으면 **D-7 갈라짐**이므로 값 계산을 통째로 나눠 쓴다
 *    (`zoneRowValues()`) — 열 좌표만 다르고 **값은 한 번만 만든다.**
 *
 *  ⭐ 행 예산이 다르다: 1.2.1은 **8행**, 3.3은 **19행**. 갈라짐이 아니라 양식의 용량 차이다
 *    (9번째 구역부터는 3.3에만 실린다). 넘침은 각자의 예산으로 따로 센다.
 *
 *  ⚠ 인원 3칸(`근무`·`거주`·`방문`)은 **비운다.** ERP 구역의 인원은 `weekday`·`holiday`
 *    (평일/휴일 × 주간/야간)라 **축이 다르다** — 「평일 주간」을 「근무」 밑에 찍으면
 *    시간대를 인원 구분으로 둔갑시키는 것이다. 1.2.1이 그 둘을 이미 제 이름으로 인쇄한다.
 *  ⚠ A열 `동`도 비운다 — 1.2.1 0열과 **같은 사유**(ERP 구역에 동 축이 없다).
 */
export const EVAC3_SHEET = FP_SHEET.F3_3

/** 데이터 행 수 — `labelBlockRows('A6')`가 머리글 행까지 세므로 −1.
 *  ⚠ A26 「* 추가서식 필요 시 별첨…」 주석이 표를 끊는다 → 자동으로 19행. */
export const EVAC3_ROWS = labelBlockRows(EVAC3_SHEET, 'A6') - 1
export const EVAC3_FIRST_ROW = 7

/** [엑셀 열, 필드 접미사, 머리글 셀] — 접미사는 **1.2.1과 같은 이름**을 쓴다(같은 값이니까) */
export const EVAC3_COLS: ReadonlyArray<readonly [string, string, string]> = [
  // ['A', ?, 'A6']  동 — 1.2.1 0열과 같은 사유로 비운다
  ['E', 'floor', 'E6'],     // 층
  ['I', 'usage', 'I4'],     // 명칭/용도
  ['R', 'area', 'R4'],      // (바닥)면적
  // ['AA'|'AE'|'AJ', ?, 'AA5'|'AE5'|'AJ5']  근무·거주·방문 — ERP는 평일/휴일 축이다
  ['AO', 'company', 'AO4'], // 관리주체(입주사)
  ['AY', 'contact', 'AY4'], // 담당자(연락처)
]

const EVAC3_SEEDS: Seed[] = Array.from({ length: EVAC3_ROWS }, (_, i) =>
  EVAC3_COLS.map(([col, key, labelCell]) => ({
    field: `evac3_${i}_${key}`,
    sheet: EVAC3_SHEET,
    cell: `${col}${EVAC3_FIRST_ROW + i}`,
    labelCell,
  })),
).flat()

/* ─────────── 서식 1.9 자위소방대 현황 (2026-09-17) ───────────
 *  2.1(일반현황)·2.2(편성표)의 **요약본**이다 — 셋이 같은 `d.brigade`를 읽는다.
 *
 *  ⭐ 편성표의 구분이 **넷**이다(자위소방대장 · 부대장 · 비상연락 ×2 · 현장대응 ×6).
 *    2.2는 구분이 **둘**뿐이라(지휘통제팀/현장대응팀) 「대장·부대장 말고는 전부 현장대응」으로
 *    정해 두었는데, 그 판정을 1.9에 그대로 쓰면 `팀=비상연락`인 대원이 **「현장대응」이라고
 *    적힌 줄에 인쇄된다.** 양식이 제 구분을 갖고 있고 ERP도 팀 문자열을 갖고 있으므로
 *    여기서는 **어간으로 갈라 제 줄에 놓는다**(2.1이 팀 상자에 쓴 그 어간 판정, 사본 아님).
 *  ⚠ **알려진 불일치**: 같은 비상연락 대원이 2.2에서는 현장대응팀 줄에 인쇄된다. 2.2의
 *    지휘통제팀 여분 두 줄(F7·F8)은 구분 라벨이 **공백**이라 양식이 「여기가 비상연락 자리」라고
 *    말해 주지 않는다 — 추측으로 옮기지 않고, 불일치를 검사에 **못 박아 보이게** 둔다.
 *
 *  ⚠ 안 채우는 칸과 이유:
 *   · `□ 해당없음` — ERP는 **면제 대상인지**를 모른다. 편성표가 비었다는 것은 미입력일 수도
 *     있고, 미입력과 「해당없음」은 다르다(유·무 칸의 종전 규약과 같은 축).
 *   · `☐ 상근직` / `☐ 교대직 ( 조 교대)` — ERP에 근무형태 축이 없다.
 *   · 팀별 **인원** 6칸 — 2.1이 같은 이유로 비웠다. 상자는 「그 팀이 있다」는 사실이지만
 *     수는 **틀리면 거짓**이고, ERP 팀 이름이 양식 6종과 정확히 겹치지 않아 합이 안 맞는다.
 *   · `사무실(세대)` 열 — ERP 대원은 연락처가 **하나**다. 2.2도 같은 이유로 `개인`만 쓴다.
 *   · 19행 이후 피난약자 블록 — **배선했다**(아래 `VUL9_*`, 3.5와 값을 나눠 쓴다).
 *     🚨 여기 「ERP에 데이터가 없다」고 적어 두었던 건 **틀린 말이었다**(`vulnerable`이 있다).
 */
export const BRIG9_SHEET = FP_SHEET.F1_9

/** 운영 상자 · 편성인원 칸 */
export const BRIG9_RUNNING_CELL = 'K2'
export const BRIG9_TOTAL_CELL = 'U3'

/** 팀 상자 — [필드 접미사, 어간, 셀]. 어간은 **양식 라벨에서 떼어 쓰지 않는다**(2.1과 같은 어휘) */
export const BRIG9_TEAM_CELLS: ReadonlyArray<readonly [string, string, string]> = [
  ['cmd', '지휘통제', 'K4'],
  ['emer', '비상연락', 'AA4'],
  ['fire', '초기소화', 'AO4'],
  ['evac', '피난유도', 'K5'],
  ['aid', '응급구조', 'AA5'],
  ['guard', '방호안전', 'AO5'],
]

/** 편성표 — 배선한 열 [엑셀 열, 필드 접미사].
 *  ⚠ `개별임무`(AA)는 양식이 이미 인쇄해 둔 법정 문구라 앵커가 아니다. */
export const BRIG9_COLS: ReadonlyArray<readonly [string, string]> = [
  ['K', 'org'],    // 소속
  ['T', 'name'],   // 성명
  ['AV', 'phone'], // 비상연락체계(개인)
]

export const BRIG9_LEAD_ROW = 9
export const BRIG9_DEP_ROW = 10

/** 「비상연락」이라 적힌 행들 — 라벨에서 **찾아낸다**(11·12를 손으로 적지 않는다) */
export const BRIG9_EMER_ROWS: readonly number[] = (() => {
  const labels = sheetManifest(BRIG9_SHEET).labels
  const want = labels['A11']
  if (!want) throw new Error('fire-plan-anchors: 1.9!A11 라벨이 없다 — 편성표 좌표가 밀렸다')
  const rows = Object.keys(labels)
    .map(k => /^A(\d+)$/.exec(k))
    .filter((m): m is RegExpExecArray => !!m && labels[m[0]] === want)
    .map(m => Number(m[1]))
    .sort((a, b) => a - b)
  if (!rows.length) throw new Error('fire-plan-anchors: 1.9 비상연락 행을 못 찾았다')
  return rows
})()

/** 「현장대응」 블록 행 수 — 19행 피난약자 머리글이 자동으로 끊는다 */
export const BRIG9_FIELD_ROWS = labelBlockRows(BRIG9_SHEET, 'A13')
export const BRIG9_FIELD_FIRST_ROW = 13

const BRIG9_SEEDS: Seed[] = [
  { field: 'brig9_running', sheet: BRIG9_SHEET, cell: BRIG9_RUNNING_CELL, labelCell: BRIG9_RUNNING_CELL },
  { field: 'brig9_total', sheet: BRIG9_SHEET, cell: BRIG9_TOTAL_CELL, labelCell: BRIG9_TOTAL_CELL },
  ...BRIG9_TEAM_CELLS.map(([k, , cell]) => ({ field: `brig9_team_${k}`, sheet: BRIG9_SHEET, cell, labelCell: cell })),
  ...BRIG9_COLS.flatMap(([col, key]) => [
    { field: `brig9_lead_${key}`, sheet: BRIG9_SHEET, cell: `${col}${BRIG9_LEAD_ROW}`, labelCell: `A${BRIG9_LEAD_ROW}` },
    { field: `brig9_dep_${key}`, sheet: BRIG9_SHEET, cell: `${col}${BRIG9_DEP_ROW}`, labelCell: `A${BRIG9_DEP_ROW}` },
  ]),
  ...BRIG9_EMER_ROWS.flatMap((row, i) =>
    BRIG9_COLS.map(([col, key]) => ({ field: `brig9_emer${i}_${key}`, sheet: BRIG9_SHEET, cell: `${col}${row}`, labelCell: `A${row}` }))),
  ...Array.from({ length: BRIG9_FIELD_ROWS }, (_, i) =>
    BRIG9_COLS.map(([col, key]) => ({
      field: `brig9_fld${i}_${key}`,
      sheet: BRIG9_SHEET,
      cell: `${col}${BRIG9_FIELD_FIRST_ROW + i}`,
      labelCell: `A${BRIG9_FIELD_FIRST_ROW}`,
    }))).flat(),
]

/* ─────────── 서식 2.14 교육·훈련 결과기록부 앞쪽 (2026-09-17) ───────────
 *  별지 제13호서식이라 **상자가 `[  ]`**다(표시는 `√`). `isBoxLabelAnchor`가 `□`만 보므로
 *  이 시트는 manifest 집계에서 **상자 0**으로 잡혔다 — 여덟째 갈래 `isBracketBoxAnchor`를 세웠다.
 *
 *  ⭐ 이 시트는 1.1 · 1.7.1 · 2.2의 사실을 **다시 인쇄한다**. 전부 같은 원천·같은 표기를 쓴다:
 *    등급 ← `d.grade`(1.1 T9·2.1 등급상자) · 관리자 성명/연락처 ← 1.1 AW6/AW7 ·
 *    선임일자 ← 1.7.1 AE4(`planDate` 공유) · 대장 성명/연락처 ← `brigadeHeads`(2.2·1.9).
 *
 *  ⚠ 안 채우는 칸과 이유:
 *   · 근무인원 4칸(평일·휴일 × 주간·야간) — 1.1은 `상시/거주/최대` 축이다. **다른 축**이라
 *     3.3의 인원 3칸과 같은 사유로 비운다.
 *   · 보조자 3행(14~16행) — 1.7.1도 같은 이유로 4행만 쓴다(보조자 축이 얇다).
 *   · 보유자격 · 비고 · 초기대응체계 조직구성/총원 · 교육결과 참석/미참석 — ERP에 축이 없다.
 *   · 팀별 인원 5칸(부대장·통보연락·초기소화·피난유도·비상연락) — 2.1·1.9와 **같은 결정**.
 *   · 주요내용·보완사항·조치사항 — 템플릿에 **표본 문장**이 박혀 있다(자리표시칸의 친척인데
 *     자구가 시각 꼴이 아니라 자유 문장이라 `isPlaceholderLabelAnchor`가 안 문다). 덮으려면
 *     예외를 자유 문장까지 넓혀야 하는데, 그러면 **표본의 답이 그 뒤에 숨는다**. 안 건드린다.
 */
export const REC14_SHEET = FP_SHEET.F2_14

/** 등급 각괄호 상자 — [셀, 자구]. 2.1 `BRIG1_GRADE_CELLS`와 같은 사실을 다른 양식으로 찍는다 */
export const REC14_GRADE_CELLS: ReadonlyArray<readonly [string, string]> = [
  ['R11', '특급'], ['AB11', '1급'], ['AL11', '2급'], ['AV11', '3급'],
]

const REC14_SEEDS: Seed[] = [
  ...REC14_GRADE_CELLS.map(([cell, g]) => ({ field: `rec14_grade_${g}`, sheet: REC14_SHEET, cell, labelCell: cell })),
  // 소방안전관리자 첫 행(13행) — 성명·선임일자·연락처, 자격구분은 「주」
  { field: 'rec14_mgr_name', sheet: REC14_SHEET, cell: 'J13', labelCell: 'J12' },
  { field: 'rec14_mgr_date', sheet: REC14_SHEET, cell: 'R13', labelCell: 'R12' },
  { field: 'rec14_mgr_phone', sheet: REC14_SHEET, cell: 'AS13', labelCell: 'AS12' },
  { field: 'rec14_mgr_main', sheet: REC14_SHEET, cell: 'AG13', labelCell: 'AG13' },
  { field: 'rec14_mgr_sub', sheet: REC14_SHEET, cell: 'AK13', labelCell: 'AK13' },
  // 자위소방대 — 총원·대장 성명·대장 연락처
  { field: 'rec14_brig_total', sheet: REC14_SHEET, cell: 'J18', labelCell: 'J17' },
  { field: 'rec14_brig_lead', sheet: REC14_SHEET, cell: 'R18', labelCell: 'R17' },
  { field: 'rec14_brig_phone', sheet: REC14_SHEET, cell: 'R20', labelCell: 'R19' },
]

/* ─────────── 서식 2.14 뒷쪽 — 교육·훈련 참석확인 (2026-09-17) ───────────
 *  25행 × 2단 = **50명** 명단. 연번은 양식이 이미 인쇄해 두었다(1~25 / 26~50).
 *
 *  ⭐ 이 시트는 **서명받을 명단**이지 참석 기록이 아니다. `직책`·`성명`을 미리 찍는 것은
 *    「이 사람들이 참석했다」는 주장이 아니라 **받아쓰기를 대신하는 것**이다.
 *  🚨 그래서 **`확인` 칸은 비운다.** 거기에 무엇이든 찍으면 그 순간 **참석을 단언하게 된다** —
 *    ERP는 누가 참석했는지 모른다(앞쪽 `참석/미참석` 인원 칸을 비워 둔 것과 같은 이유).
 *  ⚠ 명단은 **자위소방대만** 채운다. 양식은 초기대응체계 대원까지 받는데 ERP에 그 축이 없다.
 *  ⚠ 직책은 `team`이다 — `duty`는 개별임무(`119신고 및 상황전파`)라 직책이 아니다.
 *    1.9·2.2가 구분 칸에 쓰는 그 축과 같다.
 */
export const ATT14_SHEET = FP_SHEET.F2_14_BACK

/** 한 단의 행 수 — 양식이 매긴 **연번 구간에서 파생**한다(1~25) */
export const ATT14_ROWS = numberedRowBudget(ATT14_SHEET)
export const ATT14_FIRST_ROW = 3

/** 두 단 — [직책 열, 성명 열, 머리글 셀]. `확인`(W·BA)은 **일부러 뺐다**(서명 자리) */
export const ATT14_COLS: ReadonlyArray<readonly [string, string, string]> = [
  ['F', 'O', 'F2'],    // 왼쪽 단  1~25
  ['AJ', 'AS', 'AJ2'], // 오른쪽 단 26~50
]

/** 명단 정원 — 두 단 합(50) */
export const ATT14_CAPACITY = ATT14_ROWS * ATT14_COLS.length

const ATT14_SEEDS: Seed[] = ATT14_COLS.flatMap(([colRole, colName, labelCell], c) =>
  Array.from({ length: ATT14_ROWS }, (_, i) => {
    const n = c * ATT14_ROWS + i
    const row = ATT14_FIRST_ROW + i
    return [
      { field: `att14_${n}_role`, sheet: ATT14_SHEET, cell: `${colRole}${row}`, labelCell },
      { field: `att14_${n}_name`, sheet: ATT14_SHEET, cell: `${colName}${row}`, labelCell },
    ]
  }).flat())

/* ─────────── 서식 3.5 피난약자 현황·계획 (2026-09-17) ───────────
 *  🚨 **①류다 — PDF는 이미 인쇄하는데 엑셀만 통째로 공란이었다.** `vulnerable`(해당여부·유형별
 *    근무/이용 인원·피난계획 행)과 `vulnerableMethods`가 ERP에 **다 있다**.
 *  🚨 1.9 선언부에 「피난약자는 ERP에 데이터가 없다」고 적어 둔 건 **틀린 말이었다**(같은 커밋에서
 *    고쳤다). 사유 주석이 낡는 그 함정을 또 밟았다 — 주석은 증거가 아니다.
 *
 *  ⭐ 유형 목록을 **세 번째로 베끼지 않는다.** 여기 적은 자구는 양식 라벨(`☐ 노인`)에 실제로
 *    들어 있는지 검사가 확인하므로, 양식이 개정되면 빨강이 된다(등급 상자와 같은 규약).
 *
 *  ⚠ 「구역」은 양식이 **동·층 두 칸**인데 ERP는 **한 칸**이다(입력 힌트가 `구역(동·층)`).
 *    쪼개되 **전부 아니면 전무**로 한다 — 토큰이 모두 `동`/`층`으로 끝날 때만 각 칸에 넣고,
 *    하나라도 남으면 **둘 다 비우고 센다**. 조각만 넣으면 `3동 4층 로비`의 `로비`가 조용히
 *    사라진다(조용한 절단은 조용한 누락이다).
 *  ⚠ 시설이용자 줄에는 인원 칸이 없다 — 양식이 상자만 그려 두었다. `use`는 상자만 켠다.
 */
export const VUL_SHEET = FP_SHEET.F3_5

/** 근무·거주자 — [유형, 상자 셀, 인원 셀(단위칸 ` 명`)] */
export const VUL_WORK_CELLS: ReadonlyArray<readonly [string, string, string]> = [
  ['노인', 'H3', 'Q3'], ['어린이', 'Y3', 'AG3'], ['영유아', 'AT3', 'BA3'],
  ['임산부', 'H4', 'Q4'], ['장애인', 'Y4', 'AG4'], ['기타', 'AT4', 'BA4'],
]

/** 시설이용자 — [유형, 상자 셀]. **인원 칸이 없다**(양식이 상자만 그렸다) */
export const VUL_USE_CELLS: ReadonlyArray<readonly [string, string]> = [
  ['노인', 'H5'], ['어린이', 'R5'], ['영유아', 'AB5'], ['임산부', 'AJ5'], ['장애인', 'AU5'], ['기타', 'BB5'],
]

/** 피난계획 표 — 머리글 2줄(6·7행)을 빼고 나머지가 데이터 행이다(22행 비고가 끊는다) */
export const VUL_PLAN_ROWS = labelBlockRows(VUL_SHEET, 'A6') - 2
export const VUL_PLAN_FIRST_ROW = 8

/** [엑셀 열, 필드 접미사, 머리글 셀] — `구역`(H·M)은 아래에서 따로 다룬다(둘로 쪼개야 해서) */
export const VUL_PLAN_COLS: ReadonlyArray<readonly [string, string, string]> = [
  ['R', 'count', 'R6'],   // 인원
  ['U', 'type', 'U6'],    // 유형
  ['AD', 'helper', 'AD6'], // 피난보조자
  ['AK', 'equip', 'AK6'],  // 피난보조장비
  ['AS', 'method', 'AS6'], // 세부 피난방법
]

/** 구역 두 칸 — [엑셀 열, 필드 접미사, 머리글 셀] */
export const VUL_AREA_COLS: ReadonlyArray<readonly [string, string, string]> = [
  ['H', 'dong', 'H7'], ['M', 'floor', 'M7'],
]

const VUL_SEEDS: Seed[] = [
  ...VUL_WORK_CELLS.flatMap(([t, box, n]) => [
    { field: `vul_work_${t}_box`, sheet: VUL_SHEET, cell: box, labelCell: box },
    { field: `vul_work_${t}_n`, sheet: VUL_SHEET, cell: n, labelCell: n },
  ]),
  ...VUL_USE_CELLS.map(([t, box]) => ({ field: `vul_use_${t}_box`, sheet: VUL_SHEET, cell: box, labelCell: box })),
  ...Array.from({ length: VUL_PLAN_ROWS }, (_, i) =>
    [...VUL_PLAN_COLS, ...VUL_AREA_COLS].map(([col, key, labelCell]) => ({
      field: `vul_plan${i}_${key}`,
      sheet: VUL_SHEET,
      cell: `${col}${VUL_PLAN_FIRST_ROW + i}`,
      labelCell,
    }))).flat(),
]

/* ─────────── 1.9 19~25행 피난약자 블록 (2026-09-17) ───────────
 *  **3.5의 축약본이다.** 같은 워크북 안에서 3.5는 피난약자를 인쇄하는데 1.9만 비어 있으면
 *  그게 D-7 갈라짐이다 — 그래서 값을 **나눠 쓴다**(상자는 `counts[유형].work`, 표는 같은
 *  `plans[]`와 같은 `splitAreaDongFloor`).
 *
 *  ⚠ 3.5보다 **좁다**. 이 블록에만 있는 칸은 ERP에 축이 없다:
 *   · `성 명` · `연락처(피난약자)` · `피난보조 연락처` — `plans[]`는 **인원 수**를 담지
 *     이름·전화를 담지 않는다(3.5도 같다).
 *   · `피난계획`(AG) — 양식이 표준문구를 이미 인쇄해 두었다(`피난보조자의 보조를 받아 피난`).
 *   · 상자가 **5종**뿐이다 — 3.5의 `기타`가 여기엔 없다. 목록을 베끼지 않고 각 셀에 적은
 *     자구가 양식 라벨에 실제로 있는지 검사가 확인한다.
 *  ⚠ `활동 구역`은 단위칸(`    층`)이다 — 3.5가 쪼갠 **층 조각**만 들어간다.
 */
export const VUL9_SHEET = BRIG9_SHEET

/** 피난약자 상자 5종 — [유형, 셀]. 3.5 `VUL_WORK_CELLS`와 **같은 판정**을 쓴다 */
export const VUL9_BOX_CELLS: ReadonlyArray<readonly [string, string]> = [
  ['노인', 'H20'], ['임산부', 'Q20'], ['영유아', 'AD20'], ['어린이', 'AL20'], ['장애인', 'AY20'],
]

/** 표 행 수 — 머리글 2줄(21·22행)을 빼고 나머지(26행 비고가 끊는다) */
export const VUL9_ROWS = labelBlockRows(VUL9_SHEET, 'A21') - 2
export const VUL9_FIRST_ROW = 23

/** [엑셀 열, 필드 접미사, 머리글 셀] — `성명`·`연락처` 두 칸은 ERP에 축이 없어 뺐다 */
export const VUL9_COLS: ReadonlyArray<readonly [string, string, string]> = [
  ['H', 'floor', 'H21'],   // 활동 구역 — 단위칸 `    층`
  ['N', 'type', 'N21'],    // 피난약자 유형
  ['AT', 'helper', 'AT22'], // 피난보조 보조자
]

const VUL9_SEEDS: Seed[] = [
  ...VUL9_BOX_CELLS.map(([t, cell]) => ({ field: `vul9_box_${t}`, sheet: VUL9_SHEET, cell, labelCell: cell })),
  ...Array.from({ length: VUL9_ROWS }, (_, i) =>
    VUL9_COLS.map(([col, key, labelCell]) => ({
      field: `vul9_${i}_${key}`,
      sheet: VUL9_SHEET,
      cell: `${col}${VUL9_FIRST_ROW + i}`,
      labelCell: key === 'floor' ? `${col}${VUL9_FIRST_ROW + i}` : labelCell,
    }))).flat(),
]

/* ─────────── 서식 3.4 피난유도 절차·경로 (2026-09-17) ───────────
 *  🚨 **①류다** — PDF는 비화재보·피난경로·집결지를 이미 인쇄하는데 엑셀만 공란이었다.
 *    막고 있던 건 좌표가 아니라 **법정 예시문**이다(`isSampleTextAnchor` 참조).
 *
 *  ⭐ 집결지는 **두 칸에 같은 값**이 들어간다(경로표 `AT10`·집결지 블록 `T13`). 한 곳에서만
 *    고치면 한 장 안에서 갈라지므로 검사가 둘을 맞댄다.
 *
 *  ⚠ 안 채우는 칸과 이유:
 *   · `화재 시` 아래 표(G7 동·L7 층·Q7 피난유도자·AC7 피난방법) — ERP의 `evacNote`는
 *     **자유 문장 한 칸**이라 네 칸으로 쪼갤 수 없다. 3.5 구역과 달리 `동`/`층` 표식도 없다.
 *   · `동별`(A10) — ERP 피난경로에 동 축이 없다(1.2.1·3.3과 같은 사유).
 *   · `피난경로 개수`(J10) — ERP `route`는 **경로 설명 문장**이지 개수가 아니다.
 *   · `확인사항`(T14) — ERP에 축이 없다.
 *  ⚠ 경로 행은 양식이 **한 줄**만 그려 두었다 — 넘치는 경로는 세어서 고지한다.
 */
export const EVAC34_SHEET = FP_SHEET.F3_4

/** 경로 한 줄 — [엑셀 열, 필드 접미사, 머리글 셀] */
export const EVAC34_ROUTE_COLS: ReadonlyArray<readonly [string, string, string]> = [
  ['E', 'floor', 'E9'],   // 층별
  ['W', 'guide', 'W9'],   // 피난유도자
  ['AI', 'equip', 'AI9'], // 피난구조설비
]
export const EVAC34_ROUTE_ROW = 10

const EVAC34_SEEDS: Seed[] = [
  // 법정 예시문칸 — 값이 있으면 덮고, 없으면 예시가 남는다(빈 서식이 뜻을 잃지 않게)
  { field: 'evac34_false_alarm', sheet: EVAC34_SHEET, cell: 'G4', labelCell: 'A4' },
  { field: 'evac34_route_text', sheet: EVAC34_SHEET, cell: 'A11', labelCell: 'A11' },
  { field: 'evac34_assembly_row', sheet: EVAC34_SHEET, cell: 'AT10', labelCell: 'AT9' },
  { field: 'evac34_assembly', sheet: EVAC34_SHEET, cell: 'T13', labelCell: 'J13' },
  ...EVAC34_ROUTE_COLS.map(([col, key, labelCell]) => ({
    field: `evac34_${key}`, sheet: EVAC34_SHEET, cell: `${col}${EVAC34_ROUTE_ROW}`, labelCell,
  })),
]

/* ─────────── 서식 3.6 피난약자 유형별 피난 방법 (2026-09-17) ───────────
 *  3.4가 세운 **법정 예시문칸**으로 열린 시트다. 네 줄이 통째로 예시문이었다.
 *
 *  ⭐ 유형 이름을 손으로 적지 않는다 — **A열 라벨이 곧 유형**이다(`노인`·`어린이`·…).
 *    ERP `vulnerableMethods`는 유형 이름을 열쇠로 쓰므로 그대로 물어보면 된다.
 *  ⚠ 양식은 **4종**뿐이다(노인·어린이·임산부·장애인). ERP의 `영유아`·`기타`는 갈 줄이 없어
 *    버리되 **센다**(`vulnerableMethodsUnmapped`).
 *  ⚠ `유의사항`(AZ)은 ERP에 축이 없다 — 3~5행은 양식 문구가 남고 6행은 빈 채로 둔다.
 */
export const VUL36_SHEET = FP_SHEET.F3_6

/** 방법 칸 — [유형 라벨 셀, 방법 셀]. 유형 이름은 **라벨에서 읽는다**(목록을 베끼지 않는다) */
export const VUL36_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['A3', 'K3'], ['A4', 'K4'], ['A5', 'K5'], ['A6', 'K6'],
]

/** 양식이 인쇄하는 유형 4종 — A열 라벨에서 파생 */
export const VUL36_TYPES: readonly string[] = VUL36_ROWS.map(([a]) => labelAt(VUL36_SHEET, a).trim())

const VUL36_SEEDS: Seed[] = VUL36_ROWS.map(([a, k]) => ({
  field: `vul36_${labelAt(VUL36_SHEET, a).trim()}`,
  sheet: VUL36_SHEET,
  cell: k,
  labelCell: a,
}))

/* ─────────── 서식 2.3 조직도 (2026-09-17) ───────────
 *  Type-Ⅲ 조직도다. 대장·부대장 상자와 현장대응팀 소속·인원 표.
 *
 *  ⭐ 대장·부대장은 **2.2·1.9·2.14와 같은 술어**(`brigadeHeads`)로 뽑는다 — 네 시트가
 *    같은 사람을 다르게 그리면 D-7 갈라짐이다. 소속도 2.2와 같은 규약(대원 있을 때만 건물명).
 *  ⭐ 현장대응팀 표(3행)는 **첫 행에만** 건물명·대원 수를 적는다 — ERP 편성표는 조직(부서)
 *    축이 없어 한 소속으로 본다(2.2가 org를 건물명 하나로 두는 그 판정). 남는 두 행은 비운다.
 *  ⚠ 초기대응체계 조·인원 칸(AU7·BA7·AU9·BA9)은 비운다 — ERP에 조 편성 축이 없다
 *    (2.1의 「운영시간·조 편성은 일부러 안 세웠다」와 같은 결정).
 */
export const ORG23_SHEET = FP_SHEET.F2_3

const ORG23_SEEDS: Seed[] = [
  { field: 'org23_lead_org', sheet: ORG23_SHEET, cell: 'V5', labelCell: 'V4' },
  { field: 'org23_lead_name', sheet: ORG23_SHEET, cell: 'AE5', labelCell: 'AE4' },
  { field: 'org23_dep_org', sheet: ORG23_SHEET, cell: 'V9', labelCell: 'V8' },
  { field: 'org23_dep_name', sheet: ORG23_SHEET, cell: 'AE9', labelCell: 'AE8' },
  { field: 'org23_field_org', sheet: ORG23_SHEET, cell: 'C14', labelCell: 'C13' },
  { field: 'org23_field_n', sheet: ORG23_SHEET, cell: 'AG14', labelCell: 'AG13' },
]

const BRIG1_SEEDS: Seed[] = [
  { field: 'brig1_name', sheet: BRIG1_SHEET, cell: 'M5', labelCell: 'A5' },
  { field: 'brig1_address', sheet: BRIG1_SHEET, cell: 'M6', labelCell: 'A6' },
  ...BRIG1_GRADE_CELLS.map(([cell, g]) => ({ field: `brig1_grade_${g}`, sheet: BRIG1_SHEET, cell, labelCell: cell })),
  ...BRIG1_HEADCOUNT_BANDS.map(([cell], i) => ({ field: `brig1_hc${i}`, sheet: BRIG1_SHEET, cell, labelCell: cell })),
  ...BRIG1_TYPE_CELLS.map(([cell], i) => ({ field: `brig1_type${i}`, sheet: BRIG1_SHEET, cell, labelCell: cell })),
  { field: 'brig1_total', sheet: BRIG1_SHEET, cell: 'V13', labelCell: 'V13' },
  ...BRIG1_TEAM_CELLS.flatMap(([k, , comp, duty]) => [
    { field: `brig1_team_${k}_c`, sheet: BRIG1_SHEET, cell: comp, labelCell: comp },
    { field: `brig1_team_${k}_d`, sheet: BRIG1_SHEET, cell: duty, labelCell: duty },
  ]),
]

const EVAC1_SEEDS: Seed[] = [
  ...EVAC1_STAIR_CELLS.map(([cell, k]) => ({ field: `evac1_stair_${k}`, sheet: EVAC1_SHEET, cell, labelCell: cell })),
  ...EVAC1_ETC_CELLS.map(([cell, k]) => ({ field: `evac1_etc_${k}`, sheet: EVAC1_SHEET, cell, labelCell: cell })),
  { field: 'evac1_elevators', sheet: EVAC1_SHEET, cell: EVAC1_ELEVATOR_CELL, labelCell: EVAC1_ELEVATOR_CELL },
]

const TRAIN_SEEDS: Seed[] = [
  ...TRAIN_ROWS.flatMap(([row, key]) =>
    TRAIN_MONTH_COLS.map((col, m) => ({
      field: `train_${key}_m${m + 1}`,
      sheet: TRAIN_SHEET,
      cell: `${col}${row}`,
      labelCell: `${col}${row}`,   // 상자칸 — 자기 칸이 라벨이다
    }))),
  ...TRAIN_TARGETS.flatMap(([key, boxCell, cntCell]) => [
    { field: `train_t_${key}`, sheet: TRAIN_SHEET, cell: boxCell, labelCell: boxCell },
    { field: `train_n_${key}`, sheet: TRAIN_SHEET, cell: cntCell, labelCell: cntCell },
  ]),
]

const MU_SEEDS: Seed[] = [
  ...MU_VALUE_CELLS.map(([k, cell, labelCell]) => ({ field: `mu_${k}`, sheet: MU_SHEET, cell, labelCell })),
  // 상자·자리표시는 **자기 칸이 라벨**이다(그 칸의 자구를 우리가 읽어 조립한다)
  ...MU_HOURS_CELLS.map(([k, cell]) => ({ field: `mu_${k}`, sheet: MU_SHEET, cell, labelCell: cell })),
  ...MU_USER_BOXES.map(([k, cell]) => ({ field: `mu_${k}`, sheet: MU_SHEET, cell, labelCell: cell })),
  // 수용인원 — 단위칸(`명`이 값 뒤에 붙는다)
  { field: 'mu_capacity', sheet: MU_SHEET, cell: 'AS8', labelCell: 'AS8' },
]

const HAZARD_SEEDS: Seed[] = HAZARD_PLACE_ROWS.flatMap((row, p) => [
  // 위치 — 값칸. 라벨은 그 행의 장소 이름(A열)이 닻이다.
  { field: `hazard_${p}_location`, sheet: HAZARD_SHEET, cell: `N${row}`, labelCell: `A${row}` },
  // 위험요소 — 상자칸(자기 칸이 라벨이다)
  ...HAZARD_BOXES.map(([col, dy]) => ({
    field: `hazard_${p}_${col}${dy}`,
    sheet: HAZARD_SHEET,
    cell: `${col}${row + dy}`,
    labelCell: `${col}${row + dy}`,
  })),
])

const FIREHIST_SEEDS: Seed[] = Array.from({ length: FIREHIST_ROWS }, (_, i) =>
  FIREHIST_COLS.map(([col, key, labelCell]) => ({
    field: `firehist_${i}_${key}`,
    sheet: FIREHIST_SHEET,
    cell: `${col}${FIREHIST_FIRST_ROW + i}`,
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

export const FIRE_PLAN_ANCHORS: Anchor[] = assemble([...FIXED_SEEDS, ...ZONE_SEEDS, ...BRIG_SEEDS, ...FORM14_SEEDS, ...FIREHIST_SEEDS, ...HAZARD_SEEDS, ...MU_SEEDS, ...TRAIN_SEEDS, ...EVAC1_SEEDS, ...BRIG1_SEEDS, ...FIREWORK_SEEDS, ...CONSTRUCTION_SEEDS, ...EVAC3_SEEDS, ...BRIG9_SEEDS, ...REC14_SEEDS, ...ATT14_SEEDS, ...VUL_SEEDS, ...VUL9_SEEDS, ...EVAC34_SEEDS, ...VUL36_SEEDS, ...ORG23_SEEDS])

/* ══════════════════════ §사진상자 (2026-09-14) ══════════════════════
 *
 *  법정 서식은 사진·도면을 붙이라고 큰 상자를 비워 둔다. 그 상자들은 **글자 앵커가 아니다** —
 *  값 맵도 `toInjectTargets`도 여기 관여하지 않는다. 그래서 `FIRE_PLAN_ANCHORS`와 **따로**
 *  둔다: 저쪽에 섞으면 `missingValueFields`가 '값이 없는 필드'라며 생성을 500으로 끊는다.
 *
 *  같은 것을 공유하는 것은 **검증 규약**이다 — `validateAnchors`에 이 목록을 따로 한 번 더
 *  먹여 라벨 대조·자가치유를 그대로 받는다(좌표를 쓰되 좌표만 믿지 않는다).
 *
 *  ⚠ **라벨칸을 상자 자신으로 잡지 않는다**(1.5.2). 그 시트는 같은 블록이 두 벌이라
 *    `[해당 층 평면도]`가 A4·A6 **두 칸에 똑같이** 있다. 상자 자신을 라벨로 삼으면 A4가
 *    어긋났을 때 자가치유가 **유일 후보인 A6로 옮겨 붙어** 두 그림이 한 상자에 겹친다.
 *    그래서 둘 다 시트에서 유일한 제목칸 A1에 물린다 — 서식이 밀리면 **함께** 따라 옮겨진다.
 *
 *  ⚠ `descr`(대체 텍스트)도 자구를 베끼지 않는다. manifest의 그 칸 글자를 쓰고, 없으면 라벨칸 글자.
 */

/** 상자 하나 — 어떤 그림(kind)의 몇 번째 장이 어디에 앉는가 */
export type FirePlanImageBox = Seed & {
  /** `assembleFirePlan()`이 붙이는 이미지 종류 — **우선순위 순서**다.
   *  앞의 것이 있으면 뒤의 것은 이 상자에 못 앉고 **고지로 나간다**(조용히 버리지 않는다).
   *  대부분 한 종류뿐이고, 두 개인 곳은 1.3 「건축물 위치」뿐이다(표지 사진 > 위치도 약도). */
  kinds: readonly ('cover' | 'map' | 'route' | 'entry' | 'evacmap')[]
  /** 같은 kind가 여러 장일 때 몇 번째를 이 상자에 넣는가(0부터) */
  index: number
  /** 그림이 앉으면 **그 칸의 글자를 비운다** — `[해당 층 평면도]` 같은 '여기 붙이시오' 안내다.
   *  그림이 **없으면 남긴다**(그 안내가 곧 서식이다).
   *  ⚠ 좌표를 따로 적지 않는 이유: 자가치유로 상자가 옮겨지면 안내 글자도 함께 옮겨져 있다. */
  clearPlaceholder?: boolean
}

export const FIRE_PLAN_IMAGE_BOXES: FirePlanImageBox[] = [
  /* 「건축물 위치」 칸은 **표지 건물 사진**이다(위치도 약도가 아니다) — 우선순위는 PDF와 공유하는
     `LOCATION_BOX_KINDS`가 정한다. 여기에 배열을 베껴 적으면 두 표면이 갈라진다. */
  { field: 'img_location_map', kinds: LOCATION_BOX_KINDS, index: 0, sheet: FP_SHEET.F1_3_LOC,   cell: 'A3', labelCell: 'A2' },
  { field: 'img_route',        kinds: ['route'], index: 0, sheet: FP_SHEET.F1_3_ROUTE, cell: 'A2', labelCell: 'A1' },
  { field: 'img_entry',        kinds: ['entry'], index: 0, sheet: FP_SHEET.F1_3_ROUTE, cell: 'A4', labelCell: 'A3' },
  { field: 'img_evacmap_1', kinds: ['evacmap'], index: 0, sheet: FP_SHEET.F1_5_2, cell: 'A4', labelCell: 'A1', clearPlaceholder: true },
  { field: 'img_evacmap_2', kinds: ['evacmap'], index: 1, sheet: FP_SHEET.F1_5_2, cell: 'A6', labelCell: 'A1', clearPlaceholder: true },
]

/** 사진 상자의 라벨 검증용 앵커 — 라우트가 `validateAnchors(bytes, FIRE_PLAN_IMAGE_ANCHORS)`로 쓴다 */
export const FIRE_PLAN_IMAGE_ANCHORS: Anchor[] = assemble(
  FIRE_PLAN_IMAGE_BOXES.map(({ field, sheet, cell, labelCell }) => ({ field, sheet, cell, labelCell })))

/** 상자의 대체 텍스트 — 그 칸 글자가 있으면 그것(`[해당 층 평면도]`), 없으면 라벨칸 글자 */
export function imageBoxDescr(b: FirePlanImageBox): string {
  return (sheetManifest(b.sheet).labels[b.cell] ?? labelAt(b.sheet, b.labelCell)).trim()
}

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
 * **각괄호 상자칸인가**(2026-09-17, 2.14 결과기록부) — 상자가 `□`가 아니라 `[  ]`인 갈래.
 *
 * 별지 제13호서식 계열은 상자를 **글리프가 아니라 각괄호**로 그리고, 표시도 `■`가 아니라
 * `√`다(시트 스스로 그렇게 적어 놓았다 — `※ [ ]에는 해당되는 곳에 √표를 합니다`).
 * 그래서 `isBoxLabelAnchor`가 이 칸들을 **한 개도 못 본다** — 실제로 2.14의 등급 4칸과
 * 자격구분 2칸은 manifest 상자 집계에서 `상자 0`으로 잡혔다.
 *
 * 🚨 규칙을 좁게 잡는다: **각괄호 안이 공백뿐**이어야 한다. `[√]`·`[1]`은 통과하지 못하므로
 *   표본의 답이 이 예외 뒤에 숨지 못한다(단위칸이 숫자를 거르는 것과 같은 수법).
 */
export function isBracketBoxAnchor(a: { sheet: string; cell: string }): boolean {
  const lbl = sheetManifest(a.sheet).labels[a.cell]
  return !!lbl && /\[\s+\]/.test(lbl) && !/\[[^\]\s]/.test(lbl)
}

/**
 * **법정 예시문칸인가**(2026-09-17, 3.4) — 템플릿이 **자유 문장인 보기 값**을 이고 있는 칸.
 *
 * 자리표시칸(`00시~00시`)의 형제인데 자구가 시각 꼴이 아니라 문장이라 **모양으로 가를 수 없다**.
 * 이 벽 때문에 ①류(PDF는 인쇄하는데 엑셀만 공란)가 세 시트에서 닫히지 않고 있었다.
 *
 * 🚨 **좌표만 적으면 봐주기 목록이지만, 자구까지 적으면 봐주기가 아니다.**
 *   아래 표는 [시트, 셀, 템플릿이 이고 있는 **정확한 자구**]를 들고, 검사가
 *   ①자구가 글자까지 맞는지 ②값이 있을 때 **실제로 덮이는지**를 함께 묻는다.
 *   지워졌어야 할 표본의 답이 이 뒤에 숨으려면 그 답을 여기 **또박또박 적어야** 하고,
 *   그건 검토에서 눈에 띄는 행위다 — 모양 술어가 못 하는 일을 **내용 고정**이 한다.
 */
export const FIRE_PLAN_SAMPLE_CELLS: ReadonlyArray<readonly [string, string, string]> = [
  [FP_SHEET.F3_4, 'G4', '피난 실시 및 1층 주차장 대기 후 오동작 각 세대 전파'],
  [FP_SHEET.F3_4, 'A11', '각 세대 출입구 앞 직통계단 이용'],
  [FP_SHEET.F3_4, 'AT10', '1층 주차장'],
  [FP_SHEET.F3_4, 'T13', '1층 주차장 '],
  /* 3.6 유형별 피난방법 4줄 — 양식이 표준 예시를 길게 인쇄해 두었다.
   * ⚠ 자구를 **고치지 말 것.** K4의 `천전히`는 양식 원문의 오자이고, 우리가 바로잡으면
   *   핀이 어긋나 빨강이 된다 — 그게 이 핀이 하는 일이다(양식을 우리가 고쳐 쓰지 않는다). */
  [FP_SHEET.F3_6, 'K3', '1. 1인 1조 또는 2인 1조로 보행을 도와주며 피난보조\n2. 긴급을 요할 경우 추가 도움을 요청하여 이동\n3. 피난층으로 피난 불가시 옥상 또는 세대 베란다로 이동하여 대기 하거나 완강기 이용하여 피난 시도'],
  [FP_SHEET.F3_6, 'K4', '보호자의 도움을 받아 함께 보조하며 피난 \n다수의 경우 한줄로 서서 천전히 연기를 피해 업드린 자세로 피난'],
  [FP_SHEET.F3_6, 'K5', '1. 보호자의 도움을 받아 함께 보조하며 피난 \n2. 만삭의 경우 2인 1조로 부축하여 피난 '],
  [FP_SHEET.F3_6, 'K6', '보조자의 도움을 받아 함께 피난\n장애유형별에 따라 피난 실시\n청각 : 표정, 제스처를 통해 피난해야 함을 알림, 스마트폰 문자 알림 이용\n시각 : 옆에서 구두 지시하며 피난\n지적 : 보호자나 담당자가 도와주는 것을 보조\n지체 : 2인 1조 또는 업어서 피난 실시'],
]

const SAMPLE_KEYS = new Set(FIRE_PLAN_SAMPLE_CELLS.map(([s, c]) => `${s}!${c}`))

export function isSampleTextAnchor(a: { sheet: string; cell: string }): boolean {
  return SAMPLE_KEYS.has(`${a.sheet}!${a.cell}`)
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

/**
 * **접두라벨칸인가**(2026-09-14, 1.4 대상명) — 자구가 `:`로 끝나 **값이 뒤에 올 자리**인가.
 *
 * 단위칸의 거울상이다(거긴 자구가 값 뒤, 여긴 앞). `■ 대상명 : ` 은 상자칸이 아니라 불릿이라
 * `isBoxLabelAnchor`에 안 걸리고, 두 글자 단위도 아니라 `isUnitLabelAnchor`에도 안 걸린다.
 *
 * 🚨 판별을 `셀 글자 == manifest 라벨`에 맡기지 않는 이유는 단위칸과 같다 — 그건 항진명제라
 *   표본 답이 예외 뒤에 숨는다. 여기서는 **'구분자로 끝나 아직 아무 답도 없는가'**를 묻는다:
 *   표본이 답을 적어 두었다면(`■ 대상명 : 강순기`) 콜론이 끝이 아니게 되어 곧바로 붉어진다.
 */
export function isPrefixLabelAnchor(a: { sheet: string; cell: string }): boolean {
  const lbl = sheetManifest(a.sheet).labels[a.cell]
  return !!lbl && /[:：]\s*$/.test(lbl)
}

/**
 * **연월칸인가**(2026-09-14, 1.10.1 점검시기) — 자구가 `년`·`월` **둘뿐**이고 나머지는 공백인가.
 *
 * 백지 불변식의 다섯째 예외다. 단위칸의 친척이지만 자구가 값 **사이사이에** 끼어 있다
 * (`'          년        월'` — 빈칸 두 자리가 연·월을 받는 서식 골격이다). 지우면 그 줄이
 * 그냥 빈 칸이 되어 무엇을 적는 자리인지 알 수 없게 되므로 공란을 요구할 수 없다.
 *
 * 🚨 여기서도 판별을 `셀 글자 == manifest 라벨`에 맡기지 않는다(항진명제 — §단위칸 참조).
 *   대신 **'남은 글자가 자구뿐인가'**를 묻는다: 숫자가 한 자라도 있으면 그건 자구가 아니라
 *   표본의 답이므로 이 예외를 통과하지 못하고 곧바로 붉어진다.
 */
export function isYearMonthLabelAnchor(a: { sheet: string; cell: string }): boolean {
  const lbl = sheetManifest(a.sheet).labels[a.cell]
  return !!lbl && /^\s*년\s*월\s*$/.test(lbl)
}

/**
 * **자리표시칸인가**(2026-09-17, 1.10.3 영업시간) — 템플릿이 **보기 값**을 이고 있는 칸.
 *
 * 백지 불변식의 다섯째 예외다. 앞의 넷과 성격이 다르다: 저쪽 자구는 값과 **함께** 인쇄되지만
 * 여기 자리표시는 값에 **통째로 갈린다**. 그래도 값이 없을 땐 남아야 한다 — 지우면 그 칸이
 * 무엇을 적는 자리인지 알 수 없게 된다.
 *
 * 🚨 손목록을 두지 않는다(상자칸과 같은 규약) — 목록으로 봐주기 시작하면 진짜 오염이 그
 *   목록에 숨는다. 대신 **'0으로만 이뤄진 시각 꼴인가'**를 묻는다: `00시~00시`는 통과하고
 *   `09:00~18:00` 같은 **실제 답은 통과하지 못한다**. 표본 시간이 이 예외 뒤에 숨을 수 없다.
 */
export function isPlaceholderLabelAnchor(a: { sheet: string; cell: string }): boolean {
  const lbl = sheetManifest(a.sheet).labels[a.cell]
  return !!lbl && /^\s*0+시\s*~\s*0+시\s*$/.test(lbl)
}

/**
 * **감싼단위칸인가**(2026-09-17, 1.11.1 거주자 인원) — 자구가 값을 **양쪽에서** 감싸는 칸.
 *
 * 단위칸의 변종이다(`약     명`). 판별은 여기서도 등식이 아니라 **'양끝이 한두 글자 자구이고
 * 가운데가 공백뿐인가'**를 묻는다 — 가운데에 숫자가 한 자라도 있으면 그건 표본의 답이라
 * 이 예외를 통과하지 못한다.
 */
export function isWrappedUnitAnchor(a: { sheet: string; cell: string }): boolean {
  const lbl = sheetManifest(a.sheet).labels[a.cell]
  if (!lbl || !/^[가-힣]{1,2}\s{2,}[가-힣㎡]{1,2}$/.test(lbl.trim())) return false
  // 🚨 **연월칸과 모양이 겹친다.** `년        월`도 같은 꼴이라 처음엔 그쪽까지 물었고
  //   검사가 즉시 잡았다(예외 1칸 기대에 5칸). 한 칸이 두 갈래에 속하면 예외 수 단언이
  //   서로를 가린다 — **더 좁은 갈래(연월)를 먼저** 떼어 낸다.
  return !isYearMonthLabelAnchor(a)
}

/** 값 맵이 반드시 채워야 하는 필드 전수(중복 제거) — S7-2 완결성 검사와 S5가 같은 목록을 본다 */
export const FIRE_PLAN_FIELDS: string[] = [...new Set(FIRE_PLAN_ANCHORS.map(a => a.field))]
