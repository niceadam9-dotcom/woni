-- 108: 보고서 페이지 서식 버전·'새 개정판' 뱃지 (2026-07-25, 소방계획서_4.md §10-R3)
-- seed_date = 현재 템플릿에 심어진(재심기 완료된) 서식의 공포/발령일자.
-- 크론(law-revision-check)이 announce_date만 갱신하므로 announce_date > seed_date = 재심기 필요(새 개정판).
ALTER TABLE law_form_baselines ADD COLUMN IF NOT EXISTS seed_date TEXT;
UPDATE law_form_baselines SET seed_date = announce_date WHERE seed_date IS NULL;
