/** 모바일 AI 불량 분류 결과 검증 — `/api/mobile/classify-defects`의 모델 출력 정규화(2026-10-06).
 *
 *  모델에 심각도를 「경미/보통/중대」로 지시만 하고 그대로 넘겼더니, 다른 말(「높음」 등)이 오면 앱이 제안을 적용한
 *  직후 심각도 버튼이 하나도 안 켜져 값이 지워진 것처럼 보였고 그 값이 그대로 저장 요청에 실렸다.
 *  규칙: 배열이 아니면 빈 목록 · 이름(문자열·공백 제외) 없는 항목은 버림 · 상세는 문자열이면 trim(빈 값은 null) ·
 *  심각도가 세 값이 아니면 「보통」. 순수 함수 — 테스트가 모델 없이 단언한다. */
export const DEFECT_SEVERITIES = ['경미', '보통', '중대'] as const
export type DefectSeverity = typeof DEFECT_SEVERITIES[number]
export type ClassifiedDefect = { defect_name: string; defect_detail: string | null; severity: DefectSeverity }

export function normalizeClassifiedDefects(parsed: unknown): ClassifiedDefect[] {
  if (!Array.isArray(parsed)) return []
  return parsed
    .map((d: { defect_name?: unknown; defect_detail?: unknown; severity?: unknown } | null) => ({
      defect_name: typeof d?.defect_name === 'string' ? d.defect_name.trim() : '',
      defect_detail: typeof d?.defect_detail === 'string' && d.defect_detail.trim() ? d.defect_detail.trim() : null,
      severity: (DEFECT_SEVERITIES as readonly unknown[]).includes(d?.severity) ? d!.severity as DefectSeverity : '보통',
    }))
    .filter(d => d.defect_name)
}
