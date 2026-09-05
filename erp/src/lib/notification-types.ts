/** 알림 종류·참조 종류 — **DB CHECK 제약의 사본**. 순수 모듈이다.
 *
 *  `server-only`도 `'use server'`도 붙이지 않는다: 서버(발신)·클라이언트(벨 표시)·
 *  테스트(무서버 대조)가 모두 읽어야 한다.
 *
 *  왜 이 파일이 생겼나 — 2026-08-19, 법제처 서식 개정 크론이 `type: 'law_revision'`으로
 *  알림을 넣는데 그 값이 `notifications_type_check`에 없어 **insert가 항상 실패**했다.
 *  라우트는 오류를 확인하지 않고 기준일만 올려서, 개정 신호가 통째로 사라졌다.
 *  근본 원인은 발신부의 `type`이 그냥 `string`이라 **컴파일러가 아무것도 막지 못한 것**이다.
 *
 *  이제 두 겹으로 막는다:
 *    ① 코드 → 이 유니온        : tsc가 오타·미등록 값을 잡는다
 *    ② 이 유니온 → DB CHECK    : scripts/_probe-notification-types.mts가 양방향 대조한다
 *  늘릴 때 순서는 **마이그레이션(CHECK) → 이 파일 → 발신부**다. 반대로 하면 ①이 통과하고
 *  런타임에서 조용히 실패한다.
 */

export const NOTIFICATION_TYPES = [
  'approval_request',
  'approved',
  'rejected',
  'recalled',
  'leave_request',
  'leave_approved',
  'leave_rejected',
  'inspection_assigned',
  'inspection_step_due',
  'inspection_step_overdue',
  'inspection_completed',
  'insurance_expiry_due',
  'insurance_expiry_overdue',
  'defect_action_due',
  'defect_action_overdue',
  'report_submit_due',
  'report_submit_overdue',
  'weekly_doc_briefing',
  'law_revision',        // 143 — 법제처 서식 개정 감지
  'manager_edu_due',     // 158 — 소방안전관리자 실무교육 주기(교육이수일+2년) 임박
  'manager_edu_overdue', // 158 — 〃 경과
] as const

export type NotificationType = typeof NOTIFICATION_TYPES[number]

export const NOTIFICATION_REFERENCE_TYPES = ['document', 'leave', 'inspection', 'customer'] as const

export type NotificationReferenceType = typeof NOTIFICATION_REFERENCE_TYPES[number]
