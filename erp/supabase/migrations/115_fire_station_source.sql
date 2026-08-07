-- 115: 관할 소방서 자동 지정의 '출처' 기록 (소방계획서_11.md §13-C — C-1)
--
-- 배경: 114/D-3에서 관할 소방서를 4단계 폴백으로 반드시 채우게 했는데, 마지막 단계는
--   '시/군명 + 소방서' **규칙 추정**이다. 065 시드 자체에 반례가 있다:
--     ('분당','분당소방서','성남시')  → 성남시 주소면 추정이 '성남소방서'를 만드는데
--                                      분당 지역 관할은 분당소방서다(둘 다 실재하는 소방서).
--   틀린 값이 그럴듯하게 들어가므로, 어떻게 채워졌는지를 남겨 화면에서 '확인 필요'를 띄운다.
--
-- 값: region | region_only | sigungu | estimate  (NULL = 사용자가 직접 입력했거나 미지정)

ALTER TABLE customers ADD COLUMN IF NOT EXISTS fire_station_source TEXT;

COMMENT ON COLUMN customers.fire_station_source IS
  '관할 소방서 자동 지정 출처(region/region_only/sigungu/estimate). NULL이면 수동 입력 — estimate는 추정이므로 화면에서 확인 필요 배지';
