-- 050: 5단계(소방보수 완료) 마감 규칙 통일 (2026-07-09)
--
-- 확정 규칙 (사용자 확인): step5 = step4 당일을 1일째로 포함한 절대일 10일째 = step4 + 9일.
--   예) step4 2026-08-18 → step5 2026-08-27.
-- 계획 확정 계산(confirmPlanItemStageOneAction)은 원래 +9였고,
-- DB 트리거(019/048)와 recalc_inspection_steps(048)가 +10으로 어긋나 있어 +9로 통일한다.

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
    (NEW.id, 1, '1단계: 점검일자확정',                       1,  TRUE,  step1_due),
    (NEW.id, 2, '2단계: 배치확인서 보고서 작성',              5,  TRUE,  add_working_days(step1_due, 5)),
    (NEW.id, 3, '3단계: 관계인 보고서 제출',                 10, TRUE,  add_working_days(step1_due, 10)),
    (NEW.id, 4, '4단계: 소방서 보고서 제출 및 이행계획서 등록', 15, TRUE,  step4_due),
    (NEW.id, 5, '5단계: 소방보수 완료',                     10, FALSE, step5_due),
    (NEW.id, 6, '6단계: 이행완료보고서 제출',                10, TRUE,  add_working_days(step5_due, 10));

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION recalc_inspection_steps(p_inspection_id UUID, p_base_date DATE)
RETURNS void AS $$
DECLARE
  step4_due DATE;
  step5_due DATE;
BEGIN
  step4_due := add_working_days(p_base_date, 15);
  step5_due := step4_due + INTERVAL '9 days'; -- 당일 포함 10일째

  UPDATE inspection_steps SET due_date = add_working_days(p_base_date, 5)
   WHERE inspection_id = p_inspection_id AND step_num = 2 AND status <> 'completed';
  UPDATE inspection_steps SET due_date = add_working_days(p_base_date, 10)
   WHERE inspection_id = p_inspection_id AND step_num = 3 AND status <> 'completed';
  UPDATE inspection_steps SET due_date = step4_due
   WHERE inspection_id = p_inspection_id AND step_num = 4 AND status <> 'completed';
  UPDATE inspection_steps SET due_date = step5_due
   WHERE inspection_id = p_inspection_id AND step_num = 5 AND status <> 'completed';
  UPDATE inspection_steps SET due_date = add_working_days(step5_due, 10)
   WHERE inspection_id = p_inspection_id AND step_num = 6 AND status <> 'completed';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
