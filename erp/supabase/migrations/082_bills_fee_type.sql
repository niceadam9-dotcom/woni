-- 082: 이원 과금 — bills.fee_type (P4-3, §4-7)
-- 정액(종합/작동 월정액) / 건별(일반관리 건별). inspection_type에서 파생하되 청구 시점 확정값을 보관.

ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS fee_type VARCHAR(10) NOT NULL DEFAULT '건별'
    CHECK (fee_type IN ('정액', '건별'));

COMMENT ON COLUMN bills.fee_type IS '과금 유형: 정액(종합/작동 월정액) / 건별(일반관리). 청구 생성 시 고객 inspection_type에서 확정.';

CREATE INDEX IF NOT EXISTS idx_bills_fee_type ON bills(fee_type);
