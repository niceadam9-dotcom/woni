-- 102: 외관점검표 생성 큐 확장 (2026-07-22, §9-8d — 소방시설등 외관점검표, 고시 2022-71 별지 6호)
-- 시트 데이터(EXT-01~14, v2022)는 scripts/seed-exterior-sheet.mjs로 시딩
ALTER TABLE fire_plan_gen_jobs DROP CONSTRAINT fire_plan_gen_jobs_report_type_check;
ALTER TABLE fire_plan_gen_jobs
  ADD CONSTRAINT fire_plan_gen_jobs_report_type_check
  CHECK (report_type IN ('fire_plan', 'report9', 'report10', 'report11', 'exterior'));
