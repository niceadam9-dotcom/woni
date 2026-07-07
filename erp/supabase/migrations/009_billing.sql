-- ============================================================
-- Billing — 정산현황 모니터링 (회계연동)
-- Victory6.md §10 기반
-- ============================================================

-- 청구서
CREATE TABLE bills (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id              UUID         NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  inspection_plan_item_id  UUID         REFERENCES inspection_plan_items(id) ON DELETE SET NULL,
  billing_month            VARCHAR(7)   NOT NULL,                          -- 'YYYY.MM'
  bill_type                VARCHAR(30)  NOT NULL DEFAULT '일괄점검',
  bill_date                DATE         NOT NULL,
  supply_value             NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_value                NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount             NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid_amount              NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid_at                  DATE,
  payment_method           VARCHAR(20),
  notes                    TEXT,
  created_by               UUID         NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bills_customer    ON bills(customer_id);
CREATE INDEX idx_bills_month       ON bills(billing_month);
CREATE INDEX idx_bills_bill_date   ON bills(bill_date);
CREATE INDEX idx_bills_paid_at     ON bills(paid_at);

CREATE TRIGGER trg_bills_updated_at
  BEFORE UPDATE ON bills
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bills_select"  ON bills FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "bills_manage"  ON bills FOR ALL    USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
);

-- 세금계산서
CREATE TABLE tax_invoices (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id         UUID         NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  issue_date      DATE,
  approval_num    VARCHAR(50),
  invoice_status  VARCHAR(20)  NOT NULL DEFAULT '전송대기'
                               CHECK (invoice_status IN ('발행완료','취소','전송대기')),
  issued          BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(bill_id)
);

CREATE INDEX idx_tax_invoices_bill ON tax_invoices(bill_id);

ALTER TABLE tax_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tax_invoices_select" ON tax_invoices FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "tax_invoices_manage" ON tax_invoices FOR ALL   USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
);
