-- 109: 주간 문서 브리핑 알림 유형 추가 (2026-07-26, 소방계획서_5 §8 P-2)
-- (구 107 → 109로 재번호: 107_mail_send_logs·108_law_baseline_seed_date와 번호 충돌 해소)
-- notifications.type CHECK에 weekly_doc_briefing 추가 (reference_type은 사용 안 함 = NULL).
-- 적용 전에도 크론은 동작(알림 best-effort, 이메일·요약은 무관) — 적용 후 in-app 알림 활성화.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'approval_request', 'approved', 'rejected', 'recalled',
    'leave_request', 'leave_approved', 'leave_rejected',
    'inspection_assigned', 'inspection_step_due', 'inspection_step_overdue', 'inspection_completed',
    'insurance_expiry_due', 'insurance_expiry_overdue',
    'defect_action_due', 'defect_action_overdue',
    'report_submit_due', 'report_submit_overdue',
    'weekly_doc_briefing'
  ));
