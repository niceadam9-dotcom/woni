-- 084: 불량 조치완료 데이터 (P34-4, §3-6) — 이행계획서·완료보고서용
-- 기존 inspection_defects.photo_url = 조치 전(불량) 사진. 아래는 조치 후 내용/완료일/사진.

ALTER TABLE inspection_defects
  ADD COLUMN IF NOT EXISTS action_taken         TEXT,   -- 조치 내용
  ADD COLUMN IF NOT EXISTS action_completed_at  DATE,   -- 조치 완료일
  ADD COLUMN IF NOT EXISTS after_photo_url      TEXT;   -- 조치 후 사진

COMMENT ON COLUMN inspection_defects.action_taken IS '이행조치 내용 (완료보고서)';
COMMENT ON COLUMN inspection_defects.action_completed_at IS '조치 완료일 (완료보고서)';
COMMENT ON COLUMN inspection_defects.after_photo_url IS '조치 후 사진 URL (조치 전 = photo_url)';
