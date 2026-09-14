/** 별지서식 회차 카드의 **상태 배지** — 순수·무의존.
 *
 *  ## 왜 이 파일이 생겼나 (2026-09-14 사용자 신고)
 *
 *  종전 규칙은 한 줄이었다: 예정일이 오늘보다 과거면 **무조건** 붉은 「예정 지연 N일 ⚠」.
 *  그 한 줄이 낳은 것:
 *
 *   · 자체점검 계획 777건 중 **292건(37.5%)**이 붉은 배지를 달고 있었다(중앙 151일·최대 255일).
 *     37.5%에 뜨는 경고는 경고가 아니라 배경 소음이다.
 *   · 「151일 지연」은 **법 위반 151일**로 읽힌다. 그런데 그 대부분은 시스템 도입 전에 이미
 *     지나간 달의 슬롯이라 **아무도 늦은 적이 없다**.
 *
 *  ⭐ 법정 시기는 **달** 단위다(시행규칙 [별표 3] — 종합점검은 사용승인일이 속하는 **달**,
 *     작동점검은 그 6개월이 되는 **달**). 일 단위 카운트는 **법에 없는 정밀도**이고,
 *     같은 달 안이면 애초에 늦은 것이 아니다.
 *
 *  그래서 과거를 두 갈래로 가른다:
 *   · 같은 달 → 「이달 예정」 (아직 법정 달 안이다 — 늦지 않았다)
 *   · 달을 넘김 → 「N개월 경과 · 미실시」 (사실만 말한다. 「지연」은 *누군가 늦었다*는 뜻인데
 *                 도입 전 달의 슬롯은 그렇지 않다)
 *
 *  ⚠ 붉은색은 **시작된 점검이 법정 기한을 넘긴 것**(`state==='overdue'`)에만 남긴다.
 *    미시작 예정을 붉게 칠하면 위 292건이 그대로 되돌아온다.
 *
 *  ⚠ 미래는 종전 그대로 `D-N`이다 — 일 단위여도 **재촉이지 비난이 아니라** 오해가 없고,
 *    "며칠 남았나"는 실무에서 실제로 쓰는 값이다. 이 차수가 고치는 것은 **과거 쪽**이다.
 */

/** 배지 종류 — 색은 화면이 고른다(여기는 판정만 한다) */
export type RoundPillKind =
  | 'planned'     // 예정 (날짜 없음)
  | 'due'         // 예정 D-N (미래)
  | 'thisMonth'   // 이달 예정 — 법정 달 안이라 늦은 것이 아니다
  | 'elapsed'     // N개월 경과 · 미실시 — 사실 진술(경고 아님)
  | 'inProgress'  // 진행중
  | 'completed'   // 완료
  | 'overdue'     // 기한초과 — 시작된 점검이 법정 기한을 넘김 (유일한 붉은 축)

export type RoundPill = { kind: RoundPillKind; label: string }

export type RoundPillInput = {
  state: string
  /** 'YYYY-MM-DD' — 계획 예정일(미시작) 또는 점검 시작일(시작됨) */
  plannedDate?: string | null
}

/** 'YYYY-MM' 두 개의 **달 차이** — 일자는 보지 않는다(법정 단위가 달이라서) */
function monthsBetween(fromISO: string, toISO: string): number {
  const y1 = Number(fromISO.slice(0, 4)), m1 = Number(fromISO.slice(5, 7))
  const y2 = Number(toISO.slice(0, 4)),   m2 = Number(toISO.slice(5, 7))
  return (y2 - y1) * 12 + (m2 - m1)
}

/** 회차 배지 판정. `today`는 주입한다(이 모듈은 시계를 읽지 않는다 — 검사가 쉬워진다). */
export function roundPill(r: RoundPillInput, today: string): RoundPill {
  if (r.state === 'completed')   return { kind: 'completed',  label: '완료' }
  if (r.state === 'overdue')     return { kind: 'overdue',    label: '기한초과' }
  if (r.state !== 'planned')     return { kind: 'inProgress', label: '진행중' }

  if (!r.plannedDate) return { kind: 'planned', label: '예정' }

  const gap = monthsBetween(r.plannedDate, today)
  // 같은 달 = 법정 달 안 = 늦지 않았다. 날짜가 지났든 안 지났든 같은 말을 한다.
  if (gap === 0) return { kind: 'thisMonth', label: '이달 예정' }
  if (gap > 0)   return { kind: 'elapsed',   label: `${gap}개월 경과 · 미실시` }

  // 미래 — 종전대로 일 단위 D-N (재촉이지 비난이 아니다)
  const days = Math.round((Date.parse(`${r.plannedDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)
  return { kind: 'due', label: `예정 D-${days}` }
}
