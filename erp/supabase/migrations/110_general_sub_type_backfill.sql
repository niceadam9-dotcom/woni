-- ============================================================
-- 110_general_sub_type_backfill.sql
-- 소방계획서_6 W-3 (마이그레이션 A): 일반관리 고객 sub_type 일괄 '작동' 백필
--
-- 배경 (D-1·D-2): 일반관리도 소방안전관리와 동일하게 종합/작동 자체점검을
-- 수행한다. 기존 일반관리 고객은 030에서 inspection_sub_type=NULL로
-- 백필되어 있으므로 일괄 '작동'으로 채우고, 종합 대상만 화면에서 개별
-- 수정한다(법령상 종합 요건은 일반관리엔 소수 — planned 상태가 안전장치).
--
-- 실데이터 절차(D-7): 백필 전 대상 건수를 NOTICE로 남긴다.
-- 멱등: sub_type IS NULL 조건이라 재실행해도 무해.
-- ============================================================

DO $$
DECLARE
  cust_cnt INT;
  item_cnt INT;
BEGIN
  SELECT COUNT(*) INTO cust_cnt FROM customers
    WHERE inspection_category = '일반관리' AND inspection_sub_type IS NULL;
  SELECT COUNT(*) INTO item_cnt FROM inspection_plan_items
    WHERE inspection_category = '일반관리' AND inspection_sub_type IS NULL;
  RAISE NOTICE '110 백필 대상 — customers: %건, inspection_plan_items: %건', cust_cnt, item_cnt;
END $$;

-- 1. 일반관리 고객 sub_type NULL → '작동' (종합 대상은 이후 화면에서 개별 수정)
UPDATE customers
SET inspection_sub_type = '작동'
WHERE inspection_category = '일반관리'
  AND inspection_sub_type IS NULL;

-- 2. 계획 항목도 동일 백필 — 판정 축 통일(W-4) 후 sub_type NULL이 남지 않도록.
--    완료·취소 포함 전 상태 대상(이력 표기 일관성), plan_type은 변경하지 않음
--    (미시작 event의 special_* 전환·삭제는 소급 스크립트 W-12가 정식 절차로 수행)
UPDATE inspection_plan_items
SET inspection_sub_type = '작동'
WHERE inspection_category = '일반관리'
  AND inspection_sub_type IS NULL;
