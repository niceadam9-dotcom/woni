/** 서식 1.1 「시설현황」 — 승강기·계단 상자를 켜고 끄는 규칙 한 벌 (2026-09-16)
 *
 *  ■ 왜 별도 모듈인가
 *    이 규칙이 종전엔 **JSX와 조립기 안에 흩어져** 있었다. 화면은 칩으로, 엑셀은
 *    `!!txt(...)`로, PDF는 `ck(!!ef?.stairs?.[k])`로 — 같은 질문에 세 벌의 답이 있었고
 *    아무도 단언하지 못했다. 규칙을 JSX에 묻으면 검사가 붙을 자리가 없다(주차장이 입력기
 *    세 벌로 갈라진 원래 경로가 이것이다).
 *
 *  ■ 의존을 두지 않는다
 *    이 파일은 아무것도 import 하지 않는다. 서버 조립기·클라이언트 폼·검사 스크립트가
 *    **같은 함수**를 부르게 하려면 그래야 한다(react-server 조건이든 아니든 실린다).
 */

/* ── 공통 술어 ──────────────────────────────────────────────────────────────── */

/** 대수·개소에서 숫자를 읽는다. 읽을 수 없으면 `null`(= 모른다).
 *
 *  `INTEGER` 컬럼과 1.5 탭 JSON의 문자열(`'1'`)을 함께 받아야 해서 둘 다 문다. */
export function countOf(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim()
  if (s === '') return null
  const m = s.match(/-?\d+/)          // '1개소' · '2 대'도 읽는다
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

/** 서식의 □를 ■로 바꿀 것인가 — **1 이상일 때만**.
 *
 *  🚨 종전 판정은 `!!txt(v)`였다. 그래서 **`'0'`이 체크를 켰다** — 문자열 `'0'`이 truthy라서다.
 *    2026-09-16 스테이징 실측에서 송학떡집이 정확히 그 상태였다(`옥외계단: '0'`인데 서식 1.1
 *    `AJ16`은 ■). 「0개소인데 설치됨」은 서식이 표현할 수 없는 상태다.
 *
 *  ⚠ 숫자로 못 읽는 값도 켜지 않는다 — **모르면 안 켠다**. 이 서식의 상자는 「있다」는 주장이고,
 *    주장의 근거가 개소·대수이기 때문이다(소방계획서_15 §9-2에서 같은 판단을 했다).
 *    음수도 켜지 않는다(입력 사고를 인쇄로 옮기지 않는다). */
export function checkFromCount(v: unknown): boolean {
  const n = countOf(v)
  return n != null && n > 0
}

/* ── 계단 4종 ───────────────────────────────────────────────────────────────── */

/** 서식 1.1 15~16행의 네 상자. 순서는 **서식이 인쇄하는 순서**다(L15·AJ15·L16·AJ16). */
export const STAIR_KINDS = ['special', 'direct', 'escape', 'outdoor'] as const
export type StairKind = (typeof STAIR_KINDS)[number]

/** 화면·문서에 쓰는 이름. 1.5 탭 JSON의 열쇠말과 **같은 자구**여야 한다 — 이 표가 곧 이관 사전이다 */
export const STAIR_LABEL: Record<StairKind, string> = {
  special: '특별피난계단',
  direct: '직통계단',
  escape: '피난계단',
  outdoor: '옥외계단',
}

/** `buildings`의 컬럼 이름 — 조립기·저장 액션이 이 표를 보고 읽고 쓴다(이름을 두 번 적지 않는다) */
export const STAIR_COLUMN: Record<StairKind, string> = {
  special: 'stair_special_count',
  direct: 'stair_direct_count',
  escape: 'stair_escape_count',
  outdoor: 'stair_outdoor_count',
}

export type StairCounts = Partial<Record<StairKind, unknown>>

/** 네 상자의 켜짐 — 값이 없는 종류는 `false`(빈 상자가 정답이다) */
export function stairChecks(c: StairCounts): Record<StairKind, boolean> {
  return {
    special: checkFromCount(c.special),
    direct: checkFromCount(c.direct),
    escape: checkFromCount(c.escape),
    outdoor: checkFromCount(c.outdoor),
  }
}

/** 별지 9호 2쪽 「직통(또는 피난계단)」 한 행에 찍을 합계 — **직통 + 피난**.
 *
 *  ⚠ 특별피난계단·옥외계단은 **더하지 않는다**. 별지 9호는 특별피난계단을 **다른 칸**에 따로
 *    인쇄하고(report9.ts:487), 옥외계단은 아예 칸이 없다. 합치면 한 계단이 두 번 세어진다.
 *
 *  ⚠ 0은 `null`로 돌려준다 — 별지 9호 렌더가 `ck(!!d.stairsCount)`로 상자를 켜므로
 *    `'0'`을 넘기면 「0개소인데 ☑」가 다시 태어난다(위 `checkFromCount` 주석과 같은 결함). */
export function stairsSumForAnnex9(c: StairCounts): number | null {
  const d = countOf(c.direct), e = countOf(c.escape)
  if (d == null && e == null) return null
  const sum = Math.max(0, d ?? 0) + Math.max(0, e ?? 0)
  return sum > 0 ? sum : null
}

/** 1.5 탭 JSON(`evacFire.stairs`, 종류이름→개소) → 종류별 개소.
 *
 *  마이그 165 백필과 **같은 사전**을 쓴다. 이관이 끝난 뒤에도 남겨 둔다 —
 *  아직 이관되지 않은 고객(다동이라 백필 가드에 걸린 고객)을 읽을 때 폴백으로 쓰인다. */
export function stairCountsFromLegacyMap(m: Record<string, unknown> | null | undefined): StairCounts {
  const src = m ?? {}
  const out: StairCounts = {}
  for (const k of STAIR_KINDS) out[k] = src[STAIR_LABEL[k]]
  return out
}

/* ── 승강기 3종 ─────────────────────────────────────────────────────────────── */

/** 서식 1.1 12행의 세 상자. 순서는 서식대로(L12 승용 · AB12 비상용 · AS12 피난용) */
export const ELEVATOR_KINDS = ['passenger', 'emergency', 'evac'] as const
export type ElevatorKind = (typeof ELEVATOR_KINDS)[number]

export const ELEVATOR_LABEL: Record<ElevatorKind, string> = {
  passenger: '승용',
  emergency: '비상용',
  evac: '피난용',
}

export const ELEVATOR_COLUMN: Record<ElevatorKind, string> = {
  passenger: 'elevator_count',
  emergency: 'emergency_elevator_count',
  evac: 'evac_elevator_count',
}

export type ElevatorCounts = Partial<Record<ElevatorKind, unknown>>

/** 세 상자의 켜짐 — 계단과 **같은 술어**를 쓴다(대수가 있으면 있다).
 *
 *  이 축은 종전에도 「대수 존재 = 체크」였다(report9.ts:219). 규칙을 바꾸는 게 아니라
 *  **흩어진 것을 한 곳에 모으는 것**이다 — 계단이 그 모델을 따라오게 하는 것이 이번 작업이다. */
export function elevatorChecks(c: ElevatorCounts): Record<ElevatorKind, boolean> {
  return {
    passenger: checkFromCount(c.passenger),
    emergency: checkFromCount(c.emergency),
    evac: checkFromCount(c.evac),
  }
}
