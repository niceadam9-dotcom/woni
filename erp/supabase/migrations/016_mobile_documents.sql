-- ============================================================
-- Mobile Documents — 현장 서류 (MB-04 ~ MB-08)
-- ============================================================

CREATE TABLE mobile_documents (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  customer_id  UUID        REFERENCES customers(id) ON DELETE SET NULL,
  doc_type     VARCHAR(30) NOT NULL
               CHECK (doc_type IN ('fire_plan','work_record','self_inspection','training_record','fire_incident')),
  doc_date     DATE        NOT NULL,
  title        TEXT        NOT NULL,
  content      JSONB       NOT NULL DEFAULT '{}',
  status       VARCHAR(20) NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','submitted')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mobile_docs_employee  ON mobile_documents(employee_id);
CREATE INDEX idx_mobile_docs_customer  ON mobile_documents(customer_id);
CREATE INDEX idx_mobile_docs_type_date ON mobile_documents(doc_type, doc_date DESC);

CREATE TRIGGER trg_mobile_docs_updated_at
  BEFORE UPDATE ON mobile_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE mobile_documents ENABLE ROW LEVEL SECURITY;

-- 직원은 본인 서류 전체 관리
CREATE POLICY "mobile_docs_own"
  ON mobile_documents FOR ALL
  USING (employee_id = auth.uid());

-- manager/admin은 전체 조회
CREATE POLICY "mobile_docs_manager_read"
  ON mobile_documents FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin')
  ));
