-- ============================================================
-- Inspection Report Status — 점검보고서 제출현황 모니터링
-- Victory4.md §10-8 기반
-- ============================================================

CREATE TABLE inspection_report_status (
  id                        UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_item_id              UUID    NOT NULL REFERENCES inspection_plan_items(id) ON DELETE CASCADE,
  inspection_completed_at   DATE,
  notification_date         DATE,
  notification_due_date     DATE    GENERATED ALWAYS AS (
                              CASE
                                WHEN inspection_completed_at IS NOT NULL
                                THEN inspection_completed_at + INTERVAL '7 days'
                                ELSE NULL
                              END
                            ) STORED,
  submission_deadline       DATE    GENERATED ALWAYS AS (
                              CASE
                                WHEN inspection_completed_at IS NOT NULL
                                THEN inspection_completed_at + INTERVAL '30 days'
                                ELSE NULL
                              END
                            ) STORED,
  sent_at                   DATE,
  received_at               DATE,
  returned_at               DATE,
  fire_station_submitted    BOOLEAN NOT NULL DEFAULT FALSE,
  fee_billed                BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by                UUID    REFERENCES profiles(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(plan_item_id)
);

CREATE INDEX idx_report_status_plan_item    ON inspection_report_status(plan_item_id);
CREATE INDEX idx_report_status_deadline     ON inspection_report_status(submission_deadline);
CREATE INDEX idx_report_status_notif_due    ON inspection_report_status(notification_due_date);
CREATE INDEX idx_report_status_submitted    ON inspection_report_status(fire_station_submitted);

CREATE TRIGGER trg_inspection_report_status_updated_at
  BEFORE UPDATE ON inspection_report_status
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE inspection_report_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "report_status_select_all"
  ON inspection_report_status FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "report_status_manage"
  ON inspection_report_status FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );
