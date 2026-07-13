-- 067: 소방시설 현황 (doc02 §1-3, P33-1) — 건물(동) 단위
-- 보고서 '현황(현1~5)'·층별 집계의 데이터 소스. 최초 1회 입력 후 매년 재사용.

CREATE TABLE IF NOT EXISTS fire_facilities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id   UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,          -- 소화설비/경보설비/피난구조설비/소화용수설비/소화활동설비
  facility_code TEXT NOT NULL,          -- 소화기구/옥내소화전/자탐/유도등 …
  installed     BOOLEAN NOT NULL DEFAULT false,
  detail        JSONB,                  -- {분말:12, CO2:2} / {수신기:'P형', 회로:8} 등
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (building_id, facility_code)
);
CREATE INDEX IF NOT EXISTS idx_fire_facilities_building ON fire_facilities(building_id);

CREATE TABLE IF NOT EXISTS fire_facility_floors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  floor_label TEXT NOT NULL,            -- 지하1층/1층/…/옥탑/E·V기계실
  sort_order  INT  NOT NULL DEFAULT 0,
  counts      JSONB,                    -- {차동식:4, 연기:2, 소화기:3, 유도등:2}
  UNIQUE (building_id, floor_label)
);
CREATE INDEX IF NOT EXISTS idx_fire_facility_floors_building ON fire_facility_floors(building_id, sort_order);

-- 연 단위 유효성 확인 (매년 점검 시 "현황 그대로?" 확인일)
ALTER TABLE buildings
  ADD COLUMN IF NOT EXISTS facilities_verified_at DATE,
  ADD COLUMN IF NOT EXISTS facilities_verified_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE fire_facilities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_facility_floors  ENABLE ROW LEVEL SECURITY;
CREATE POLICY fire_facilities_select ON fire_facilities FOR SELECT TO authenticated USING (true);
CREATE POLICY fire_facilities_write  ON fire_facilities FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('employee','manager','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('employee','manager','admin')));
CREATE POLICY fire_facility_floors_select ON fire_facility_floors FOR SELECT TO authenticated USING (true);
CREATE POLICY fire_facility_floors_write  ON fire_facility_floors FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('employee','manager','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('employee','manager','admin')));
