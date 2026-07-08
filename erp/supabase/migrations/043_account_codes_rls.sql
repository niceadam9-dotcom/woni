-- 043_account_codes_rls.sql (강화판 v2)
-- KI-1 해소: account_codes(계정과목) anon 키 노출 차단 (2026-07-08)
-- 원인: 014의 SELECT 정책이 USING (TRUE)에 롤 지정 없음 → public(anon 포함)에 적용.
-- v1(이름 지정 DROP)이 실DB 정책명 불일치 가능성으로 미적용 → 정책 전수 삭제 후 재구성.
-- 참고: 이 테이블은 화면에서 service role로만 조회하므로 앱 동작 영향 없음.

-- 기존 정책 전부 제거 (이름 불문)
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'account_codes'
  LOOP
    EXECUTE format('DROP POLICY %I ON account_codes', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE account_codes ENABLE ROW LEVEL SECURITY;

-- 조회: 로그인 사용자만
CREATE POLICY "account_codes_read" ON account_codes
  FOR SELECT TO authenticated
  USING (TRUE);

-- 쓰기: 매니저 이상 (014 원본 조건 유지 + TO authenticated)
CREATE POLICY "account_codes_write" ON account_codes
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
  );

-- 적용 확인용 (실행 결과에 정책 2개·roles={authenticated}만 보여야 정상)
SELECT policyname, roles, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'account_codes';
