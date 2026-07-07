-- ============================================================
-- 033_status_log_step5_6.sql
-- Victory10.md P-10: 점검현황모니터링 5~6단계 날짜 컬럼 추가
--
-- step5_completed_at: 5단계 소방보수 완료일
-- step6_completed_at: 6단계 이행완료보고서 제출일
-- ============================================================

ALTER TABLE inspection_status_log
  ADD COLUMN IF NOT EXISTS step5_completed_at DATE,
  ADD COLUMN IF NOT EXISTS step6_completed_at DATE;
