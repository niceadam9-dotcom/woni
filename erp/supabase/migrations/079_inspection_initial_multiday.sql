-- 079: 최초점검 자동판정(P32-8) + 다일 점검(P32-9)
-- 추가 전용(additive). 6단계 기산점 트리거 변경은 후속 작업으로 분리(위험 최소화).

ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS is_initial        BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inspection_end_date DATE,
  ADD COLUMN IF NOT EXISTS inspection_days   SMALLINT NOT NULL DEFAULT 1
                           CHECK (inspection_days BETWEEN 1 AND 5);

COMMENT ON COLUMN inspections.is_initial IS '최초점검 여부: 해당 고객의 이전 종합점검 이력이 없을 때 true (갑지 [√]최초 분기)';
COMMENT ON COLUMN inspections.inspection_end_date IS '다일 점검 종료일. NULL이면 당일(=inspection_start_date). 개요 점검기간·6단계 기산점의 기준.';
COMMENT ON COLUMN inspections.inspection_days IS '점검 소요일수(1~5). end_date와 함께 다일 점검 표기.';
