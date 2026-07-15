-- 091: 소방계획서 연계 6차 필드 (2026-07-15, 전면 DB화 확정)
-- 급수·화재보험·운영/인원현황(customers 컬럼) + 자위소방대 편성(테이블)
-- 설계: erp_goal/소방계획서-필드확장-설계.md §3

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS building_grade            TEXT,     -- 대상물 급수: 특급/1급/2급/3급
  ADD COLUMN IF NOT EXISTS insurance_joined          BOOLEAN,  -- 화재보험 가입 여부
  ADD COLUMN IF NOT EXISTS insurance_company         TEXT,
  ADD COLUMN IF NOT EXISTS insurance_period          TEXT,     -- 예: 2026-01-01 ~ 2027-01-01
  ADD COLUMN IF NOT EXISTS insurance_amount_person   TEXT,     -- 대인 (자유 표기)
  ADD COLUMN IF NOT EXISTS insurance_amount_property TEXT,     -- 대물
  ADD COLUMN IF NOT EXISTS op_hours_weekday          TEXT,     -- 평일 운영: 24시간/09~18시/주간만/미운영/직접입력
  ADD COLUMN IF NOT EXISTS op_hours_holiday          TEXT,     -- 휴일 운영
  ADD COLUMN IF NOT EXISTS headcount_worker          INT,      -- 근무 인원
  ADD COLUMN IF NOT EXISTS headcount_resident        INT,      -- 거주 인원
  ADD COLUMN IF NOT EXISTS headcount_max             INT;      -- 최대 수용 인원

-- 자위소방대 편성 (가변 행)
CREATE TABLE IF NOT EXISTS fire_brigade_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  team        TEXT NOT NULL,            -- 자위소방대장/부대장/비상연락/초기소화/피난유도/응급구조
  name        TEXT NOT NULL,
  duty        TEXT,                     -- 개별임무 (표준 문구 자동)
  phone       TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fire_brigade_customer ON fire_brigade_members(customer_id, sort_order);
ALTER TABLE fire_brigade_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fire_brigade_read ON fire_brigade_members;
CREATE POLICY fire_brigade_read ON fire_brigade_members
  FOR SELECT USING (auth.uid() IS NOT NULL);

COMMENT ON COLUMN customers.building_grade IS '소방안전관리대상물 급수 (소방계획서 서식1.1·1.8·2.1)';
COMMENT ON TABLE fire_brigade_members IS '자위소방대 편성 (소방계획서 서식2.2)';
