-- 103: 불량 이행기한 알림 유형 추가 (2026-07-23, 소방계획서_4.md §9-7d — 과태료 방어)
-- notifications.type CHECK에 defect_action_due/overdue 추가 (reference_type은 'inspection' 재사용).

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'approval_request', 'approved', 'rejected', 'recalled',
    'leave_request', 'leave_approved', 'leave_rejected',
    'inspection_assigned', 'inspection_step_due', 'inspection_step_overdue', 'inspection_completed',
    'insurance_expiry_due', 'insurance_expiry_overdue',
    'defect_action_due', 'defect_action_overdue'
  ));
