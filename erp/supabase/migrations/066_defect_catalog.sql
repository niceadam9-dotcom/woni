-- 066: 불량 표준 사전 (doc02 §1-4, P2-1)
-- 점검번호 → 표준 불량내용. 점검표 항목코드와 동일 체계로 정규화(N-L-NNN)해
-- 점검표 X 선택 시 불량내용 자동완성(P34-3)에 사용.

CREATE TABLE IF NOT EXISTS defect_catalog (
  code        TEXT PRIMARY KEY,           -- 정규화 점검번호 (예: 1-A-004)
  equipment   TEXT NOT NULL,              -- 설비명 (소화설비/경보설비/피난구조설비/…)
  description TEXT NOT NULL,              -- 표준 불량내용 (예: 소화기 미비치)
  sort_order  INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_defect_catalog_equipment ON defect_catalog(equipment, sort_order);

ALTER TABLE defect_catalog ENABLE ROW LEVEL SECURITY;

-- 참조 데이터: 인증 사용자 조회 / manager·admin 쓰기 (시딩은 service role로 RLS 우회)
CREATE POLICY defect_catalog_select ON defect_catalog
  FOR SELECT TO authenticated USING (true);

CREATE POLICY defect_catalog_write ON defect_catalog
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin')));
