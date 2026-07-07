-- customers 테이블에 사용승인일 컬럼 추가
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS use_approval_date DATE;

COMMENT ON COLUMN customers.use_approval_date IS '사용승인일 — Victory7.md 6단계 마감일 계산의 기준일';
