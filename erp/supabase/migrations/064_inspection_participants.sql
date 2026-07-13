-- 064: 점검 참여자 (doc02 §1-1, P31-2)
-- 보고서 개요의 주된1 + 보조N 인력. 주된은 inspections.assigned_employee_id로도 존재하나
-- 보조 인력을 담기 위한 테이블. (주된도 명시 저장 허용 — 보고서 생성 시 일원화 조회)

CREATE TABLE IF NOT EXISTS inspection_participants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  employee_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  role          TEXT NOT NULL CHECK (role IN ('주된','보조')),
  sort_order    INT  NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (inspection_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_insp_participants ON inspection_participants(inspection_id, role, sort_order);

ALTER TABLE inspection_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY insp_participants_select ON inspection_participants
  FOR SELECT TO authenticated USING (true);
CREATE POLICY insp_participants_write ON inspection_participants
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('employee','manager','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('employee','manager','admin')));
