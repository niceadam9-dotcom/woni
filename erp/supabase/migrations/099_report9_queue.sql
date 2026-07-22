-- 099: 별지 9호 자동 생성 기반 (2026-07-23, 소방계획서_4.md P3 — §9-3·§9-6·§9-7)
-- ① fire_plan_gen_jobs에 서식 종류(report_type)·점검 건(inspection_id) 확장 — 같은 워커 큐로 처리
-- ② inspection_defects에 이행계획(별지 10호) 필드 선반영 — 084의 완료 필드(action_taken·action_completed_at·after_photo_url)와 생애주기 완성

ALTER TABLE fire_plan_gen_jobs
  ADD COLUMN IF NOT EXISTS report_type   TEXT NOT NULL DEFAULT 'fire_plan'
    CHECK (report_type IN ('fire_plan', 'report9')),
  ADD COLUMN IF NOT EXISTS inspection_id UUID REFERENCES inspections(id) ON DELETE CASCADE;

COMMENT ON COLUMN fire_plan_gen_jobs.report_type IS '서식 종류 — fire_plan(소방계획서)/report9(별지 9호 실시결과 보고서)';
COMMENT ON COLUMN fire_plan_gen_jobs.inspection_id IS 'report9일 때 대상 점검 건';

ALTER TABLE inspection_defects
  ADD COLUMN IF NOT EXISTS action_plan  TEXT,  -- 이행조치 계획 내용 (별지 10호 계획 행)
  ADD COLUMN IF NOT EXISTS action_start DATE,  -- 이행조치 기간 시작
  ADD COLUMN IF NOT EXISTS action_end   DATE;  -- 이행조치 기간 종료 (기한 알림 소스)

COMMENT ON COLUMN inspection_defects.action_plan IS '이행조치 계획 (별지 10호) — 완료는 기존 action_taken/action_completed_at/after_photo_url(084)';
