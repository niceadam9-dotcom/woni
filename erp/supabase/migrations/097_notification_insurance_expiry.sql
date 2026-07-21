-- 097: 화재보험 만기 알림 유형 추가 (2026-07-22, 소방계획서-필드확장-설계 §8-4 파생 기능)
-- notifications.type CHECK에 insurance_expiry_due/overdue 추가,
-- reference_type CHECK에 'customer' 추가 (만기 알림은 고객을 참조).

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'approval_request', 'approved', 'rejected', 'recalled',
    'leave_request', 'leave_approved', 'leave_rejected',
    'inspection_assigned', 'inspection_step_due', 'inspection_step_overdue', 'inspection_completed',
    'insurance_expiry_due', 'insurance_expiry_overdue'
  ));

ALTER TABLE notifications DROP CONSTRAINT notifications_reference_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_reference_type_check
  CHECK (reference_type IN ('document', 'leave', 'inspection', 'customer'));
