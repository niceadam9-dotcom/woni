-- customers 테이블에 점검계획일(계획 기산점 수동 지정) 컬럼 추가
-- 기준일 우선순위: plan_anchor_date(수동) → 최초 점검시작일 → use_approval_date
-- 기존 고객은 NULL 허용(폴백 체인 유지), 신규 등록 화면에서는 필수 입력
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS plan_anchor_date DATE;

COMMENT ON COLUMN customers.plan_anchor_date IS '점검계획일 — 연간 점검계획 기산점 수동 지정 (최우선 기준일)';
