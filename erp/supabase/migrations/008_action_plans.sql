-- ============================================================
-- Action Plans — 이행계획/완료 제출현황 모니터링
-- Victory5.md §4 기반
-- ============================================================

-- 점검 불량내역
CREATE TABLE inspection_defects (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id  UUID         NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  defect_code    VARCHAR(20),
  defect_name    VARCHAR(200) NOT NULL,
  defect_detail  TEXT,
  photo_url      TEXT,
  severity       VARCHAR(10)  NOT NULL DEFAULT '보통' CHECK (severity IN ('경미', '보통', '중대')),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_defects_inspection ON inspection_defects(inspection_id);

ALTER TABLE inspection_defects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "defects_select_all"  ON inspection_defects FOR SELECT  USING (auth.uid() IS NOT NULL);
CREATE POLICY "defects_manage"      ON inspection_defects FOR ALL     USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
);

-- 이행계획서
CREATE TABLE action_plans (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id           UUID        NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  plan_file_url           TEXT,
  completion_target_date  DATE,
  submitted_at            DATE,
  sent_at                 DATE,
  created_by              UUID        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(inspection_id)
);

CREATE INDEX idx_action_plans_inspection ON action_plans(inspection_id);
CREATE INDEX idx_action_plans_submitted  ON action_plans(submitted_at);

CREATE TRIGGER trg_action_plans_updated_at
  BEFORE UPDATE ON action_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE action_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "action_plans_select_all" ON action_plans FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "action_plans_manage"     ON action_plans FOR ALL   USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
);

-- 이행완료보고서
CREATE TABLE action_complete_reports (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  action_plan_id  UUID        NOT NULL REFERENCES action_plans(id) ON DELETE CASCADE,
  report_file_url TEXT,
  completed_at    DATE,
  submitted_at    DATE,
  created_by      UUID        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(action_plan_id)
);

CREATE INDEX idx_complete_reports_plan ON action_complete_reports(action_plan_id);

CREATE TRIGGER trg_action_complete_reports_updated_at
  BEFORE UPDATE ON action_complete_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE action_complete_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "complete_reports_select_all" ON action_complete_reports FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "complete_reports_manage"     ON action_complete_reports FOR ALL   USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
);

-- 이행계획 진행 상태 로그
CREATE TABLE action_plan_status (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  action_plan_id             UUID        NOT NULL REFERENCES action_plans(id) ON DELETE CASCADE,
  sent_at                    DATE,
  fire_station_submitted_at  DATE,
  defect_certificate_count   INT         NOT NULL DEFAULT 0,
  updated_by                 UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(action_plan_id)
);

CREATE INDEX idx_action_plan_status_plan ON action_plan_status(action_plan_id);

CREATE TRIGGER trg_action_plan_status_updated_at
  BEFORE UPDATE ON action_plan_status
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE action_plan_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "action_plan_status_select_all" ON action_plan_status FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "action_plan_status_manage"     ON action_plan_status FOR ALL   USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
);
