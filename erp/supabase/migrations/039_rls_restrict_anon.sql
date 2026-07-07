-- 039_rls_restrict_anon.sql
-- 보안 점검(SEC-C) 대응: profiles·company_profile이 공개 anon 키로 조회되던 문제 수정
-- 원인: SELECT 정책에 롤 지정이 없어 public(anon 포함)에 적용됨
-- 조치: TO authenticated 로 제한 (로그인 사용자만). service role(앱 서버)은 RLS 우회하므로 영향 없음.

-- profiles: 활성 프로필 조회를 로그인 사용자로 제한 (직원 이메일/역할/입사일 anon 노출 차단)
DROP POLICY IF EXISTS "Users can view all active profiles" ON profiles;
CREATE POLICY "Users can view all active profiles"
  ON profiles FOR SELECT TO authenticated
  USING (is_active = TRUE);

-- company_profile: 조회를 로그인 사용자로 제한 (사업자번호/전화/주소 anon 노출 차단)
DROP POLICY IF EXISTS "company_profile_read_all" ON company_profile;
CREATE POLICY "company_profile_read_all"
  ON company_profile FOR SELECT TO authenticated
  USING (true);
