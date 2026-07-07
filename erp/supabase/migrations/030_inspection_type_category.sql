-- ============================================================
-- 030_inspection_type_category.sql
-- Victory10.md P-1: 점검유형 체계 재편
--
-- customers 테이블에 대분류/중분류 컬럼 추가:
--   inspection_category: '소방안전관리' | '일반관리'
--   inspection_sub_type:  '종합' | '작동' | NULL (일반관리)
--
-- 기존 inspection_type 컬럼은 유지 (하위 호환)
-- 마이그레이션 후 기존 데이터 자동 채움:
--   종합 → 소방안전관리 / 종합
--   최초 → 소방안전관리 / 작동
--   기타 → 소방안전관리 / 작동
-- ============================================================

-- 1. customers 테이블에 컬럼 추가
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS inspection_category TEXT
    CHECK (inspection_category IN ('소방안전관리', '일반관리')),
  ADD COLUMN IF NOT EXISTS inspection_sub_type TEXT
    CHECK (inspection_sub_type IN ('종합', '작동') OR inspection_sub_type IS NULL);

-- 2. 기존 데이터 자동 채움 (035 이후: '최초'/'기타'→'작동', '일반관리' 신규)
UPDATE customers
SET
  inspection_category = CASE
    WHEN inspection_type IN ('종합', '최초', '기타', '작동') THEN '소방안전관리'
    ELSE '일반관리'
  END,
  inspection_sub_type = CASE
    WHEN inspection_type = '종합' THEN '종합'
    WHEN inspection_type IN ('최초', '기타', '작동') THEN '작동'
    ELSE NULL
  END
WHERE inspection_category IS NULL;

-- 3. inspection_plan_items에도 동일 컬럼 추가
ALTER TABLE inspection_plan_items
  ADD COLUMN IF NOT EXISTS inspection_category TEXT
    CHECK (inspection_category IN ('소방안전관리', '일반관리')),
  ADD COLUMN IF NOT EXISTS inspection_sub_type TEXT
    CHECK (inspection_sub_type IN ('종합', '작동') OR inspection_sub_type IS NULL);

-- 4. plan_items 기존 데이터 채움
UPDATE inspection_plan_items pi
SET
  inspection_category = CASE
    WHEN pi.inspection_type IN ('종합', '최초', '기타', '작동') THEN '소방안전관리'
    ELSE '일반관리'
  END,
  inspection_sub_type = CASE
    WHEN pi.inspection_type = '종합' THEN '종합'
    WHEN pi.inspection_type IN ('최초', '기타', '작동') THEN '작동'
    ELSE NULL
  END
WHERE pi.inspection_category IS NULL;

-- 5. 인덱스
CREATE INDEX IF NOT EXISTS idx_customers_inspection_category ON customers(inspection_category);
CREATE INDEX IF NOT EXISTS idx_customers_inspection_sub_type ON customers(inspection_sub_type);
CREATE INDEX IF NOT EXISTS idx_plan_items_inspection_category ON inspection_plan_items(inspection_category);
