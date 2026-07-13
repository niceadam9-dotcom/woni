-- 083: 선택적 소유자 그룹 (P4-4, §1-0)
-- 한 소유자가 여러 대상물(customers)의 소방안전관리비를 통합 지불하는 경우만 그룹화.
-- owner_id는 nullable — 대부분 고객은 소유자 그룹 없이 개별 관리(선택적).

CREATE TABLE IF NOT EXISTS owners (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,               -- 소유자(그룹) 명
  contact     TEXT,                               -- 대표 연락처
  note        TEXT,
  created_by  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES owners(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_owner ON customers(owner_id);

COMMENT ON COLUMN customers.owner_id IS '선택적 소유자 그룹. NULL이면 개별 관리. 같은 owner_id끼리 통합청구·입금배분·[소유자별 보기] 대상.';

ALTER TABLE owners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owners_all ON owners;
CREATE POLICY owners_all ON owners FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_owners_updated_at ON owners;
CREATE TRIGGER trg_owners_updated_at
  BEFORE UPDATE ON owners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
