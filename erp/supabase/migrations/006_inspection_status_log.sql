-- ============================================================
-- Inspection Status Log — 점검현황 모니터링
-- Victory4.md §9-7 기반
-- ============================================================

CREATE TABLE inspection_status_log (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_item_id      UUID        NOT NULL REFERENCES inspection_plan_items(id) ON DELETE CASCADE,
  inspection_date   DATE,
  report_submitted_at DATE,
  sent_at           DATE,
  filed_at          DATE,
  sms_confirmed     BOOLEAN     NOT NULL DEFAULT FALSE,
  sms_sent_at       TIMESTAMPTZ,
  sms_content       TEXT,
  updated_by        UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(plan_item_id)
);

CREATE INDEX idx_status_log_plan_item ON inspection_status_log(plan_item_id);
CREATE INDEX idx_status_log_filed_at  ON inspection_status_log(filed_at);

CREATE TRIGGER trg_inspection_status_log_updated_at
  BEFORE UPDATE ON inspection_status_log
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE inspection_status_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "status_log_select_all"
  ON inspection_status_log FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "status_log_manage"
  ON inspection_status_log FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );
