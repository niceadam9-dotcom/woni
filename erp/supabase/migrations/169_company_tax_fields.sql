-- 169: 공급자 업태·종목·세금계산서 이메일 (통합계획 B2 — 홈택스 일괄발급 엑셀 + 발행 결함 셋, 2026-10-02)
--
-- 배경(코드 실측): 세금계산서 공급자 칸은 company_profile에서 읽는데 업태·종목 열이 없다(industry 자유 문구 하나).
--   홈택스 일괄발급 양식은 공급자 업태·종목을 따로 받는다. industry는 회사 소개용 업종 문구로 남기고 섞지 않는다.
-- 행 변화 0 — 열만 더한다(NULL). 기존 문서·화면은 이 열을 읽지 않는다.
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS business_type TEXT;
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS business_item TEXT;
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS tax_email TEXT;

COMMENT ON COLUMN company_profile.business_type IS '세금계산서 공급자 업태(사업자등록증 기재). 예: 서비스';
COMMENT ON COLUMN company_profile.business_item IS '세금계산서 공급자 종목(사업자등록증 기재). 예: 소방시설관리업';
COMMENT ON COLUMN company_profile.tax_email IS '세금계산서 공급자 이메일 — 비면 company_profile.email로 폴백(홈택스 엑셀 내보내기).';
