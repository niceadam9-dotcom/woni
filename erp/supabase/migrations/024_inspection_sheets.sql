-- 024_inspection_sheets.sql
-- 점검표 관리 테이블

CREATE TABLE IF NOT EXISTS inspection_sheets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_code      TEXT NOT NULL,
  sheet_name      TEXT NOT NULL,
  version         TEXT NOT NULL DEFAULT '1.0',
  inspection_type TEXT CHECK (inspection_type IN ('종합', '최초', '기타')),
  description     TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sheet_code, version)
);

CREATE TABLE IF NOT EXISTS inspection_sheet_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id            UUID NOT NULL REFERENCES inspection_sheets(id) ON DELETE CASCADE,
  item_code           TEXT NOT NULL,
  item_name           TEXT NOT NULL,
  facility_type       TEXT,
  inspection_method   TEXT,
  judgment_criteria   TEXT,
  order_num           INTEGER NOT NULL DEFAULT 1,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inspection_sheets_code    ON inspection_sheets(sheet_code);
CREATE INDEX IF NOT EXISTS idx_inspection_sheets_active  ON inspection_sheets(is_active);
CREATE INDEX IF NOT EXISTS idx_sheet_items_sheet         ON inspection_sheet_items(sheet_id);
CREATE INDEX IF NOT EXISTS idx_sheet_items_order         ON inspection_sheet_items(sheet_id, order_num);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_inspection_sheets_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inspection_sheets_updated_at
  BEFORE UPDATE ON inspection_sheets
  FOR EACH ROW EXECUTE FUNCTION update_inspection_sheets_updated_at();

CREATE TRIGGER trg_inspection_sheet_items_updated_at
  BEFORE UPDATE ON inspection_sheet_items
  FOR EACH ROW EXECUTE FUNCTION update_inspection_sheets_updated_at();

-- RLS
ALTER TABLE inspection_sheets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_sheet_items  ENABLE ROW LEVEL SECURITY;

-- 전 직원 조회 가능
CREATE POLICY "inspection_sheets_select" ON inspection_sheets
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "inspection_sheet_items_select" ON inspection_sheet_items
  FOR SELECT TO authenticated USING (true);

-- manager/admin만 생성·수정·삭제
CREATE POLICY "inspection_sheets_insert" ON inspection_sheets
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'admin'))
  );

CREATE POLICY "inspection_sheets_update" ON inspection_sheets
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'admin'))
  );

CREATE POLICY "inspection_sheets_delete" ON inspection_sheets
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'admin'))
  );

CREATE POLICY "inspection_sheet_items_insert" ON inspection_sheet_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'admin'))
  );

CREATE POLICY "inspection_sheet_items_update" ON inspection_sheet_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'admin'))
  );

CREATE POLICY "inspection_sheet_items_delete" ON inspection_sheet_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'admin'))
  );
