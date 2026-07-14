-- 087: 일반관리 점검은 업무 체크리스트 1단계(점검일)만 생성 (2026-07-14)
--
-- 원인: trg_create_inspection_steps가 점검유형과 무관하게 법정 소방점검 6단계
--       (배치확인서·관계인/소방서 보고서·소방보수·이행완료보고서)를 생성 —
--       일반관리 점검에는 해당 절차가 없어 부적합 (실증: 스테이징 지평1)
-- 설계: 일반관리 = 점검계획일 당일 1회성 event(자동 확정)와 일관되게 1단계만 생성.
--       완료 판정은 "존재하는 모든 단계 완료 시"(completeStepAction)라서
--       1단계 완료 = 점검 완료로 자연 연결. 마감일은 점검시작일 그대로(법정 기한 없음).
--       recalc_inspection_steps RPC는 2~6단계 행이 없으면 no-op이라 무영향.

-- 1. 생성 트리거 함수 갱신 (055와 동일, 일반관리 분기만 추가)
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
  -- 일반관리: 1단계(점검일)만 — 마감일 = 점검시작일 (영업일 보정 없음)
  IF NEW.inspection_type = '일반관리' THEN
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

-- 2. 기존 오생성 데이터 정리: 일반관리 점검의 2~6단계 삭제
DELETE FROM inspection_steps s
USING inspections i
WHERE s.inspection_id = i.id
  AND i.inspection_type = '일반관리'
  AND s.step_num > 1;

-- 3. 남은 1단계 마감일을 점검시작일로 보정 (기존 트리거는 다음 영업일로 계산했음)
UPDATE inspection_steps s
SET due_date = i.inspection_start_date, due_days = 0, is_working_days = FALSE
FROM inspections i
WHERE s.inspection_id = i.id
  AND i.inspection_type = '일반관리'
  AND s.step_num = 1;
