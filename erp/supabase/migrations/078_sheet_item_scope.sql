-- 078: 점검표 항목 적용범위 (doc02 P2-2)
-- inspection_sheet_items에 종합전용(●) 여부 추가.
--   comprehensive_only = false → 작동+종합 공통(○) / true → 종합점검 전용(●)
-- 작동점검 시 종합전용 항목은 화면·보고서에서 제외(§4-5).

ALTER TABLE inspection_sheet_items
  ADD COLUMN IF NOT EXISTS comprehensive_only BOOLEAN NOT NULL DEFAULT false;
