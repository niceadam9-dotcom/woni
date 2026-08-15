-- 138: 점검결과 보고서 제출용 위임장(delegation) 타입 허용 (2026-08-15, 소방계획서_22 S8)
--
-- 왜 지금 하는가: 위임장 필요가 확정됐다(2026-08-15 사용자). 서식 원천은 사내 실무 엑셀
--   '보고서 갑지.xls' [위임장] 탭 실측 — 법정 별지가 아니라 재량 서식(Q-7 샘플 근접 재현).
--   ① fire_plan_gen_jobs.report_type — 생성 완료 기록 (선례: 136 cover/official)
--   ② annex_inputs.annex_no — ③계층(관계인·대리인 생년월일 등 시스템 미보유 값) 저장
-- 재실행 안전: DROP CONSTRAINT IF EXISTS → ADD 재생성 — 두 번 실행해도 같은 결과.

ALTER TABLE fire_plan_gen_jobs DROP CONSTRAINT IF EXISTS fire_plan_gen_jobs_report_type_check;
ALTER TABLE fire_plan_gen_jobs
  ADD CONSTRAINT fire_plan_gen_jobs_report_type_check
  CHECK (report_type IN ('fire_plan', 'report9', 'report10', 'report11', 'exterior', 'report4', 'cover', 'official', 'delegation'));

ALTER TABLE annex_inputs DROP CONSTRAINT IF EXISTS annex_inputs_annex_no_check;
ALTER TABLE annex_inputs
  ADD CONSTRAINT annex_inputs_annex_no_check
  CHECK (annex_no IN ('report9', 'report10', 'report11', 'exterior', 'official', 'delegation'));

COMMENT ON CONSTRAINT fire_plan_gen_jobs_report_type_check ON fire_plan_gen_jobs IS
  '서식 종류 — delegation(위임장)은 소방계획서_22 S8 (2026-08-15), cover/official은 S5·S7';

DO $$
DECLARE n INT;
BEGIN
  -- 검증: 제약이 새 타입을 실제로 허용하는지 — 위반 없이 통과해야 정상
  SELECT COUNT(*) INTO n FROM information_schema.check_constraints
   WHERE constraint_name = 'fire_plan_gen_jobs_report_type_check' AND check_clause LIKE '%delegation%';
  IF n = 0 THEN RAISE EXCEPTION '138 검증 실패 — report_type CHECK에 delegation 없음'; END IF;
  SELECT COUNT(*) INTO n FROM information_schema.check_constraints
   WHERE constraint_name = 'annex_inputs_annex_no_check' AND check_clause LIKE '%delegation%';
  IF n = 0 THEN RAISE EXCEPTION '138 검증 실패 — annex_no CHECK에 delegation 없음'; END IF;
  RAISE NOTICE '138 적용 완료 — delegation 타입 허용';
END $$;
