-- 069: 점검표 응답 (doc02 §4-5, P34-1) — 점검 건별 항목별 결과
-- result: 'O'(정상) / 'X'(불량) / 'N'(해당없음 ／)

CREATE TABLE IF NOT EXISTS inspection_sheet_responses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  item_code     TEXT NOT NULL,        -- 점검표 항목코드 (1-A-001 …)
  result        TEXT NOT NULL CHECK (result IN ('O','X','N')),
  memo          TEXT,
  updated_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (inspection_id, item_code)
);
CREATE INDEX IF NOT EXISTS idx_sheet_responses_insp ON inspection_sheet_responses(inspection_id);

ALTER TABLE inspection_sheet_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY sheet_responses_select ON inspection_sheet_responses FOR SELECT TO authenticated USING (true);
CREATE POLICY sheet_responses_write ON inspection_sheet_responses FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('employee','manager','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('employee','manager','admin')));
