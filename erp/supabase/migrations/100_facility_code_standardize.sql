-- 100: 소방시설 코드 표준화 (2026-07-23, 소방계획서_4.md §4-3 — P4-②)
-- fire_facilities.facility_code 축약 22종 → 서식 1.4 정식 명칭 표준 코드 (src/lib/facility-codes.ts와 동일 기준)
-- 재실행 멱등: 표준화 후에는 WHERE가 매칭되지 않음.

-- 1:1 개명
UPDATE fire_facilities SET facility_code = '소화기구 및 자동소화장치' WHERE facility_code = '소화기구';
UPDATE fire_facilities SET facility_code = '옥내소화전설비'          WHERE facility_code = '옥내소화전';
UPDATE fire_facilities SET facility_code = '옥외소화전설비'          WHERE facility_code = '옥외소화전';
UPDATE fire_facilities SET facility_code = '스프링클러설비'          WHERE facility_code = '스프링클러';
UPDATE fire_facilities SET facility_code = '간이스프링클러설비'      WHERE facility_code = '간이스프링클러';
UPDATE fire_facilities SET facility_code = '자동화재탐지설비 및 시각경보기' WHERE facility_code = '자동화재탐지설비';
UPDATE fire_facilities SET facility_code = '소화수조 및 저수조'      WHERE facility_code = '소화수조·저수조';

-- 1:N 이관 — 대표 코드로 옮기고 재확인 노트 (§4-3: 화면에서 재확인 안내 뱃지)
UPDATE fire_facilities SET facility_code = '물분무소화설비',
  detail = COALESCE(detail, '{}'::jsonb) || jsonb_build_object('note',
    CASE WHEN COALESCE(detail->>'note', '') = '' THEN '코드 이관(물분무등소화설비) — 세부 확인 필요'
         ELSE (detail->>'note') || ' / 코드 이관(물분무등소화설비) — 세부 확인 필요' END)
WHERE facility_code = '물분무등소화설비';

UPDATE fire_facilities SET facility_code = '거실제연설비',
  detail = COALESCE(detail, '{}'::jsonb) || jsonb_build_object('note',
    CASE WHEN COALESCE(detail->>'note', '') = '' THEN '코드 이관(제연설비) — 세부 확인 필요'
         ELSE (detail->>'note') || ' / 코드 이관(제연설비) — 세부 확인 필요' END)
WHERE facility_code = '제연설비';

-- 1:2 분리 — 유도등·유도표지 → 유도등 + 유도표지 (둘 다 체크, §4-3)
INSERT INTO fire_facilities (building_id, category, facility_code, installed, detail)
SELECT building_id, '피난구조설비', '유도표지', installed, detail
FROM fire_facilities WHERE facility_code = '유도등·유도표지'
ON CONFLICT (building_id, facility_code) DO NOTHING;

UPDATE fire_facilities SET facility_code = '유도등' WHERE facility_code = '유도등·유도표지';
