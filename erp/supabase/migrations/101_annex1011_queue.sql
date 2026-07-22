-- 101: 별지 10·11호 생성 큐 확장 (2026-07-23, R-3 — 소방계획서_4.md §9-7)
ALTER TABLE fire_plan_gen_jobs DROP CONSTRAINT fire_plan_gen_jobs_report_type_check;
ALTER TABLE fire_plan_gen_jobs
  ADD CONSTRAINT fire_plan_gen_jobs_report_type_check
  CHECK (report_type IN ('fire_plan', 'report9', 'report10', 'report11'));
