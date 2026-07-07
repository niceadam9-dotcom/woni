-- ============================================================
-- 035_inspection_type_data.sql  ← 2단계: 데이터 마이그레이션
-- 반드시 034 실행 + 커밋 후에 실행하세요.
-- ============================================================

-- Step 1. 기존 '최초', '기타' → '작동' 변경
UPDATE customers
SET inspection_type = '작동'
WHERE inspection_type IN ('최초', '기타');

UPDATE inspection_plan_items
SET inspection_type = '작동'
WHERE inspection_type IN ('최초', '기타');

UPDATE inspections
SET inspection_type = '작동'
WHERE inspection_type IN ('최초', '기타');

-- Step 2. inspection_category / inspection_sub_type 컬럼 추가 (030 미적용 대비)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS inspection_category TEXT
    CHECK (inspection_category IN ('소방안전관리', '일반관리')),
  ADD COLUMN IF NOT EXISTS inspection_sub_type TEXT
    CHECK (inspection_sub_type IN ('종합', '작동') OR inspection_sub_type IS NULL);

ALTER TABLE inspection_plan_items
  ADD COLUMN IF NOT EXISTS inspection_category TEXT
    CHECK (inspection_category IN ('소방안전관리', '일반관리')),
  ADD COLUMN IF NOT EXISTS inspection_sub_type TEXT
    CHECK (inspection_sub_type IN ('종합', '작동') OR inspection_sub_type IS NULL);

-- Step 3. inspection_category / inspection_sub_type 값 동기화
UPDATE customers
SET
  inspection_category = CASE
    WHEN inspection_type IN ('종합', '작동') THEN '소방안전관리'
    WHEN inspection_type = '일반관리'       THEN '일반관리'
    ELSE '소방안전관리'
  END,
  inspection_sub_type = CASE
    WHEN inspection_type = '종합' THEN '종합'
    WHEN inspection_type = '작동' THEN '작동'
    ELSE NULL
  END;

UPDATE inspection_plan_items
SET
  inspection_category = CASE
    WHEN inspection_type IN ('종합', '작동') THEN '소방안전관리'
    WHEN inspection_type = '일반관리'       THEN '일반관리'
    ELSE '소방안전관리'
  END,
  inspection_sub_type = CASE
    WHEN inspection_type = '종합' THEN '종합'
    WHEN inspection_type = '작동' THEN '작동'
    ELSE NULL
  END;

-- Step 4. 인덱스
CREATE INDEX IF NOT EXISTS idx_customers_inspection_category   ON customers(inspection_category);
CREATE INDEX IF NOT EXISTS idx_customers_inspection_sub_type   ON customers(inspection_sub_type);
CREATE INDEX IF NOT EXISTS idx_plan_items_inspection_category  ON inspection_plan_items(inspection_category);
CREATE INDEX IF NOT EXISTS idx_plan_items_inspection_sub_type  ON inspection_plan_items(inspection_sub_type);
