-- 045: profiles 자동 생성 트리거 복구 + 누락 프로필 백필
--
-- 문제: 001에서 정의한 on_auth_user_created 트리거가 라이브 DB에 없음
--   (실증: auth.users에 계정을 만들어도 profiles 행이 생성되지 않음 — 2026-07-08 확인)
--   → 관리자 > 직원 추가 시 auth 계정만 생기고 목록(profiles)에 안 보이는 버그의 원인.
--   앱 코드는 upsert로 수정해 트리거 없이도 동작하지만, 방어선으로 트리거도 복구한다.

-- 1) 함수 재생성 (001과 동일 + 이름 공백 정리)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, employee_id, name, email)
  VALUES (
    NEW.id,
    'EMP-' || UPPER(SUBSTR(NEW.id::TEXT, 1, 8)),
    TRIM(COALESCE(NEW.raw_user_meta_data->>'name', SPLIT_PART(NEW.email, '@', 1))),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2) 트리거 재생성
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 3) 백필 — profiles가 없는 기존 auth 계정 보정
INSERT INTO public.profiles (id, employee_id, name, email)
SELECT
  u.id,
  'EMP-' || UPPER(SUBSTR(u.id::TEXT, 1, 8)),
  TRIM(COALESCE(u.raw_user_meta_data->>'name', SPLIT_PART(u.email, '@', 1))),
  u.email
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

-- 4) 검증 — 아래 두 쿼리 결과가 모두 조건을 만족해야 함
-- (a) 트리거 존재 확인 → 1행
SELECT tgname FROM pg_trigger WHERE tgname = 'on_auth_user_created';
-- (b) profiles 누락 auth 계정 → 0행
SELECT u.id, u.email FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;
