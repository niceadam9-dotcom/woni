-- 계약일을 선택 입력으로 변경 (2026-07-12): 고객등록 필수값은 점검계획일(plan_anchor_date)만
ALTER TABLE customers ALTER COLUMN contract_date DROP NOT NULL;
