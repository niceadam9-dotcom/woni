-- ============================================================
-- quotes — 견적서
-- ============================================================
CREATE TABLE quotes (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID        NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  quote_number   VARCHAR(30) NOT NULL,
  quote_date     DATE        NOT NULL,
  valid_until    DATE,
  items          JSONB       NOT NULL DEFAULT '[]',
  subtotal       NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  status         VARCHAR(10) NOT NULL DEFAULT '작성중'
                 CHECK (status IN ('작성중','발송','수주','취소','만료')),
  notes          TEXT,
  created_by     UUID        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quotes_customer ON quotes(customer_id);
CREATE INDEX idx_quotes_status   ON quotes(status);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quotes_auth" ON quotes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_active = TRUE)
  );

CREATE TRIGGER trg_quotes_updated_at
  BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- orders — 수주
-- ============================================================
CREATE TABLE orders (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id       UUID        REFERENCES quotes(id) ON DELETE SET NULL,
  customer_id    UUID        NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  order_number   VARCHAR(30) NOT NULL,
  order_date     DATE        NOT NULL,
  delivery_date  DATE,
  items          JSONB       NOT NULL DEFAULT '[]',
  total_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  status         VARCHAR(10) NOT NULL DEFAULT '수주'
                 CHECK (status IN ('수주','진행중','완료','취소')),
  notes          TEXT,
  created_by     UUID        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status   ON orders(status);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders_auth" ON orders
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_active = TRUE)
  );

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
