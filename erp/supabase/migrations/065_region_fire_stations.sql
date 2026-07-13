-- 065: 지역→관할 소방서 매핑 (doc02 §1-1a, P1A-1)
-- region(읍면/시군) → 소방서명. 고객 등록·이관 시 customers.fire_station 자동 채움.

CREATE TABLE IF NOT EXISTS region_fire_stations (
  region        TEXT PRIMARY KEY,   -- 지역명 (엑셀 대장 지역값과 동일: 양평/용문/하남/홍천 …)
  fire_station  TEXT NOT NULL,      -- 관할 소방서명
  region_si     TEXT,               -- 정규 시/군 (양평군 등)
  note          TEXT
);

ALTER TABLE region_fire_stations ENABLE ROW LEVEL SECURITY;
CREATE POLICY region_fire_stations_select ON region_fire_stations
  FOR SELECT TO authenticated USING (true);

-- 양평군 관내 읍·면 → 양평소방서
INSERT INTO region_fire_stations (region, fire_station, region_si) VALUES
  ('양평','양평소방서','양평군'),
  ('용문','양평소방서','양평군'),
  ('양동','양평소방서','양평군'),
  ('개군','양평소방서','양평군'),
  ('옥천','양평소방서','양평군'),
  ('양서','양평소방서','양평군'),
  ('청운','양평소방서','양평군'),
  ('강하','양평소방서','양평군'),
  ('강상','양평소방서','양평군'),
  ('지평','양평소방서','양평군'),
  ('서종','양평소방서','양평군'),
  ('단월','양평소방서','양평군'),
  -- 관외 시·군
  ('하남','하남소방서','하남시'),
  ('남양주','남양주소방서','남양주시'),
  ('분당','분당소방서','성남시'),
  ('용인','용인소방서','용인시'),
  ('이천','이천소방서','이천시'),
  ('안성','안성소방서','안성시'),
  ('광주','광주소방서','광주시'),
  ('여주','여주소방서','여주시'),
  ('홍천','홍천소방서','홍천군'),
  ('동해','동해소방서','동해시')
ON CONFLICT (region) DO NOTHING;
