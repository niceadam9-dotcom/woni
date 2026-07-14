-- 089: 정기(monthly) 계획항목 자동 확정 백필 (2026-07-14)
--
-- 설계: 정기는 기준일 규칙으로 날짜가 이미 결정되는 매월 루틴 방문 + 088로 법정 6단계도 없음 —
--       수동 확정 단계가 요식 행위라 생성 즉시 자동 확정으로 전환 (특별점검만 planned 유지).
--       코드 변경: 연간 생성기·전월 복사에서 monthly = confirmed/scheduled=planned,
--       기준일 변경·유형 전환은 미시작 confirmed monthly도 동기화, 확정보호 팝업에서 monthly 제외.
-- 이 파일: 기존 planned 정기 항목을 새 규칙으로 백필.

UPDATE inspection_plan_items
SET status = 'confirmed', scheduled_date = planned_date
WHERE plan_type = 'monthly'
  AND status = 'planned'
  AND planned_date IS NOT NULL
  AND inspection_id IS NULL;
