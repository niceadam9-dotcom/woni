-- ============================================================
-- 019_update_inspection_steps_trigger.sql
-- Victory8.md: 7단계 → 6단계 전환, 기준일 use_approval_date로 변경
--
-- 변경 내용:
--   1. 기존 트리거/함수 제거
--   2. 기존 step_num=7 행 삭제
--   3. inspection_steps.step_num CHECK 제약 1~7 → 1~6
--   4. create_inspection_steps() 함수 재작성
--      - 기준일: customers.use_approval_date (NULL이면 inspection_start_date 폴백)
--      - 6단계 마감일 계산 (Victory7.md 규칙)
--   5. 트리거 재등록
-- ============================================================

-- 1. 기존 트리거 제거
DROP TRIGGER IF EXISTS trg_create_inspection_steps ON inspections;

-- 2. 기존 step_num=7 데이터 삭제 (7단계 폐지)
DELETE FROM inspection_steps WHERE step_num = 7;

-- 3. step_num CHECK 제약 변경 (1~7 → 1~6)
ALTER TABLE inspection_steps
  DROP CONSTRAINT IF EXISTS inspection_steps_step_num_check;

ALTER TABLE inspection_steps
  ADD CONSTRAINT inspection_steps_step_num_check
  CHECK (step_num BETWEEN 1 AND 6);

-- 4. 기존 step 6 행 이름 정리 (NULL due_date 보정 불필요 — 신규 점검부터 정상 적용)
UPDATE inspection_steps
SET name_ko = '6단계: 이행완료보고서 제출'
WHERE step_num = 6
  AND name_ko IN ('이해관계자 보고서 만들다', '이행완료 보고서 제출');

-- 5. 새로운 6단계 트리거 함수 작성
CREATE OR REPLACE FUNCTION create_inspection_steps()
RETURNS TRIGGER AS $$
DECLARE
  base_date DATE;
  step1_due DATE;
  step4_due DATE;
  step5_due DATE;
BEGIN
  -- use_approval_date를 customers 에서 가져옴
  SELECT use_approval_date
    INTO base_date
    FROM customers
   WHERE id = NEW.customer_id;

  -- use_approval_date 미입력 시 inspection_start_date 폴백
  IF base_date IS NULL THEN
    base_date := NEW.inspection_start_date;
  END IF;

  -- ── 1단계: 점검 완료 ──────────────────────────────────────
  -- 기산일(base_date) 다음 영업일 1일
  step1_due := add_working_days(base_date, 1);

  INSERT INTO inspection_steps
    (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES
    (NEW.id, 1, '1단계: 점검 완료', 1, TRUE, step1_due);

  -- ── 2단계: 배치확인서 보고서 작성 ────────────────────────
  -- step1_due 후 영업일 5일
  INSERT INTO inspection_steps
    (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES
    (NEW.id, 2, '2단계: 배치확인서 보고서 작성', 5, TRUE,
     add_working_days(step1_due, 5));

  -- ── 3단계: 관계인 보고서 제출 ────────────────────────────
  -- step1_due 후 영업일 10일
  INSERT INTO inspection_steps
    (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES
    (NEW.id, 3, '3단계: 관계인 보고서 제출', 10, TRUE,
     add_working_days(step1_due, 10));

  -- ── 4단계: 소방서 보고서 제출 및 이행계획서 등록 ─────────
  -- step1_due 후 영업일 15일
  step4_due := add_working_days(step1_due, 15);

  INSERT INTO inspection_steps
    (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES
    (NEW.id, 4, '4단계: 소방서 보고서 제출 및 이행계획서 등록', 15, TRUE, step4_due);

  -- ── 5단계: 소방보수 완료 ──────────────────────────────────
  -- step4_due 후 절대일 10일 (공휴일/주말 포함)
  step5_due := step4_due + INTERVAL '10 days';

  INSERT INTO inspection_steps
    (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES
    (NEW.id, 5, '5단계: 소방보수 완료', 10, FALSE, step5_due);

  -- ── 6단계: 이행완료보고서 제출 ───────────────────────────
  -- step5_due 후 영업일 10일
  INSERT INTO inspection_steps
    (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES
    (NEW.id, 6, '6단계: 이행완료보고서 제출', 10, TRUE,
     add_working_days(step5_due, 10));

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. 트리거 재등록
CREATE TRIGGER trg_create_inspection_steps
  AFTER INSERT ON inspections
  FOR EACH ROW EXECUTE FUNCTION create_inspection_steps();

-- ============================================================
-- 검증 쿼리 (실행 후 결과 확인용, 주석 처리)
-- ============================================================
-- 사용승인일 2026-06-30 기준 예시 결과:
--   1단계 due_date: 2026-07-01 (수)
--   2단계 due_date: 2026-07-08 (수)
--   3단계 due_date: 2026-07-15 (수)
--   4단계 due_date: 2026-07-23 (목)
--   5단계 due_date: 2026-08-02 (일)
--   6단계 due_date: 2026-08-14 (금)
