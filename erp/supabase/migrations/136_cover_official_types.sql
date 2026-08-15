-- 136: 결과보고서 표지(cover)·제출 공문(official) 타입 허용 (2026-08-14, 소방계획서_22 S5·S7)
--
-- 왜 지금 하는가: 번들 완전화(22)가 공문·표지를 신규 ANNEX 타입으로 추가한다.
--   ① fire_plan_gen_jobs.report_type — 생성 완료 기록이 이 두 타입으로도 쌓인다 (선례: 113_report4_job_type)
--   ② annex_inputs.annex_no — 공문의 ③계층(문서번호·수신·참조, Q-14 수동+자동 제안)이 여기 저장된다
--      (cover는 ③계층이 없어 annex_no 확장 불필요 — 표지는 전부 자동 조립)
-- 재실행 안전: DROP CONSTRAINT IF EXISTS → ADD 재생성 — 두 번 실행해도 같은 결과.

ALTER TABLE fire_plan_gen_jobs DROP CONSTRAINT IF EXISTS fire_plan_gen_jobs_report_type_check;
ALTER TABLE fire_plan_gen_jobs
  ADD CONSTRAINT fire_plan_gen_jobs_report_type_check
  CHECK (report_type IN ('fire_plan', 'report9', 'report10', 'report11', 'exterior', 'report4', 'cover', 'official'));

ALTER TABLE annex_inputs DROP CONSTRAINT IF EXISTS annex_inputs_annex_no_check;
ALTER TABLE annex_inputs
  ADD CONSTRAINT annex_inputs_annex_no_check
  CHECK (annex_no IN ('report9', 'report10', 'report11', 'exterior', 'official'));

COMMENT ON CONSTRAINT fire_plan_gen_jobs_report_type_check ON fire_plan_gen_jobs IS
  '서식 종류 — cover(표지)·official(공문)은 소방계획서_22 S5·S7 (2026-08-14)';

DO $$
DECLARE n INT;
BEGIN
  -- 검증: 제약이 새 타입을 실제로 허용하는지 — 위반 없이 통과해야 정상
  SELECT COUNT(*) INTO n FROM information_schema.check_constraints
   WHERE constraint_name = 'fire_plan_gen_jobs_report_type_check' AND check_clause LIKE '%official%';
  IF n = 0 THEN RAISE EXCEPTION '136 검증 실패 — report_type CHECK에 official 없음'; END IF;
  SELECT COUNT(*) INTO n FROM information_schema.check_constraints
   WHERE constraint_name = 'annex_inputs_annex_no_check' AND check_clause LIKE '%official%';
  IF n = 0 THEN RAISE EXCEPTION '136 검증 실패 — annex_no CHECK에 official 없음'; END IF;
  RAISE NOTICE '136 적용 완료 — cover/official 타입 허용';
END $$;
