-- 080: 사업자정보(billing_profiles) — 세금계산서 발행용 (P4-1, §4-7)
-- 고객 1:1. 사업자번호·대표자·주소·업태/종목·계산서 이메일.

CREATE TABLE IF NOT EXISTS billing_profiles (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID        NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  business_no    TEXT,                          -- 사업자등록번호 (000-00-00000)
  company_name   TEXT,                          -- 상호(법인명)
  rep_name       TEXT,                          -- 대표자
  address        TEXT,                          -- 사업장 주소
  business_type  TEXT,                          -- 업태
  business_item  TEXT,                          -- 종목
  tax_email      TEXT,                          -- 세금계산서 수신 이메일
  note           TEXT,
  created_by     UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_profiles_customer ON billing_profiles(customer_id);

ALTER TABLE billing_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_profiles_all ON billing_profiles;
CREATE POLICY billing_profiles_all ON billing_profiles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_billing_profiles_updated_at ON billing_profiles;
CREATE TRIGGER trg_billing_profiles_updated_at
  BEFORE UPDATE ON billing_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
