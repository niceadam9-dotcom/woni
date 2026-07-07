-- ============================================================
-- buildings (건물 관리)
-- ============================================================
CREATE TABLE IF NOT EXISTS buildings (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID        NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  building_name TEXT        NOT NULL,
  address       TEXT,
  total_area    NUMERIC(12, 2),
  floors_above  SMALLINT,
  floors_below  SMALLINT,
  purpose       TEXT,
  year_built    SMALLINT,
  notes         TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by    UUID        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_buildings_customer  ON buildings(customer_id);
CREATE INDEX IF NOT EXISTS idx_buildings_active    ON buildings(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_buildings_purpose   ON buildings(purpose);

CREATE OR REPLACE TRIGGER trg_buildings_updated_at
  BEFORE UPDATE ON buildings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE buildings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All employees can view buildings"
  ON buildings FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Managers and admins manage buildings"
  ON buildings FOR ALL
  USING (current_user_role() IN ('manager', 'admin'));
