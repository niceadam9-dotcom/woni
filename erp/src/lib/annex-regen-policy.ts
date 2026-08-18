/** 과거 점검 건 재생성 차단 정책 (소방계획서_22 S15 — Q-12, 2026-08-14 사용자 확정)
 *
 *  왜: 점검표 입력 규약이 "미선택 = 해당없음(／)"에서 "미선택 = 공란(미점검)"으로 바뀐다
 *  (소방계획서_22 Q-9 / 23 Q-19). 구 규약 하에 입력된 건의 무응답은 **의도된 해당없음**인데,
 *  새 렌더로 재생성하면 같은 DB 상태가 "미점검 공란"으로 인쇄돼 멀쩡히 끝난 점검이
 *  부실 점검처럼 보인다. 값을 지어내 재현하는 것(무응답→／)은 법정 문서 허위기록이라 배제하고,
 *  전환일 이전 건은 재생성을 차단한다 — 보관함 원본(소방계획서_18 정책)이 원천이다.
 *
 *  활성화: 규약 전환(23 Q-19 구현)이 운영 배포되는 날 그 날짜를 CUTOFF에 기입한다.
 *  null인 동안은 가드가 조용히 통과한다 — 코드가 먼저 배포돼도 아무 건도 막지 않는다. */

/** 규약 전환일 (YYYY-MM-DD) — 23 Q-19 운영 배포일에 확정 기입. null = 가드 비활성
 *
 *  ⚠ 2026-08-18에 '2026-08-18'로 기입했다가 되돌렸다. **DB 마이그레이션일 ≠ 규약 전환일**이다.
 *  전환일은 새 규약 코드가 화면에 도는 날(앱 배포일)인데, 그날은 DB만 적용했고 서버는 정지
 *  상태였다. 그 결과 기존 점검이 **전건 차단**됐다(스테이징 26/26·운영 8/8 — 재생성이 통째로 막힘).
 *  다시 기입할 때는 반드시 앱이 새 규약으로 도는 날짜를 쓰고, 기입 직후
 *  `scripts/_probe-regen-block-scope.mjs`로 차단 건수를 실측할 것. */
export const REGEN_POLICY_CUTOFF: string | null = null

/** 이 점검 건의 별지 재생성이 차단 대상인가 — 종료일(폴백: 시작일)이 전환일 이전이면 차단 */
export function isRegenBlocked(insp: {
  inspection_end_date?: string | null
  inspection_start_date?: string | null
}): boolean {
  if (!REGEN_POLICY_CUTOFF) return false
  const anchor = insp.inspection_end_date ?? insp.inspection_start_date
  if (!anchor) return false   // 일자 없는 건은 막지 않는다 — 과잉 차단 방지
  return anchor < REGEN_POLICY_CUTOFF
}

/** 차단 사유 문구 — 서버 액션·UI 공용 */
export const REGEN_BLOCKED_MESSAGE =
  '구 규약(미선택=해당없음)으로 작성된 점검이라 재생성하면 결과 표기가 달라집니다 — 보관함 원본을 사용하세요. 재발급이 꼭 필요하면 관리자에게 문의해주세요.'
