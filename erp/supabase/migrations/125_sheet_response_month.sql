-- 125: 점검표 응답에 월 축 추가 (소방계획서_19 EX-4 — 외관점검표 연간 누적본, 2026-08-12 사용자 승인)
--
-- 배경: 외관점검표(별지 6호)는 12개월 × 12행짜리 **연간 서식**인데 ERP는 회차 단위로 생성해
--   해당 월 1칸만 채웠다. 같은 해 이전 달을 병합하려 해도 저장할 자리가 없었다:
--     · inspection_sheet_responses UNIQUE (inspection_id, item_code) — 점검 건당 항목 1개 응답
--     · inspections CHECK (sequence_num IN (1,2)) + UNIQUE (customer_id, year, sequence_num)
--       → 고객·연도당 점검 건이 최대 2건이라 월 12회를 회차로 쪼갤 수도 없다(2026-08-12 실측 확인)
--
-- 해결: 응답에 month를 두어 **연간 서식 1장에 12개월치**를 담는다(서식 의미와 일치).
--   month = 0 은 '월 무관'(일반 점검표 1-A-001 등 기존 전 응답) — 기본값이라 기존 경로는 무변경.
--   외관(X%) 응답만 1~12를 쓴다.
-- NULL 대신 0을 쓰는 이유: UNIQUE에서 NULL은 서로 다른 값으로 취급돼 중복이 뚫린다.

ALTER TABLE inspection_sheet_responses
  ADD COLUMN IF NOT EXISTS month SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE inspection_sheet_responses
  DROP CONSTRAINT IF EXISTS inspection_sheet_responses_month_check;
ALTER TABLE inspection_sheet_responses
  ADD CONSTRAINT inspection_sheet_responses_month_check CHECK (month BETWEEN 0 AND 12);

-- 기존 외관 응답 백필 — 그 점검 건의 시작월(문서가 지금까지 찍던 바로 그 달)
UPDATE inspection_sheet_responses r
SET month = EXTRACT(MONTH FROM i.inspection_start_date)::SMALLINT
FROM inspections i
WHERE r.inspection_id = i.id
  AND r.item_code LIKE 'X%'
  AND r.month = 0
  AND i.inspection_start_date IS NOT NULL;

-- 유니크 축 교체 — (건, 항목) → (건, 항목, 월)
ALTER TABLE inspection_sheet_responses
  DROP CONSTRAINT IF EXISTS inspection_sheet_responses_inspection_id_item_code_key;
ALTER TABLE inspection_sheet_responses
  DROP CONSTRAINT IF EXISTS uq_sheet_responses_insp_item_month;
ALTER TABLE inspection_sheet_responses
  ADD CONSTRAINT uq_sheet_responses_insp_item_month UNIQUE (inspection_id, item_code, month);

CREATE INDEX IF NOT EXISTS idx_sheet_responses_insp_month
  ON inspection_sheet_responses(inspection_id, month);
