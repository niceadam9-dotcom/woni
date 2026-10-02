/** 법정 외부 연계 1단계(167) — 제출 수단·협회 적합 판정의 값 집합과 라벨.
 *  서버 액션(`timeline-actions.ts`)과 화면(작업대 ②④·제출현황 보드)이 **같은 상수**를 읽는다.
 *  ⚠ `'use server'` 파일은 async 함수만 export할 수 있어 상수는 여기 둔다.
 *  ⚠ DB 값은 영문 코드(somin·visit…)다 — 라벨만 바꿔도 저장값이 흔들리지 않게. */

export const SUBMISSION_VIAS = ['somin', 'visit', 'mail', 'fax'] as const
export type SubmissionVia = (typeof SUBMISSION_VIAS)[number]
export const SUBMISSION_VIA_LABELS: Record<SubmissionVia, string> = {
  somin: '소방민원센터', visit: '방문', mail: '우편', fax: '팩스',
}

export const PLACEMENT_RESULTS = ['fit', 'unfit'] as const
export type PlacementResult = (typeof PLACEMENT_RESULTS)[number]
export const PLACEMENT_RESULT_LABELS: Record<PlacementResult, string> = { fit: '적합', unfit: '부적합' }

/** 소방민원센터·협회 배치신고 입구 — 화면 링크가 한 곳에서 읽는다 */
export const SOMIN_URL = 'https://safeland.go.kr/somin/'
export const KFMA_PLACEMENT_URL = 'https://fpsm.kfma.kr/'

/** ④ 상태 문구 — 업체 계정에는 제출 버튼이 없어 관계인이 승인함에서 제출한다(소민터 공지 2025-08-29).
 *  소민터로 올렸는데 접수번호가 아직 비면 「관계인 승인 대기」다. */
export function submissionStatusText(via: SubmissionVia | null, receiptNo: string | null): string | null {
  if (via === 'somin' && !receiptNo) return '관계인 승인 대기'
  return null
}

/** 협회 하루 배치 상한 — 하루 5개 초과 대상물 신고는 부적합(관리업종합정보시스템 공지) */
export const KFMA_DAILY_MAX = 5
