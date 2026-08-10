-- ============================================================
-- 121_step2_legal_anchor.sql
-- 소방계획서_14 #14 후속 — ②단계(점검인력 배치신고) 기한을 법정 기산점으로 정정
--
-- 법정 근거 (한국소방시설관리협회 배치신고 안내 · 관리업종합정보시스템 공지 1079,
--   2022-12-01 개정): "점검이 끝난 날부터 5일 이내"이며 협회 계산법은
--   "종료일 당일 및 기간 내 모든 토요일·공휴일 산입 제외" —
--   즉 종료일 다음 영업일부터 5영업일 = add_working_days(종료일, 5).
--   따라서 종전의 '5영업일'이라는 일수 자체는 옳았고, 틀린 것은 기산점이다.
--
-- 종전: add_working_days(step1_due, 5)
--   step1_due = add_working_days(base_date, 1)이고 base_date는 사용승인일 응당일(있으면)이라
--   ① 통상 고객: 법정보다 1영업일 늦다 (예: 종료 9/15(화) → 법정 9/22, 종전 9/23)
--   ② 사용승인일 고객: 점검일과 무관한 날짜가 나온다 (기준일 자체가 다름)
-- 변경: add_working_days(COALESCE(inspection_end_date, inspection_start_date), 5)
--   079가 "6단계 기산점의 기준"으로 예고해 두고 미적용이던 종료일 기산을 ②단계에 한해 적용한다.
--   ①③④⑤⑥은 이번 범위가 아니라 무변경 — ④(별지 9호 15일)도 같은 기산점 문제가 있으나
--   별도 결정 대기 항목이다.
--
-- 기존 행은 변경하지 않는다 (트리거는 INSERT 시에만 동작). 이미 생성된 점검의 ②단계 마감일
-- 소급 보정이 필요하면 별도 백필로 진행한다.
-- ============================================================

CREATE OR REPLACE FUNCTION create_inspection_steps()
RETURNS TRIGGER AS $$
DECLARE
  approval  DATE;
  base_date DATE;
  insp_year INT;
  step1_due DATE;
  step2_due DATE;
  step4_due DATE;
  step5_due DATE;
BEGIN
  -- 정기(monthly)·레거시 일반 이벤트(event): 1단계(점검일)만 — 법정 보고 절차 없음.
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
  -- ②단계만 법정 기산점(점검 종료일, 없으면 시작일)을 쓴다 — 위 주석 참조
  step2_due := add_working_days(coalesce(NEW.inspection_end_date, NEW.inspection_start_date), 5);
  step4_due := add_working_days(step1_due, 15);
  step5_due := step4_due + INTERVAL '9 days'; -- 당일 포함 10일째

  INSERT INTO inspection_steps (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES
    (NEW.id, 1, '1단계: 점검일',                            1,  TRUE,  step1_due),
    (NEW.id, 2, '2단계: 배치확인서 보고서 작성',              5,  TRUE,  step2_due),
    (NEW.id, 3, '3단계: 관계인 보고서 제출',                 10, TRUE,  add_working_days(step1_due, 10)),
    (NEW.id, 4, '4단계: 소방서 보고서 제출 및 이행계획서 등록', 15, TRUE,  step4_due),
    (NEW.id, 5, '5단계: 소방보수 완료',                     10, FALSE, step5_due),
    (NEW.id, 6, '6단계: 이행완료보고서 제출',                10, TRUE,  add_working_days(step5_due, 10));

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
