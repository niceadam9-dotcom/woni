-- ============================================================
-- Inquiries — 문의요청 테이블 생성 및 주소 필드 추가
-- ============================================================

-- 테이블이 없는 경우 생성
CREATE TABLE IF NOT EXISTS inquiries (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID         NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  inquiry_type     TEXT         NOT NULL DEFAULT 'as_request'
                                CHECK (inquiry_type IN ('as_request','schedule','quote','other')),
  title            TEXT         NOT NULL,
  content          TEXT         NOT NULL,
  contact_name     TEXT,
  contact_phone    TEXT,
  status           TEXT         NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','in_progress','resolved','cancelled')),
  resolution_notes TEXT,
  resolved_at      TIMESTAMPTZ,
  resolved_by      UUID         REFERENCES profiles(id) ON DELETE SET NULL,
  created_by       UUID         NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 주소 필드 추가 (이미 있으면 무시)
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS zipcode     TEXT;
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS address     TEXT;
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS region_si   TEXT;
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS region_myeon TEXT;
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS region_ri   TEXT;

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_inquiries_customer  ON inquiries(customer_id);
CREATE INDEX IF NOT EXISTS idx_inquiries_status    ON inquiries(status);
CREATE INDEX IF NOT EXISTS idx_inquiries_created   ON inquiries(created_at DESC);

-- updated_at 자동 갱신 트리거
DROP TRIGGER IF EXISTS trg_inquiries_updated_at ON inquiries;
CREATE TRIGGER trg_inquiries_updated_at
  BEFORE UPDATE ON inquiries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inquiries_select" ON inquiries;
CREATE POLICY "inquiries_select"
  ON inquiries FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "inquiries_insert" ON inquiries;
CREATE POLICY "inquiries_insert"
  ON inquiries FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "inquiries_update" ON inquiries;
CREATE POLICY "inquiries_update"
  ON inquiries FOR UPDATE
  USING (auth.uid() IS NOT NULL);
