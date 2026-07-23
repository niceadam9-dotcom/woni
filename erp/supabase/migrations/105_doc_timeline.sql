-- 105: 문서 타임라인 (2026-07-23, 소방계획서_4.md §9-9 / P7)
-- ④⑥ 제출일 기록(기한 알림 소멸 조건·제출추적 §9-6f) + ③ 관계인 보고 발송 이력(보고 증빙) + 알림 타입

ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS report9_submitted_at  DATE,   -- ④ 소방서 제출일 (별지 9호 — 점검 후 15일)
  ADD COLUMN IF NOT EXISTS report11_submitted_at DATE;   -- ⑥ 이행완료 보고 제출일 (별지 11호)

-- ③ 관계인 보고서 발송 이력 — 법적 보고 증빙 (서버 액션 전용, RLS 정책 없음)
CREATE TABLE IF NOT EXISTS report_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id   UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  doc_kind        TEXT NOT NULL DEFAULT 'report9_owner',  -- 관계인 보고(별지 9호 송달)
  recipient_email TEXT NOT NULL,
  subject         TEXT NOT NULL,
  file_name       TEXT,
  message_id      TEXT,                                    -- Gmail 발송 message id
  sent_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_report_deliveries_insp ON report_deliveries(inspection_id);
ALTER TABLE report_deliveries ENABLE ROW LEVEL SECURITY;

-- ④ 별지 9호 15일 보고 기한 알림 (§9-8e 연계 — defect-action-notify 크론 확장)
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'approval_request', 'approved', 'rejected', 'recalled',
    'leave_request', 'leave_approved', 'leave_rejected',
    'inspection_assigned', 'inspection_step_due', 'inspection_step_overdue', 'inspection_completed',
    'insurance_expiry_due', 'insurance_expiry_overdue',
    'defect_action_due', 'defect_action_overdue',
    'report_submit_due', 'report_submit_overdue'
  ));
