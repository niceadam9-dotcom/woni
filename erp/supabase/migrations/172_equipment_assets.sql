-- 172: 설비 자산 대장 1단계 — 개체·묶음 행 + 이력 (비교진단 「설비 자산 대장 해결방안」 절, 통합계획 C3, 2026-10-02)
--
-- 1.4 수량 격자(customer_facility_specs·fire_facilities·fire_facility_floors)는 그대로 둔다 — 대장은 수량의 두 번째 진실이
-- 아니라 「제조연월이 판정을 바꾸는 품목」의 개체 기록이다. fire_facilities 행은 저장마다 전삭제·재삽입이라 FK로 쓰지 않고
-- building_id와 품목만 가진다.
-- 묶음 행: 같은 위치·제조연월·규격이면 qty>1 한 행(소화기 40대 건물의 첫 입력이 대개 5~8행). QR(tag_code)은 qty=1 행에만.
-- RLS: 131 inspection_pump_tests 거울 — 읽기 로그인, 쓰기 서버 액션(service role)만. company_id는 SaaS 규칙대로 처음부터(NULL).

CREATE TABLE IF NOT EXISTS equipment_assets (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID,
  customer_id      UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  building_id      UUID        REFERENCES buildings(id) ON DELETE SET NULL,
  category         TEXT        NOT NULL,
  sub_type         TEXT,                                   -- 약제·축압/가압·용량(3.3kg 등)
  location         TEXT,                                   -- 층·실 (자유 텍스트)
  qty              INTEGER     NOT NULL DEFAULT 1,
  manufactured_on  DATE,                                   -- 제조연월(그 달 1일로 저장)
  installed_on     DATE,
  maker            TEXT,
  model            TEXT,
  serial           TEXT,
  tag_code         TEXT        UNIQUE,                     -- QR(설비 QR 절 3단계) — qty=1 행에만
  tag_printed_at   TIMESTAMPTZ,
  lifespan_rule    TEXT        NOT NULL DEFAULT 'none',
  extension_until  DATE,                                   -- 성능확인 합격으로 연장된 만료일
  warranty_until   DATE,                                   -- 공사 하자보수 만료(완공일 + 2·3년)
  status           TEXT        NOT NULL DEFAULT 'in_use',
  replaced_by      UUID        REFERENCES equipment_assets(id) ON DELETE SET NULL,
  note             TEXT,
  created_by       UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT equipment_assets_category_check CHECK (category IN
    ('powder', 'other_ext', 'auto_diffuse', 'descender', 'hose', 'smoke_detector', 'gas_cylinder', 'pump')),
  CONSTRAINT equipment_assets_lifespan_check CHECK (lifespan_rule IN ('legal10', 'rec10', 'rec15', 'none')),
  CONSTRAINT equipment_assets_status_check   CHECK (status IN ('in_use', 'replaced', 'disposed', 'lost')),
  CONSTRAINT equipment_assets_qty_check      CHECK (qty >= 1),
  CONSTRAINT equipment_assets_tag_single     CHECK (tag_code IS NULL OR qty = 1)
);
CREATE INDEX IF NOT EXISTS idx_equipment_assets_customer ON equipment_assets(customer_id) WHERE status = 'in_use';
CREATE INDEX IF NOT EXISTS idx_equipment_assets_building ON equipment_assets(building_id);
ALTER TABLE equipment_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "equipment_assets_select_all" ON equipment_assets FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE TRIGGER trg_equipment_assets_updated_at BEFORE UPDATE ON equipment_assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE equipment_assets IS '설비 자산 대장 — 제조연월이 판정을 바꾸는 품목(분말소화기 법정 10년, 자동확산·완강기 권장 10년, 호스·연기감지기 권장 15년, 가스용기, 펌프 명판)의 개체·묶음 행';
COMMENT ON COLUMN equipment_assets.lifespan_rule IS 'legal10 법정 10년(분말소화기) / rec10·rec15 권장 / none 연수 없음. 만료 = manufactured_on + 연수, extension_until이 있으면 그것';

CREATE TABLE IF NOT EXISTS equipment_asset_events (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID,
  asset_id       UUID        NOT NULL REFERENCES equipment_assets(id) ON DELETE CASCADE,
  inspection_id  UUID        REFERENCES inspections(id) ON DELETE SET NULL,
  event_type     TEXT        NOT NULL,
  event_date     DATE        NOT NULL,
  result         TEXT,
  values         JSONB       NOT NULL DEFAULT '{}',        -- 압력·실내온도·약제높이·충전량·손실률·전압 등
  photo_path     TEXT,
  defect_id      UUID        REFERENCES inspection_defects(id) ON DELETE SET NULL,
  actor_id       UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- QR 단계에서 'scan'을 더하기 쉽게 이름을 붙여 둔다
  CONSTRAINT equipment_asset_events_type_check   CHECK (event_type IN ('install', 'inspect', 'measure', 'perf_check', 'repair', 'replace', 'dispose')),
  CONSTRAINT equipment_asset_events_result_check CHECK (result IS NULL OR result IN ('good', 'aging', 'defect'))
);
CREATE INDEX IF NOT EXISTS idx_equipment_asset_events_asset ON equipment_asset_events(asset_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_equipment_asset_events_insp  ON equipment_asset_events(inspection_id);
ALTER TABLE equipment_asset_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "equipment_asset_events_select_all" ON equipment_asset_events FOR SELECT USING (auth.uid() IS NOT NULL);

COMMENT ON TABLE equipment_asset_events IS '설비 개체 이력 — 가스계 약제저장량 점검리스트의 한 줄 = measure 이벤트 한 행(유니크 없음, 재측정 허용)';

-- 2단계 선반영: 불량이 어느 개체의 것인지(선택). 불량 쪽 쓰기 경로는 명시 열 목록이라 열 추가 자체는 무영향.
ALTER TABLE inspection_defects ADD COLUMN IF NOT EXISTS asset_id UUID REFERENCES equipment_assets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_inspection_defects_asset ON inspection_defects(asset_id) WHERE asset_id IS NOT NULL;
