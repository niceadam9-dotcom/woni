-- 052: 회사 정보 저장 복구 (TS-PROP-15에서 발견)
-- company/actions.ts·page.tsx·tax-invoices가 존재하지 않는 company_info 테이블을 참조해
-- 회사 정보 로드·저장이 동작하지 않던 문제 — 코드를 company_profile로 통일하고
-- 폼이 쓰는 누락 컬럼 3개를 보강한다.
ALTER TABLE company_profile
  ADD COLUMN IF NOT EXISTS fax TEXT,
  ADD COLUMN IF NOT EXISTS industry TEXT,
  ADD COLUMN IF NOT EXISTS established_date DATE;
