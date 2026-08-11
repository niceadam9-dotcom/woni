-- 123: 소방시설관리업 등록번호 (소방계획서_15 A4-2, 2026-08-11 사용자 확정 — 회사 정보 컬럼 신설안)
-- 별지 4호 2쪽 '소방시설관리업체(등록번호)' 칸이 '(제    -    호)' 고정 공란이던 결함 해소.
-- 사업자등록번호(business_number)와 다른 별개 번호라 전용 컬럼으로 둔다. 값 예: "2026-15" → 인쇄 "(제 2026-15 호)"
ALTER TABLE company_profile
  ADD COLUMN IF NOT EXISTS management_reg_no TEXT;
