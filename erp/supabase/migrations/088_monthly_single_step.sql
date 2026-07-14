-- 088: 정기(monthly) 점검도 1단계 체크리스트 + 정기 점검 시작 연 1회 제한 해제 (2026-07-14)
--
-- 배경: 법정 6단계(배치확인서~이행완료보고서)는 자체점검(특별점검: 종합·작동) 보고 절차 —
--       매월 정기 방문에는 해당 의무가 없어 087의 일반관리와 동일하게 1단계(점검일)만 생성.
-- 문제 2가지 해결:
--   1) 트리거가 정기/특별을 구분 못함 → inspections.plan_type 컬럼 추가 (점검 시작 시 계획항목 값 저장)
--   2) UNIQUE(customer, year, sequence)가 정기 시작을 연 1회로 막음(정기도 전부 1차) →
--      특별점검(및 plan_type 미상 수동 등록)만 유일 강제하는 부분 유니크 인덱스로 교체

-- 1. plan_type 컬럼 추가
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS plan_type TEXT;

-- 2. 기존 점검 백필 — 연결된 계획항목의 plan_type
UPDATE inspections i
SET plan_type = pi.plan_type
FROM inspection_plan_items pi
WHERE pi.inspection_id = i.id
  AND i.plan_type IS NULL
  AND pi.plan_type IS NOT NULL;

-- 3. 생성 트리거 함수 갱신 (087과 동일, 정기/이벤트 분기 확장)
CREATE OR REPLACE FUNCTION create_inspection_steps()
RETURNS TRIGGER AS $$
DECLARE
  approval  DATE;
  base_date DATE;
  insp_year INT;
  step1_due DATE;
  step4_due DATE;
  step5_due DATE;
BEGIN
  -- 일반관리·정기(monthly)·일반 이벤트: 1단계(점검일)만 — 법정 보고 절차 없음.
  -- 마감일 = 점검시작일 (영업일 보정 없음)
  IF NEW.inspection_type = '일반관리' OR coalesce(NEW.plan_type, '') IN ('monthly', 'event') THEN
    INSERT INTO inspection_steps (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
    VALUES (NEW.id, 1, '1단계: 점검일', 0, FALSE, NEW.inspection_start_date);
    RETURN NEW;
  END IF;

  SELECT use_approval_date INTO approval FROM customers WHERE id = NEW.customer_id;

  IF approval IS NULL THEN
    base_date := NEW.inspection_start_date;
  ELSE
    -- 점검 연도의 응당일로 변환 (말일 초과분은 그 달 말일로 — 2/29 등)
    insp_year := EXTRACT(YEAR FROM NEW.inspection_start_date)::INT;
    base_date := make_date(
      insp_year,
      EXTRACT(MONTH FROM approval)::INT,
      LEAST(
        EXTRACT(DAY FROM approval)::INT,
        EXTRACT(DAY FROM (make_date(insp_year, EXTRACT(MONTH FROM approval)::INT, 1)
                          + INTERVAL '1 month - 1 day'))::INT
      )
    );
  END IF;

  step1_due := add_working_days(base_date, 1);
  step4_due := add_working_days(step1_due, 15);
  step5_due := step4_due + INTERVAL '9 days'; -- 당일 포함 10일째

  INSERT INTO inspection_steps (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES
    (NEW.id, 1, '1단계: 점검일',                            1,  TRUE,  step1_due),
    (NEW.id, 2, '2단계: 배치확인서 보고서 작성',              5,  TRUE,  add_working_days(step1_due, 5)),
    (NEW.id, 3, '3단계: 관계인 보고서 제출',                 10, TRUE,  add_working_days(step1_due, 10)),
    (NEW.id, 4, '4단계: 소방서 보고서 제출 및 이행계획서 등록', 15, TRUE,  step4_due),
    (NEW.id, 5, '5단계: 소방보수 완료',                     10, FALSE, step5_due),
    (NEW.id, 6, '6단계: 이행완료보고서 제출',                10, TRUE,  add_working_days(step5_due, 10));

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. 기존 정기 점검의 오생성 단계 정리 (2~6단계 삭제 + 1단계 마감일 보정)
DELETE FROM inspection_steps s
USING inspections i
WHERE s.inspection_id = i.id
  AND i.plan_type = 'monthly'
  AND s.step_num > 1;

UPDATE inspection_steps s
SET due_date = i.inspection_start_date, due_days = 0, is_working_days = FALSE
FROM inspections i
WHERE s.inspection_id = i.id
  AND i.plan_type = 'monthly'
  AND s.step_num = 1;

-- 5. UNIQUE(customer, year, sequence) → 특별점검·수동 등록만 유일 강제 (정기·이벤트 제외)
ALTER TABLE inspections DROP CONSTRAINT IF EXISTS inspections_customer_id_year_sequence_num_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inspections_special_year_seq
  ON inspections(customer_id, year, sequence_num)
  WHERE coalesce(plan_type, '') NOT IN ('monthly', 'event');
