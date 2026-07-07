-- 038_building_ledger_more_fire_safety.sql
-- 건축물대장 소방안전 자료 확장 (2026-07-07 사용자 요청: "더 필요한 건축물데이터 추가")
--
--   emergency_elevator_count  비상용승강기 수  — 소방활동·구조 (emgenUseElvtCnt)
--   roof_structure            지붕 구조        — 화재 확산 취약성 (roofCdNm)
--   etc_purpose               기타 용도 상세   — 용도별 소방시설 기준 판정 보조 (etcPurps)
--   ho_count                  호수             — 수용인원 산정 (hoCnt)
--   attached_building_count   부속건축물 수    — 점검 범위 (atchBldCnt)
--   seismic_design            내진설계 적용    — 안전관리 (rserthqkDsgnApplyYn)

ALTER TABLE buildings
  ADD COLUMN IF NOT EXISTS emergency_elevator_count INTEGER,
  ADD COLUMN IF NOT EXISTS roof_structure TEXT,
  ADD COLUMN IF NOT EXISTS etc_purpose TEXT,
  ADD COLUMN IF NOT EXISTS ho_count INTEGER,
  ADD COLUMN IF NOT EXISTS attached_building_count INTEGER,
  ADD COLUMN IF NOT EXISTS seismic_design TEXT;

COMMENT ON COLUMN buildings.emergency_elevator_count IS '비상용승강기 수 — 건축물대장 emgenUseElvtCnt (소방활동)';
COMMENT ON COLUMN buildings.roof_structure           IS '지붕 구조 — 건축물대장 roofCdNm (화재 확산)';
COMMENT ON COLUMN buildings.etc_purpose              IS '기타 용도 상세 — 건축물대장 etcPurps (소방시설 기준)';
COMMENT ON COLUMN buildings.ho_count                 IS '호수 — 건축물대장 hoCnt (수용인원 산정)';
COMMENT ON COLUMN buildings.attached_building_count  IS '부속건축물 수 — 건축물대장 atchBldCnt (점검 범위)';
COMMENT ON COLUMN buildings.seismic_design           IS '내진설계 적용 여부 — 건축물대장 rserthqkDsgnApplyYn';
