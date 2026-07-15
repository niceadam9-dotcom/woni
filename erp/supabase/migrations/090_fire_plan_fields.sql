-- 090: 소방계획서 연계 전용 필드 (2026-07-15, 개정: 구조·지붕은 기존 037/038 컬럼 재사용)
ALTER TABLE buildings
  ADD COLUMN IF NOT EXISTS receiver_location TEXT;  -- 수신기 위치 (예: 1층 관리실)

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS manager_selected_at DATE; -- 소방안전관리자 선임일자

COMMENT ON COLUMN buildings.receiver_location IS '소방계획서 서식1.1 수신기위치';
COMMENT ON COLUMN customers.manager_selected_at IS '소방안전관리자 선임일 (서식1.7)';
