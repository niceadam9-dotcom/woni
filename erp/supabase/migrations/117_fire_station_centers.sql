-- 117: 119안전센터·지역대 확충 (1.3 관할 소방서 드롭다운 — 소방계획서_11 후속)
--
-- 배경: region_fire_stations는 §9-7 결정대로 소방서(본서)만 담는다. 그러나 양평처럼
--   면 단위 관할이 넓은 지역은 실무 표기·실출동 모두 119안전센터(용문119안전센터 등)가
--   더 현실적이라, 드롭다운에 "본서 (센터)" 형태의 후보를 추가한다.
-- 원칙: 전국 안전센터(1,300+)를 다 심지 않는다 — 고객이 있는 시/군만 시드한다
--   (seed-fire-station-centers.mjs, 확신 없는 값은 심지 않는 065·116 원칙 유지).
-- region_si 규약은 region_fire_stations와 동일: 시/군, 특별시·광역시는 시/도명.

CREATE TABLE IF NOT EXISTS fire_station_centers (
  region_sido  TEXT NOT NULL,
  region_si    TEXT NOT NULL,               -- 시/군 (특별시·광역시는 시/도명 — 116 규약)
  center       TEXT NOT NULL,               -- 예: 용문119안전센터
  station      TEXT NOT NULL,               -- 소속 본서: 양평소방서
  center_type  TEXT NOT NULL DEFAULT 'center',  -- 'center'=119안전센터 | 'area'=119지역대
  emds         TEXT[] NOT NULL DEFAULT '{}',    -- 관할 읍면동(접미사 제거) — 드롭다운 정렬 우선순위용
  PRIMARY KEY (region_sido, region_si, center)
);

ALTER TABLE fire_station_centers ENABLE ROW LEVEL SECURITY;
CREATE POLICY fire_station_centers_select ON fire_station_centers
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_fire_station_centers_si ON fire_station_centers (region_si);

COMMENT ON TABLE fire_station_centers IS
  '119안전센터·지역대 — 1.3 관할 소방서 드롭다운 보조 후보. 본서 매핑은 region_fire_stations가 원본';
COMMENT ON COLUMN fire_station_centers.emds IS
  '관할 읍면동명(읍/면/동 접미사 제거). 고객 주소의 읍면동과 일치하면 드롭다운 상단 배치';
