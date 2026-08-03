-- ============================================================
-- 111_steps_plan_type_axis.sql
-- 소방계획서_6 W-11 (마이그레이션 B): 단계 생성 트리거 개정 —
-- 1단계 대상 = plan_type(monthly·event)만, 일반관리 자체점검(special_*)은 6단계
--
-- 배경 (D-1): 일반관리도 소방안전관리와 동일한 자체점검(법정 6단계 보고 절차)
-- 대상이 된다. 087/088의 "inspection_type = '일반관리' → 1단계" 분기를 삭제하고
-- 판정 축을 plan_type 단독으로 통일한다 (앱 코드 isSpecial과 동일 기준):
--   monthly·event        → 1단계(점검일)만 (법정 보고 절차 없음)
--   special_*·null(미상)  → 법정 6단계
-- 기존 완료 event 건의 1단계 데이터는 무변경 (D-4 읽기 전용 보존 — 트리거는
-- INSERT 시에만 동작하므로 소급 영향 없음).
-- ============================================================

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
  -- 정기(monthly)·레거시 일반 이벤트(event): 1단계(점검일)만 — 법정 보고 절차 없음.
  -- 마감일 = 점검시작일 (영업일 보정 없음).
  -- 일반관리 자체점검(special_*)은 아래 6단계 경로 (소방계획서_6 W-11 — 관리유형 분기 삭제)
  IF coalesce(NEW.plan_type, '') IN ('monthly', 'event') THEN
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
