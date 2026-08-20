-- 147: 공문 발신 명의 (2026-08-20 사용자 확정)
--
-- 왜 회사명을 그대로 쓰지 않는가: company_name('승진소방ENG')은 공문 상단 레터헤드·표지·위임장이
-- **함께** 읽는 값이다. 여기에 법인격('주식회사')을 붙이면 그 세 곳이 같이 바뀐다.
-- 공문 하단 발신 명의는 법인 정식 상호로 나가야 하므로 **공문 전용 칸**을 따로 둔다.
--
-- 둘 다 비워도 된다 — 비면 상호는 company_name, 직함은 '대표이사'로 폴백한다(렌더 쪽 규약).
-- 대표자 이름은 기존 company_profile.representative를 그대로 쓴다(칸을 늘리지 않는다).
ALTER TABLE company_profile
  ADD COLUMN IF NOT EXISTS official_sender_name TEXT,
  ADD COLUMN IF NOT EXISTS official_rep_title   TEXT;

COMMENT ON COLUMN company_profile.official_sender_name IS
  '공문 발신 명의 상호 — 법인 정식 상호(예: 주식회사 승진소방ENG). 비우면 company_name 사용. 레터헤드·표지·위임장은 이 값을 쓰지 않는다';
COMMENT ON COLUMN company_profile.official_rep_title IS
  '공문 발신 명의 대표 직함(예: 대표이사). 비우면 ''대표이사''';
