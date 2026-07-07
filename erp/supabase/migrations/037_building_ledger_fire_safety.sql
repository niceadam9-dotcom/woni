-- 037_building_ledger_fire_safety.sql
-- 국토부 건축물대장 API 연동 — 소방안전 관련 건축물 자료 한정 (2026-07-07 사용자 결정)
--
-- 추가 필드 (소방시설 설치 대상 판정·화재 예방 관련):
--   height          건물 높이(m)      — 고층건축물 판정 (31m/120m 기준)
--   main_structure  주구조            — 내화구조 여부 (철근콘크리트 등)
--   elevator_count  승용승강기 수     — 피난 계획
--   households      세대/가구 수      — 특정소방대상물 분류·수용인원
--   ledger_synced_at 건축물대장 동기화 시각

ALTER TABLE buildings
  ADD COLUMN IF NOT EXISTS height NUMERIC,
  ADD COLUMN IF NOT EXISTS main_structure TEXT,
  ADD COLUMN IF NOT EXISTS elevator_count INTEGER,
  ADD COLUMN IF NOT EXISTS households INTEGER,
  ADD COLUMN IF NOT EXISTS ledger_synced_at TIMESTAMPTZ;

COMMENT ON COLUMN buildings.height          IS '건물 높이(m) — 건축물대장 heit';
COMMENT ON COLUMN buildings.main_structure  IS '주구조 — 건축물대장 strctCdNm (내화구조 판단)';
COMMENT ON COLUMN buildings.elevator_count  IS '승용승강기 수 — 건축물대장 rideUseElvtCnt';
COMMENT ON COLUMN buildings.households      IS '세대/가구 수 — 건축물대장 hhldCnt';
COMMENT ON COLUMN buildings.ledger_synced_at IS '건축물대장 API 동기화 시각';
