-- 051: 알림 수신 설정 (제안.md 2단계)
-- 카테고리별 수신 토글: approval_result / leave_result / assignment / deadline
-- 미설정 키는 켜짐(수신)으로 간주 — false로 명시된 카테고리만 발송 생략.
-- 결재 요청·휴가 신청 도착 알림은 업무 필수라 설정 대상이 아님.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN profiles.notification_prefs IS
  '알림 수신 설정 — {approval_result, leave_result, assignment, deadline}: false면 해당 카테고리 인앱 알림 발송 생략 (미설정=수신)';
