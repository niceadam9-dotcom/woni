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
import { labelAt, sheetManifest, tokenRowBudget } from '@/lib/fire-plan-xlsx-manifest'

/* ────────────────────────── 시트명 (manifest 키) ────────────────────────── */

export const FP_SHEET = {
  COVER: '표지',
  F1_1: '1.1 건축물 일반현황',
  F1_2_1: '1.2.1 구역별 세부현황',
  F1_3_ROUTE: '1.3 소방차 진입경로',
  F1_7_1: '1.7.1 소방안전관리자 선임현황',
  F1_8: '1.8 업무대행 현황',
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
 *  ⚠ **씨앗의 구멍 — 배선하지 못한 칸**(1단계 범위 밖으로 남긴다, 조용히 넘기지 않는다):
 *     · 1.2.1 구역별 세부현황의 **0열(동)** 과 **9열(관리 주체/입주사)** 에 토큰이 없다.
 *       ERP는 동 정보를 갖고 있으므로 2단계에서 라벨 축으로 앵커를 새로 세워야 한다.
 *     · 1.1의 대상물 급수·건축면적, 승강기·주차장·계단·운영시간·인원현황·공공기관·업무대행·
 *       권원분리·다중이용업·화재보험 **체크칸 전부**는 토큰이 없어 씨앗에 안 잡힌다.
 *       빈 상자 글자는 manifest가 이미 셀별로 들고 있으니(F-6) 2단계는 값 축만 얹으면 된다.
 *     · 1.15 피해 복구의 관할소방서·인근병원 칸은 스크럽으로 비워 두었다(표본 지역값).
 *       `fire_station`은 1.3에만 배선돼 있다.
 */

const FIXED_SEEDS: Seed[] = [
  // ── 표지 ── 라벨로 쓸 만한 문구가 '용도' 하나뿐이다(제목 칸 자신은 공란이 된다).
  // ⚠ 필드가 `customer_name`이 **아니다**: 원문이 `[ {{customer_name}} ] 소방계획서`라 이 칸엔
  //   고객명만 넣으면 `] 소방계획서`가 통째로 사라진다. 값 축이 manifest 원문에 값을 끼워 조립한다.
  { field: 'cover_title', sheet: FP_SHEET.COVER, cell: 'A3', labelCell: 'A1' },
  // 🎯 강순기 대조가 찾아낸 칸 — 양식엔 `☐ 복합건축물`, 강순기엔 `☐ 근린생활시설`이라
  //   **용도는 고객별 값**임이 드러났다. 토큰이 없어 씨앗에는 안 잡히던 자리다(S4-2 §구멍).
  //   빌드가 라벨을 비워 상자만 남겼고, 값 축이 `☐ {용도}`로 다시 조립한다.
  { field: 'cover_purpose', sheet: FP_SHEET.COVER, cell: 'B1', labelCell: 'A1' },

  // ── 서식 1.1 건축물 일반현황 ──
  { field: 'customer_name', sheet: FP_SHEET.F1_1, cell: 'C4', labelCell: 'A4' },
  { field: 'address', sheet: FP_SHEET.F1_1, cell: 'C5', labelCell: 'A5' },
  { field: 'owner_name', sheet: FP_SHEET.F1_1, cell: 'E6', labelCell: 'C6' },
  { field: 'manager_name', sheet: FP_SHEET.F1_1, cell: 'I6', labelCell: 'G6' },
  { field: 'owner_phone', sheet: FP_SHEET.F1_1, cell: 'E7', labelCell: 'C7' },
  // 🚨 씨앗은 `{{owner_phone}}`이었다 — §검토 기록 참조
  { field: 'manager_phone', sheet: FP_SHEET.F1_1, cell: 'I7', labelCell: 'G7' },
  { field: 'receiver_location', sheet: FP_SHEET.F1_1, cell: 'C8', labelCell: 'B8' },
  { field: 'purpose', sheet: FP_SHEET.F1_1, cell: 'G9', labelCell: 'F9' },
  { field: 'use_approval_date', sheet: FP_SHEET.F1_1, cell: 'J9', labelCell: 'H9' },
  { field: 'total_area', sheet: FP_SHEET.F1_1, cell: 'D10', labelCell: 'C10' },
  { field: 'floors', sheet: FP_SHEET.F1_1, cell: 'J10', labelCell: 'H10' },
  { field: 'height', sheet: FP_SHEET.F1_1, cell: 'D11', labelCell: 'C11' },
  { field: 'main_structure', sheet: FP_SHEET.F1_1, cell: 'G11', labelCell: 'F11' },
  { field: 'roof_structure', sheet: FP_SHEET.F1_1, cell: 'J11', labelCell: 'H11' },
  // 보험 4칸은 왼쪽이 병합이라 라벨이 **위**에 있다
  { field: 'insurance_company', sheet: FP_SHEET.F1_1, cell: 'C26', labelCell: 'C25' },
  { field: 'insurance_period', sheet: FP_SHEET.F1_1, cell: 'F26', labelCell: 'F25' },
  { field: 'insurance_amount_person', sheet: FP_SHEET.F1_1, cell: 'I26', labelCell: 'H26' },
  { field: 'insurance_amount_property', sheet: FP_SHEET.F1_1, cell: 'I27', labelCell: 'H27' },

  // ── 서식 1.3 소방차 진입경로 ── 서식이 수신기 위치를 두 곳에 반복한다(같은 값·같은 필드)
  { field: 'receiver_location', sheet: FP_SHEET.F1_3_ROUTE, cell: 'H3', labelCell: 'F3' },
  { field: 'fire_station', sheet: FP_SHEET.F1_3_ROUTE, cell: 'C5', labelCell: 'B5' },

  // ── 서식 1.7.1 선임현황 ── 왼쪽 칸(B4)은 공백 한 칸뿐이라 **열 머리**를 라벨로 쓴다
  { field: 'manager_name', sheet: FP_SHEET.F1_7_1, cell: 'C4', labelCell: 'C3' },
  { field: 'manager_selected_date', sheet: FP_SHEET.F1_7_1, cell: 'D4', labelCell: 'D3' },

  // ── 서식 1.8 업무대행 ── 원문이 `{{contract_date}} ~ ` 라 값 함수가 물결표까지 조립한다
  { field: 'agency_contract_period', sheet: FP_SHEET.F1_8, cell: 'C10', labelCell: 'B10' },
]

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
const ZONE_COLS: ReadonlyArray<readonly [string, string, string]> = [
  ['B', 'floor', 'B6'],   // 층
  ['C', 'usage', 'C4'],   // 명칭/용도
  ['D', 'area', 'D4'],    // (바닥)면적
  ['K', 'contact', 'K4'], // 담당자 (연락처)
]

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

export const FIRE_PLAN_ANCHORS: Anchor[] = assemble([...FIXED_SEEDS, ...ZONE_SEEDS])

/** 값 맵이 반드시 채워야 하는 필드 전수(중복 제거) — S7-2 완결성 검사와 S5가 같은 목록을 본다 */
export const FIRE_PLAN_FIELDS: string[] = [...new Set(FIRE_PLAN_ANCHORS.map(a => a.field))]
