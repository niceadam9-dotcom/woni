-- ============================================================
-- 036_step1_name_change.sql
-- Victory9 V9-10: 1단계 '점검 완료' → '점검일자확정' 명칭 변경
-- ============================================================

-- 1. 기존 레코드 이름 수정
UPDATE inspection_steps
SET name_ko = '1단계: 점검일자확정'
WHERE step_num = 1
  AND name_ko = '1단계: 점검 완료';

-- 2. 트리거 함수 재작성 (1단계 name_ko 변경)
CREATE OR REPLACE FUNCTION create_inspection_steps()
RETURNS TRIGGER AS $$
DECLARE
  base_date DATE;
  step1_due DATE;
  step4_due DATE;
  step5_due DATE;
BEGIN
  SELECT use_approval_date
    INTO base_date
    FROM customers
   WHERE id = NEW.customer_id;

  IF base_date IS NULL THEN
    base_date := NEW.inspection_start_date;
  END IF;

  step1_due := add_working_days(base_date, 1);

  INSERT INTO inspection_steps
    (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES
    (NEW.id, 1, '1단계: 점검일자확정', 1, TRUE, step1_due);

  INSERT INTO inspection_steps
    (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES
    (NEW.id, 2, '2단계: 배치확인서 보고서 작성', 5, TRUE,
     add_working_days(step1_due, 5));

  INSERT INTO inspection_steps
    (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES
    (NEW.id, 3, '3단계: 관계인 보고서 제출', 10, TRUE,
     add_working_days(step1_due, 10));

  step4_due := add_working_days(step1_due, 15);

  INSERT INTO inspection_steps
    (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES
    (NEW.id, 4, '4단계: 소방서 보고서 제출 및 이행계획서 등록', 15, TRUE, step4_due);

  step5_due := step4_due + INTERVAL '10 days';

  INSERT INTO inspection_steps
    (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES
    (NEW.id, 5, '5단계: 소방보수 완료', 10, FALSE, step5_due);

  INSERT INTO inspection_steps
    (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES
    (NEW.id, 6, '6단계: 이행완료보고서 제출', 10, TRUE,
     add_working_days(step5_due, 10));

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
