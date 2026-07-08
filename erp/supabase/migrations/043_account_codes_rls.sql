-- 043_account_codes_rls.sql
-- KI-1 해소: account_codes(계정과목) anon 키 노출 차단 (2026-07-08)
-- 원인: 014의 SELECT 정책이 USING (TRUE)에 롤 지정 없음 → public(anon 포함)에 적용
-- 조치: 039(profiles·company_profile)와 동일하게 TO authenticated로 제한.
--       쓰기 정책(account_codes_write)은 이미 role 조건이 있어 anon 불가 — 유지.

DROP POLICY IF EXISTS "account_codes_read" ON account_codes;
CREATE POLICY "account_codes_read" ON account_codes
  FOR SELECT TO authenticated
  USING (TRUE);

NOTIFY pgrst, 'reload schema';
