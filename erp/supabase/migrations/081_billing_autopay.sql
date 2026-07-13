-- 081: 자동이체(billing_autopay) + 계좌 열람로그 (P4-2, §1-5)
-- 계좌번호는 AES-256-GCM으로 앱단 암호화하여 저장(account_no_enc). 주민번호는 저장 금지.

CREATE TABLE IF NOT EXISTS billing_autopay (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID        NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  bank_name       TEXT,                          -- 은행명
  account_holder  TEXT,                          -- 예금주
  account_no_enc  TEXT,                          -- 계좌번호 (AES-256-GCM, base64(iv|tag|cipher))
  account_no_last4 TEXT,                         -- 마스킹 표시용 뒤 4자리(평문)
  withdraw_day    SMALLINT    CHECK (withdraw_day BETWEEN 1 AND 31),  -- 자동이체일
  note            TEXT,
  created_by      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_autopay_customer ON billing_autopay(customer_id);

-- 계좌 평문 열람/수정 감사 로그
CREATE TABLE IF NOT EXISTS account_access_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  accessed_by  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  action       TEXT        NOT NULL CHECK (action IN ('view', 'edit')),
  accessed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_access_log_customer ON account_access_log(customer_id, accessed_at DESC);

ALTER TABLE billing_autopay ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_access_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_autopay_all ON billing_autopay;
CREATE POLICY billing_autopay_all ON billing_autopay
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS account_access_log_all ON account_access_log;
CREATE POLICY account_access_log_all ON account_access_log
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_billing_autopay_updated_at ON billing_autopay;
CREATE TRIGGER trg_billing_autopay_updated_at
  BEFORE UPDATE ON billing_autopay
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
