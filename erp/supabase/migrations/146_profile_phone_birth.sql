-- 146: 직원 연락처·생년월일 (profiles.phone, profiles.birth_date)
--
-- 왜: 점검결과 보고서 제출용 위임장(별지 아님·사내 실무 서식)의 **대리인** 칸은
--     성명·직위·연락처·생년월일 4개인데, 시스템에 성명·직위(profiles.position)밖에 없어
--     연락처·생년월일은 점검 건마다 annex_inputs에 손으로 다시 넣어야 했다.
--     같은 직원이 매 회차 같은 값을 되풀이 입력하는 구조라 오타·누락이 쌓인다.
--     직원 정보에 한 번 넣어 두고 위임장이 읽어 가게 한다(2026-08-20 사용자 확정).
--
-- 표기 규약: phone 은 화면 입력에서 formatPhoneKR을 거쳐 '010-0000-0000' 꼴로 들어오지만,
--            읽는 쪽은 formatTel로 다시 정규화하므로 하이픈 유무에 의존하지 않는다(83b268c).
--            birth_date 는 DATE — 위임장 인쇄에서 'YYYY.MM.DD'로 변환한다.
--
-- 개인정보: 생년월일은 민감도가 있어 **위임장 인쇄 외 용도로 쓰지 않는다**.
--           목록·검색·SMS 등 다른 화면에 노출하지 말 것.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS birth_date DATE;

COMMENT ON COLUMN profiles.phone IS '직원 연락처 — 위임장 대리인 칸(표기 정규화는 읽는 쪽 formatTel)';
COMMENT ON COLUMN profiles.birth_date IS '직원 생년월일 — 위임장 대리인 칸 전용(민감정보, 타 화면 노출 금지)';
