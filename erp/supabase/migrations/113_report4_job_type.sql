-- 113: fire_plan_gen_jobs.report_type에 'report4'(소방시설등점검표 별지 4호) 추가
-- (2026-08-03, 소방계획서_7.md S3A H-21 — 별지 4호 HTML 템플릿·서버 동기 생성 전환)
-- 102와 동일 패턴 — CHECK 제약 재생성. 생성 자체는 서버 동기(HTML→Gotenberg PDF)이고
-- 잡 행은 완료 기록용이지만, CHECK에 없으면 insert가 실패하므로 허용값 확장이 필수.

ALTER TABLE fire_plan_gen_jobs DROP CONSTRAINT fire_plan_gen_jobs_report_type_check;

ALTER TABLE fire_plan_gen_jobs
  ADD CONSTRAINT fire_plan_gen_jobs_report_type_check
  CHECK (report_type IN ('fire_plan', 'report9', 'report10', 'report11', 'exterior', 'report4'));

COMMENT ON COLUMN fire_plan_gen_jobs.report_type IS
  '서식 종류 — fire_plan(소방계획서)/report4(별지 4호 소방시설등점검표)/report9(별지 9호)/report10(별지 10호)/report11(별지 11호)/exterior(외관점검표)';
