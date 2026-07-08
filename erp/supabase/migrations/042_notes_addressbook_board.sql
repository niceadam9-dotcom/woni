-- 042_notes_addressbook_board.sql
-- KI-2 잔여분: wave-3 테스트에서 추가 발견된 미배포 테이블 5개 (2026-07-08)
--   My Page: my_notes(노트), address_contacts(주소록)
--   게시판:  board_categories, board_posts, meeting_notes
-- 컬럼은 기존 코드(actions.ts insert·page.tsx select)에서 역추출.
-- 참고: 녹음메모·결재서명은 테이블 미사용(Storage/프로필 기반)으로 확인 — 대상 아님.

-- ── 노트 ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS my_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT 'white',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_my_notes_owner ON my_notes(owner_id);

-- ── 주소록 ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS address_contacts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  company    TEXT,
  department TEXT,
  position   TEXT,
  phone      TEXT,
  mobile     TEXT,
  email      TEXT,
  address    TEXT,
  notes      TEXT,
  group_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_address_contacts_owner ON address_contacts(owner_id);

-- ── 게시판 카테고리 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS board_categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  is_notice_board BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 게시글 (삭제는 is_deleted 소프트 삭제) ───────────────────
CREATE TABLE IF NOT EXISTS board_posts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES board_categories(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  is_notice   BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  view_count  INTEGER NOT NULL DEFAULT 0,
  author_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_board_posts_category ON board_posts(category_id, is_deleted, created_at);

-- ── 회의록 ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meeting_notes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  content      TEXT NOT NULL DEFAULT '',
  meeting_date DATE NOT NULL,
  participants TEXT,
  location     TEXT,
  author_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_meeting_notes_date ON meeting_notes(meeting_date);

-- ── 기본 카테고리 시드 (없을 때만) ───────────────────────────
INSERT INTO board_categories (name, description, is_notice_board)
SELECT v.name, v.description, v.is_notice
FROM (VALUES
  ('공지사항', '회사 공지', TRUE),
  ('자유게시판', '자유로운 소통 공간', FALSE),
  ('자료실', '업무 자료 공유', FALSE)
) AS v(name, description, is_notice)
WHERE NOT EXISTS (SELECT 1 FROM board_categories);

-- ── RLS (039 교훈: TO authenticated 필수) ────────────────────
ALTER TABLE my_notes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE address_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_posts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_notes    ENABLE ROW LEVEL SECURITY;

-- 개인 데이터: 본인만
CREATE POLICY "my_notes_own" ON my_notes FOR ALL TO authenticated
  USING (owner_id = auth.uid());
CREATE POLICY "address_contacts_own" ON address_contacts FOR ALL TO authenticated
  USING (owner_id = auth.uid());

-- 게시판: 전 직원 조회, 쓰기는 본인 글(또는 관리자)
CREATE POLICY "board_categories_select" ON board_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "board_categories_write"  ON board_categories FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "board_posts_select" ON board_posts FOR SELECT TO authenticated USING (true);
CREATE POLICY "board_posts_write"  ON board_posts FOR ALL TO authenticated
  USING (author_id = auth.uid()
         OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin')));

CREATE POLICY "meeting_notes_select" ON meeting_notes FOR SELECT TO authenticated USING (true);
CREATE POLICY "meeting_notes_write"  ON meeting_notes FOR ALL TO authenticated
  USING (author_id = auth.uid()
         OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin')));

-- PostgREST 스키마 캐시 갱신
NOTIFY pgrst, 'reload schema';
