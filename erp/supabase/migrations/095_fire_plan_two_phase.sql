-- 095: 소방계획서 2단계 등록 + HTML 미리보기 (2026-07-21)
-- HWP 생성 워커가 HWP·HTML을 즉시 등록하고 PDF는 뒤따라 변환(로컬 LibreOffice, 실패 시 VPS Gotenberg 크론 폴백).
-- pdf_status: ready(변환 완료·기존 업로드분) / converting(변환 대기·진행) / failed(변환 실패 — HWP는 사용 가능)
-- html_path: 한글 SDK HTML 내보내기(이미지 base64 인라인) — 웹/모바일 미리보기용(레이아웃 참고)
-- odt_path : PDF 변환 소스 — 변환 완료 시 삭제, converting 상태에서만 존재

ALTER TABLE fire_plans ALTER COLUMN pdf_name DROP NOT NULL;
ALTER TABLE fire_plans ALTER COLUMN pdf_path DROP NOT NULL;

ALTER TABLE fire_plans ADD COLUMN IF NOT EXISTS pdf_status TEXT NOT NULL DEFAULT 'ready'
  CHECK (pdf_status IN ('ready', 'converting', 'failed'));
ALTER TABLE fire_plans ADD COLUMN IF NOT EXISTS pdf_error TEXT;
ALTER TABLE fire_plans ADD COLUMN IF NOT EXISTS html_path TEXT;
ALTER TABLE fire_plans ADD COLUMN IF NOT EXISTS odt_path TEXT;

-- PDF 변환 크론(/api/cron/convert-fireplan-pdf)의 대상 조회용
CREATE INDEX IF NOT EXISTS idx_fire_plans_converting ON fire_plans(created_at)
  WHERE pdf_status = 'converting';

COMMENT ON COLUMN fire_plans.pdf_status IS 'PDF 상태 — ready/converting/failed. HWP·HTML은 pdf_status와 무관하게 즉시 사용 가능';
COMMENT ON COLUMN fire_plans.html_path IS '웹 미리보기 HTML (한글 SDK 내보내기, 이미지 인라인) — 레이아웃 참고용';
COMMENT ON COLUMN fire_plans.odt_path IS 'PDF 변환 소스 ODT — 변환 완료 시 삭제';
