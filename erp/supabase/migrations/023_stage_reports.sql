-- 023_stage_reports.sql
-- 6단계별 보고서 타입 추가

ALTER TYPE report_type ADD VALUE IF NOT EXISTS 'step1';
ALTER TYPE report_type ADD VALUE IF NOT EXISTS 'step2';
ALTER TYPE report_type ADD VALUE IF NOT EXISTS 'step3';
ALTER TYPE report_type ADD VALUE IF NOT EXISTS 'step4';
ALTER TYPE report_type ADD VALUE IF NOT EXISTS 'step5';
ALTER TYPE report_type ADD VALUE IF NOT EXISTS 'step6';
