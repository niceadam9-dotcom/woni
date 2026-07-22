-- 098: 소방계획서 P2 — 대장 자동 채움 확대 + 전자우편 송달 동의 (2026-07-23, 소방계획서_4.md §11-1·§9-6①)
-- buildings: 별지 9호 2쪽 건축물 정보 中 대장에서 가져올 수 있는 잔여 항목
-- customers: 별지 9호 1쪽 전자우편 송달 동의

ALTER TABLE buildings
  ADD COLUMN IF NOT EXISTS permit_date     DATE,     -- 건축허가일 (대장 pmsDay)
  ADD COLUMN IF NOT EXISTS building_count  INTEGER,  -- 건물 동수 (대장 표제부 행 수)
  ADD COLUMN IF NOT EXISTS parking_summary TEXT;     -- 주차장 현황 요약 (대장 옥내/옥외 기계식·자주식 대수 합성, 수정 가능)

COMMENT ON COLUMN buildings.permit_date IS '건축허가일 — 건축물대장 pmsDay (별지 9호 2쪽)';
COMMENT ON COLUMN buildings.building_count IS '건물 동수 — 건축물대장 표제부 행 수 (별지 9호 2쪽)';
COMMENT ON COLUMN buildings.parking_summary IS '주차장 현황 — 대장 옥내/옥외 기계식·자주식 대수 요약 텍스트';

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email_delivery_consent BOOLEAN,  -- 별지 9호 1쪽 전자우편 송달 동의 (NULL=미확인)
  ADD COLUMN IF NOT EXISTS report_email           TEXT;     -- 송달 이메일

COMMENT ON COLUMN customers.email_delivery_consent IS '자체점검 결과 보고서 전자우편 송달 동의 (별지 9호 1쪽) — NULL=미확인/true=동의/false=미동의';
COMMENT ON COLUMN customers.report_email IS '보고서 송달 이메일 (email_delivery_consent=true일 때)';
