/** 「지금 문서 작업의 대상인 회차」 판정 — **단일 원천**.
 *
 *  종전에는 이 규칙이 `plan-annex-section.tsx`(회차 탭, 클라이언트 컴포넌트) 안에만 있었다.
 *  2026-09-21 [보고서] 탭에도 같은 회차 머리줄·[별지 엑셀]이 필요해지면서 꺼냈다 — 복제하면
 *  두 탭이 **서로 다른 회차의 문서를 내주는** 날이 온다(그 버그는 화면만 봐서는 안 보인다).
 *
 *  ⭐ `today`를 인자로 받는다. 종전 판본은 함수 안에서 시계를 읽어 **테스트가 시계를 못 쥐었다** —
 *    "예정일이 지난 회차를 고르는가"는 오늘이 언제냐에 달린 규칙인데, 그걸 고정하지 못하면
 *    검사가 날짜에 따라 초록·빨강을 오간다. 기본값은 종전과 같은 KST 오늘.
 */
import type { CustomerRound } from '@/app/(dashboard)/reports/docs-actions'

/** KST 오늘(YYYY-MM-DD) — 서버·브라우저 어디서 불려도 같은 날을 보게 UTC+9로 민다 */
export function todayKst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
}

/** 정렬 키 — 예정일이 없는 회차는 차수로 대략의 시기를 만든다(1차≈06월·2차≈12월) */
function dateKey(r: CustomerRound): string {
  return r.plannedDate ?? `${r.year}-${String(r.sequenceNum * 6).padStart(2, '0')}`
}

/** 현재 회차 자동 판정 (2026-09-02 사용자 확정 — "회차는 ERP가 알아서").
 *
 *  사용자는 회차를 고르지도 관리하지도 않는다 — **지금 문서 작업의 대상인 회차 1건**만 정한다.
 *   ① 진행 중 — 입력 중인 점검이 곧 현재.
 *   ② 시기가 도래한 미시작(예정일 ≤ 오늘) — [작성 시작]으로 열린다.
 *   ③ **최근 완료** — 다음 회차 시기 전까지는 방금 끝낸 회차의 산출물이 현재 문서다.
 *      🚨 이게 빠지면 점검 완료 직후 엑셀 버튼이 사라진다(서림사 실사고). 서버가 이 1건의
 *         `docs`를 함께 실어 보내므로 `docs` 유무로 그 1건을 특정한다.
 *   ④ 미래 미시작 중 최근접 — 아직 아무 이력이 없는 신규 고객의 진입점.
 */
export function currentRoundOf(rounds: CustomerRound[], today: string = todayKst()): CustomerRound | null {
  const active = rounds.filter(r => r.state !== 'completed')
  const started = active.filter(r => r.state !== 'planned')
    .sort((a, b) => dateKey(a).localeCompare(dateKey(b)))
  if (started.length > 0) return started[0]
  const planned = active.filter(r => r.state === 'planned')
    .sort((a, b) => dateKey(a).localeCompare(dateKey(b)))
  if (planned[0] && dateKey(planned[0]) <= today) return planned[0]
  // rounds는 (연,차) 내림차순 — 완료 중 첫 건이 최신
  const latestDone = rounds.find(r => r.state === 'completed' && r.docs)
  return latestDone ?? planned[0] ?? null
}

/** 회차 한 줄 이름 — 「2026년 1차 (종합)」. 두 탭이 같은 글로 부르게 한다.
 *  planType은 `special_종합`·`special_작동`·null(레거시)이라 접두를 벗겨 쓴다. */
export function roundLabel(r: CustomerRound): string {
  const kind = r.planType?.replace(/^special_/, '') ?? ''
  return `${r.year}년 ${r.sequenceNum}차${kind ? ` (${kind})` : ''}`
}

/** 이 회차의 문서를 **지금 받을 수 있는가** — 받으려면 점검 건(inspection)이 있어야 한다.
 *  미시작(계획만 있는) 회차는 `docs`가 null이라 받을 산출물 자체가 없다. */
export function downloadableInspectionId(r: CustomerRound | null): string | null {
  return r?.docs?.inspectionId ?? null
}
