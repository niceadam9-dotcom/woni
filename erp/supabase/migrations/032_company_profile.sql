-- ============================================================
-- 032_company_profile.sql
-- Victory10.md 회사 프로필 DB
--
-- company_profile 테이블:
--   업체명(승진소방ENG), 로고/마크 URL, 대표 정보,
--   기본 지역(경기도/양평군) 통합 관리
-- ============================================================

CREATE TABLE IF NOT EXISTS company_profile (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name         TEXT         NOT NULL,
  representative       TEXT,
  business_number      TEXT,
  phone                TEXT,
  email                TEXT,
  address              TEXT,
  logo_url             TEXT,
  mark_url             TEXT,
  default_region_si    TEXT         NOT NULL DEFAULT '경기도',
  default_region_myeon TEXT         NOT NULL DEFAULT '양평군',
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by           UUID         REFERENCES profiles(id) ON DELETE SET NULL
);

-- ── updated_at 자동갱신 트리거 ────────────────────────────────
DROP TRIGGER IF EXISTS trg_company_profile_updated_at ON company_profile;
CREATE TRIGGER trg_company_profile_updated_at
  BEFORE UPDATE ON company_profile
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 초기 데이터 (싱글톤 레코드) ─────────────────────────────
-- ON CONFLICT DO NOTHING 는 UUID PK에서 동작하지 않으므로
-- WHERE NOT EXISTS 방식으로 중복 방지
INSERT INTO company_profile (company_name, default_region_si, default_region_myeon)
SELECT '승진소방ENG', '경기도', '양평군'
WHERE NOT EXISTS (SELECT 1 FROM company_profile);

-- ── RLS: 관리자만 수정 가능, 전체 읽기 허용 ───────────────────
ALTER TABLE company_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_profile_read_all" ON company_profile;
CREATE POLICY "company_profile_read_all"
  ON company_profile FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "company_profile_write_admin" ON company_profile;
CREATE POLICY "company_profile_write_admin"
  ON company_profile FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Supabase Storage 버킷: company-assets (Supabase 대시보드에서 별도 생성 필요)
-- 경로: company-assets/logo/logo.png
--       company-assets/mark/mark.png
