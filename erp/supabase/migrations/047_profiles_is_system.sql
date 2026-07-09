-- 047: 시스템(개발·운영지원) 계정 구분 플래그 (2026-07-09)
--
-- 배경: dongwon.hwang@borealisgroup.com은 어드민 개발자 계정으로 실사용 직원이
--   아니므로 점검달력·담당자 선택·직원 통계 등 업무 화면에 노출되면 안 됨.
--   is_active=false는 로그인 자체가 차단되어(login/actions.ts) 사용 불가.
-- 조치: profiles.is_system 컬럼 추가. TRUE인 계정은 업무 화면 직원 목록에서
--   제외하되 로그인·admin 메뉴·직원 관리 화면·감사 로그에는 그대로 표시.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN profiles.is_system IS '시스템(개발·운영지원) 계정 — 업무 화면 직원 목록에서 제외';

-- 개발자 계정 지정
UPDATE profiles SET is_system = TRUE WHERE email = 'dongwon.hwang@borealisgroup.com';

-- 검증: 아래가 1행(dongwon.hwang)이어야 함
SELECT email, is_system FROM profiles WHERE is_system = TRUE;
