-- 106: 법제처 서식 개정 감지 (2026-07-23, 소방계획서_4.md §9-5c)
-- 서식별 기준 공포/발령일자 — 크론이 최신값과 비교, 개정 감지 시 알림 + 기준 갱신(알림 1회)

CREATE TABLE IF NOT EXISTS law_form_baselines (
  key           TEXT PRIMARY KEY,          -- report9 / report10 / report11 / exterior
  form_name     TEXT NOT NULL,
  announce_date TEXT NOT NULL,             -- YYYYMMDD (법제처 공포/발령일자)
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE law_form_baselines ENABLE ROW LEVEL SECURITY;

INSERT INTO law_form_baselines (key, form_name, announce_date) VALUES
  ('report9',  '별지 9호 자체점검 실시결과 보고서', '20260701'),
  ('report10', '별지 10호 이행계획서',              '20260701'),
  ('report11', '별지 11호 이행완료 보고서',          '20260701'),
  ('exterior', '별지 6호 외관점검표(고시 2022-71)',  '20221201')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'approval_request', 'approved', 'rejected', 'recalled',
    'leave_request', 'leave_approved', 'leave_rejected',
    'inspection_assigned', 'inspection_step_due', 'inspection_step_overdue', 'inspection_completed',
    'insurance_expiry_due', 'insurance_expiry_overdue',
    'defect_action_due', 'defect_action_overdue',
    'report_submit_due', 'report_submit_overdue',
    'law_revision'
  ));
