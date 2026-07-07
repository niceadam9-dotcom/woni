-- ============================================================
-- 031_plan_item_stage_dates.sql
-- Victory10.md P-1/P-2: 점검계획 항목에 6단계 날짜 + 계획일 + 점검유형 컬럼 추가
--
-- planned_date  : 사용승인일 기준 자동계산 예상일 (변경 불가, 달력에 점선으로 표시)
-- step1~6_date  : 1단계 확정일 기준 자동계산 6단계 마감일
-- plan_type     : 점검 종류 (special_종합/special_작동/monthly/event)
-- ============================================================

-- 1. inspection_plan_items 컬럼 추가
ALTER TABLE inspection_plan_items
  ADD COLUMN IF NOT EXISTS planned_date  DATE,
  ADD COLUMN IF NOT EXISTS step1_date    DATE,
  ADD COLUMN IF NOT EXISTS step2_date    DATE,
  ADD COLUMN IF NOT EXISTS step3_date    DATE,
  ADD COLUMN IF NOT EXISTS step4_date    DATE,
  ADD COLUMN IF NOT EXISTS step5_date    DATE,
  ADD COLUMN IF NOT EXISTS step6_date    DATE,
  ADD COLUMN IF NOT EXISTS plan_type     TEXT
    CHECK (plan_type IN ('special_종합', 'special_작동', 'monthly', 'event') OR plan_type IS NULL);

-- 2. 기존 데이터 plan_type 채움 (035 이후: '최초'/'기타'→'작동')
UPDATE inspection_plan_items
SET plan_type = CASE
  WHEN inspection_type = '종합'                      THEN 'special_종합'
  WHEN inspection_type IN ('최초', '기타', '작동')   THEN 'special_작동'
  ELSE 'monthly'
END
WHERE plan_type IS NULL;

-- 3. 인덱스
CREATE INDEX IF NOT EXISTS idx_plan_items_plan_type    ON inspection_plan_items(plan_type);
CREATE INDEX IF NOT EXISTS idx_plan_items_planned_date ON inspection_plan_items(planned_date);
CREATE INDEX IF NOT EXISTS idx_plan_items_step1_date   ON inspection_plan_items(step1_date);
