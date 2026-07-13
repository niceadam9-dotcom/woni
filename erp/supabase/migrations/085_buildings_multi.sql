-- 085: 다수동 보고서용 건축물 정보 확장 (P32-7, §3-5)
-- 다수동일때 시트 블록: 건축물구조(콘크리트/철골/조적/목구조/기타), 지붕구조(슬라브/기와/슬레이트/기타),
--   건축면적, 높이, 세대수.

ALTER TABLE buildings
  ADD COLUMN IF NOT EXISTS structure     TEXT,          -- 건축물구조 (콘크리트구조/철골구조/조적조/목구조/기타)
  ADD COLUMN IF NOT EXISTS roof          TEXT,          -- 지붕구조 (슬라브/기와/슬레이트/기타)
  ADD COLUMN IF NOT EXISTS building_area NUMERIC(12,2), -- 건축면적(㎡)
  ADD COLUMN IF NOT EXISTS height_m      NUMERIC(8,2),  -- 높이(m)
  ADD COLUMN IF NOT EXISTS unit_count    INT;           -- 세대수

COMMENT ON COLUMN buildings.structure IS '건축물구조: 콘크리트구조/철골구조/조적조/목구조/기타 (다수동 보고서 체크박스)';
COMMENT ON COLUMN buildings.roof IS '지붕구조: 슬라브/기와/슬레이트/기타 (다수동 보고서 체크박스)';
