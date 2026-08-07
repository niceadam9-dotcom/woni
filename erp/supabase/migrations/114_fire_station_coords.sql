-- 114: 관할 소방서 좌표 + 건물 좌표 (소방계획서_11.md §9-2·§9-3 — D-4′ NCP Directions 연동)
--
-- 배경: 경로 조회에는 출발지(소방서)·도착지(건물) 좌표가 필요한데 양쪽 다 없었다.
--   - region_fire_stations(065)는 소방서 '이름'만 보유 → 주소·좌표 추가
--   - buildings는 좌표 컬럼이 없어 지오코딩 결과를 매번 버렸다(asset-actions.ts) → 캐시 컬럼 추가
--
-- 소방서 좌표는 이전이 드물어 정적 데이터로 둔다. 주소 시드 + 지오코딩은
--   scripts/seed-fire-station-coords.mjs 가 담당한다(출처 URL을 스크립트에 기록).
-- ⚠ 소방서 지오코딩에 '양평소방서' 같은 POI명을 쓰면 안 된다 — NCP Geocode는 주소 전용이다.

ALTER TABLE region_fire_stations
  ADD COLUMN IF NOT EXISTS station_address TEXT,   -- 소방서(본서) 도로명주소
  ADD COLUMN IF NOT EXISTS station_lat NUMERIC,    -- 위도
  ADD COLUMN IF NOT EXISTS station_lng NUMERIC;    -- 경도

COMMENT ON COLUMN region_fire_stations.station_address IS '소방서 본서 도로명주소 — 경로 조회 출발지(119안전센터 아님, 소방계획서_11 §9-7 ① 결정)';

ALTER TABLE buildings
  ADD COLUMN IF NOT EXISTS lat NUMERIC,
  ADD COLUMN IF NOT EXISTS lng NUMERIC,
  ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ;

COMMENT ON COLUMN buildings.geocoded_at IS '좌표 지오코딩 시각 — 주소 변경 시 무효화 판정용';
