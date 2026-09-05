-- 158: notifications.type에 manager_edu_due/overdue 추가 (2026-09-05)
--
-- 소방안전관리자 실무교육 주기 알림 — customers.manager_edu_date(최근 교육이수일, 104) + 2년을
-- 기한으로 보고 D-30·D-7·당일·경과를 api/cron/manager-edu-notify가 매일 발송한다.
-- 화재보험 만기(097 insurance_expiry_*)와 같은 골격: reference_type='customer', 'deadline' 수신 설정.
--
-- 늘리는 순서(143 규약): 이 CHECK → src/lib/notification-types.ts → 발신부.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[
  'approval_request'::text,
  'approved'::text,
  'rejected'::text,
  'recalled'::text,
  'leave_request'::text,
  'leave_approved'::text,
  'leave_rejected'::text,
  'inspection_assigned'::text,
  'inspection_step_due'::text,
  'inspection_step_overdue'::text,
  'inspection_completed'::text,
  'insurance_expiry_due'::text,
  'insurance_expiry_overdue'::text,
  'defect_action_due'::text,
  'defect_action_overdue'::text,
  'report_submit_due'::text,
  'report_submit_overdue'::text,
  'weekly_doc_briefing'::text,
  'law_revision'::text,
  'manager_edu_due'::text,
  'manager_edu_overdue'::text
]));

COMMENT ON COLUMN notifications.type IS
  '알림 종류. 발신부(크론·서버 액션)와 이 CHECK가 어긋나면 insert가 조용히 실패한다 — 늘리는 순서: 이 CHECK → src/lib/notification-types.ts → 발신부 → (점검 참조 기한 알림이면) src/lib/inspection-notify-dismiss.ts 목록';
