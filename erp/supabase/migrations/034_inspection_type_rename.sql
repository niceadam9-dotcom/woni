-- ============================================================
-- 034_inspection_type_rename.sql  ← 1단계: ENUM 값 추가만
-- 실행 후 반드시 035를 별도로 실행해야 합니다.
-- ============================================================

-- inspection_type ENUM에 '작동', '일반관리' 추가
ALTER TYPE inspection_type ADD VALUE IF NOT EXISTS '작동';
ALTER TYPE inspection_type ADD VALUE IF NOT EXISTS '일반관리';
