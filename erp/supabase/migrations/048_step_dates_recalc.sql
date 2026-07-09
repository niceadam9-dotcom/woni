-- 048: 점검 단계 마감일 — 사용승인일 응당일 보정 + 1단계 확정 시 재계산 (2026-07-09)
--
-- 문제 1 (실증: 고객 탑텐): create_inspection_steps()가 customers.use_approval_date를
--   그대로 기준일로 사용 → 승인일이 2020-07-06이면 단계 마감일이 전부 2020년으로 생성.
-- 조치 1: 승인일을 점검 연도의 응당일로 변환해 사용 (2020-07-06 → 2026-07-06).
--
-- 문제 2: 1단계(점검일자확정)를 완료해도 2~6단계 마감일이 생성 시점 예상치에 고정.
--   법정 기한(소방서 보고서 15일 이내 등)은 실제 점검일 기준이므로 확정일 기준 재계산 필요.
-- 조치 2: recalc_inspection_steps(점검ID, 기준일) 함수 추가 — 미완료 2~6단계만 갱신.
--   completeStepAction(1단계 완료 시)에서 호출.

-- ── 1) 단계 생성 트리거: 승인일 응당일 보정 ─────────────────────
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
  step5_due := step4_due + INTERVAL '10 days';

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

-- ── 2) 1단계 확정 시 후속 단계 재계산 함수 ──────────────────────
-- p_base_date = 확정된 점검일. 미완료(2~6단계)만 갱신, 완료 단계는 보존.
CREATE OR REPLACE FUNCTION recalc_inspection_steps(p_inspection_id UUID, p_base_date DATE)
RETURNS void AS $$
DECLARE
  step4_due DATE;
  step5_due DATE;
BEGIN
  step4_due := add_working_days(p_base_date, 15);
  step5_due := step4_due + INTERVAL '10 days';

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

REVOKE ALL ON FUNCTION recalc_inspection_steps(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION recalc_inspection_steps(UUID, DATE) FROM anon;
REVOKE ALL ON FUNCTION recalc_inspection_steps(UUID, DATE) FROM authenticated;
GRANT EXECUTE ON FUNCTION recalc_inspection_steps(UUID, DATE) TO service_role;

NOTIFY pgrst, 'reload schema';
