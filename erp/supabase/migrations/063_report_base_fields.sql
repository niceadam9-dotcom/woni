-- 063: 보고서·과금 기초 필드 (doc02 §1-1, P3-1/P1-A)
-- 점검인력 경력수첩번호, 관계인 직위·생년월일, 고객 과금·관할소방서 필드.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS license_no    TEXT,   -- 점검자 경력수첩 번호 (보고서 개요)
  ADD COLUMN IF NOT EXISTS license_grade TEXT;   -- 자격 구분

ALTER TABLE customer_contacts
  ADD COLUMN IF NOT EXISTS position   TEXT,       -- 직위 (공문·위임장)
  ADD COLUMN IF NOT EXISTS birth_date DATE;       -- 생년월일 (위임장)

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS fee_untaxed         INTEGER,  -- 일반관리 점검료 건별(비과세)
  ADD COLUMN IF NOT EXISTS fee_taxed           INTEGER,  -- 일반관리 점검료 건별(과세)
  ADD COLUMN IF NOT EXISTS monthly_fee_untaxed INTEGER,  -- 종합/작동 월정액(비과세)
  ADD COLUMN IF NOT EXISTS monthly_fee_taxed   INTEGER,  -- 종합/작동 월정액(과세)
  ADD COLUMN IF NOT EXISTS fire_station        TEXT,     -- 관할 소방서 (지역 매핑 자동)
  ADD COLUMN IF NOT EXISTS fee_note            TEXT;     -- 수금 특이사항

COMMENT ON COLUMN customers.monthly_fee_untaxed IS '종합/작동=월정액, 일반관리=fee_* 건별 (doc02 §4-7)';
