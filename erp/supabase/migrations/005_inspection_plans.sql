-- ============================================================
-- Inspection Plans Module — 점검계획 등록 (월간 자동 생성)
-- Victory4.md §6 기반
-- ============================================================

-- ============================================================
-- plan_status ENUM
-- ============================================================
CREATE TYPE plan_status      AS ENUM ('draft', 'confirmed', 'cancelled');
CREATE TYPE plan_item_status AS ENUM ('planned', 'confirmed', 'completed', 'cancelled');

-- ============================================================
-- inspection_plans (월간 점검계획 헤더)
-- ============================================================
CREATE TABLE inspection_plans (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  year           INT          NOT NULL CHECK (year >= 2020),
  month          INT          NOT NULL CHECK (month BETWEEN 1 AND 12),
  status         plan_status  NOT NULL DEFAULT 'draft',
  auto_generated BOOLEAN      NOT NULL DEFAULT FALSE,
  ref_plan_id    UUID         REFERENCES inspection_plans(id) ON DELETE SET NULL,
  notes          TEXT,
  confirmed_at   TIMESTAMPTZ,
  created_by     UUID         NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(year, month)
);

CREATE INDEX idx_inspection_plans_year_month ON inspection_plans(year, month);
CREATE INDEX idx_inspection_plans_status     ON inspection_plans(status);

-- ============================================================
-- inspection_plan_items (점검계획 세부 항목)
-- ============================================================
CREATE TABLE inspection_plan_items (
  id                   UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id              UUID             NOT NULL REFERENCES inspection_plans(id) ON DELETE CASCADE,
  customer_id          UUID             NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  inspection_type      inspection_type  NOT NULL,
  sequence_num         SMALLINT         NOT NULL CHECK (sequence_num IN (1, 2)),
  scheduled_date       DATE,
  assigned_employee_id UUID             REFERENCES profiles(id) ON DELETE SET NULL,
  contact_id           UUID             REFERENCES customer_contacts(id) ON DELETE SET NULL,
  status               plan_item_status NOT NULL DEFAULT 'planned',
  inspection_id        UUID             REFERENCES inspections(id) ON DELETE SET NULL,
  notes                TEXT,
  created_at           TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  UNIQUE(plan_id, customer_id, sequence_num)
);

CREATE INDEX idx_plan_items_plan_id           ON inspection_plan_items(plan_id);
CREATE INDEX idx_plan_items_customer_id       ON inspection_plan_items(customer_id);
CREATE INDEX idx_plan_items_scheduled_date    ON inspection_plan_items(scheduled_date);
CREATE INDEX idx_plan_items_assigned_employee ON inspection_plan_items(assigned_employee_id);

-- ============================================================
-- updated_at 자동 갱신 트리거
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inspection_plans_updated_at
  BEFORE UPDATE ON inspection_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_inspection_plan_items_updated_at
  BEFORE UPDATE ON inspection_plan_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- RLS 정책
-- ============================================================
ALTER TABLE inspection_plans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_plan_items ENABLE ROW LEVEL SECURITY;

-- 전 직원 조회 가능
CREATE POLICY "inspection_plans_select_all"
  ON inspection_plans FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "inspection_plan_items_select_all"
  ON inspection_plan_items FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- manager/admin만 등록·수정·삭제
CREATE POLICY "inspection_plans_manage"
  ON inspection_plans FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('manager', 'admin')
    )
  );

CREATE POLICY "inspection_plan_items_manage"
  ON inspection_plan_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('manager', 'admin')
    )
  );
