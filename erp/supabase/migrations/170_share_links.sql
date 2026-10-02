-- 170: 불량 → 매출 2단계 — 관계인 열람·승인 링크 (비교진단 「불량 → 매출 해결방안」 절, 2026-10-02)
--
-- 관계인 계정을 만들지 않는다. RLS가 「로그인만 하면 전부 조회」(USING(true) 30곳)라 외부 계정은 SaaS Stage 1 뒤다.
-- 대신 문서별 링크 토큰: 원문 토큰은 저장하지 않고 sha256 해시만. /p/{token} 라우트가 service role로만 읽는다.
-- 두 표 모두 RLS 활성·정책 없음(서버 전용 — 105 report_deliveries와 같은 패턴). company_id는 SaaS 규칙대로 처음부터(nullable).

CREATE TABLE IF NOT EXISTS share_links (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash     TEXT        NOT NULL UNIQUE,
  kind           TEXT        NOT NULL CHECK (kind IN ('quote', 'report9', 'report10', 'report11')),
  customer_id    UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  inspection_id  UUID        REFERENCES inspections(id) ON DELETE CASCADE,
  quote_id       UUID        REFERENCES quotes(id) ON DELETE CASCADE,
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  created_by     UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  company_id     UUID,
  CONSTRAINT share_links_quote_has_quote   CHECK (kind <> 'quote' OR quote_id IS NOT NULL),
  CONSTRAINT share_links_report_has_insp   CHECK (kind = 'quote' OR inspection_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_share_links_inspection ON share_links(inspection_id);
CREATE INDEX IF NOT EXISTS idx_share_links_quote      ON share_links(quote_id);
ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE  share_links IS '관계인 열람·승인 링크(문서별 토큰). 원문 토큰은 저장하지 않는다 — sha256(token) = token_hash';
COMMENT ON COLUMN share_links.expires_at IS '기본 생성 후 90일. 지나면 /p/{token}은 404';

CREATE TABLE IF NOT EXISTS share_link_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id     UUID        NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
  event       TEXT        NOT NULL CHECK (event IN ('viewed', 'downloaded', 'approved')),
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip          TEXT,
  ua          TEXT,
  actor_name  TEXT
);
CREATE INDEX IF NOT EXISTS idx_share_link_events_link ON share_link_events(link_id, at DESC);
ALTER TABLE share_link_events ENABLE ROW LEVEL SECURITY;

-- 관계인이 링크에서 견적을 승인하면 담당자에게 알림 — 158 목록 + quote_approved
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[
  'approval_request'::text,
  'approved'::text,
  'rejected'::text,
  'recalled'::text,
  'leave_request'::text,
  'leave_approved'::text,
  'leave_rejected'::text,
  'inspection_assigned'::text,
  'inspection_step_due'::text,
  'inspection_step_overdue'::text,
  'inspection_completed'::text,
  'insurance_expiry_due'::text,
  'insurance_expiry_overdue'::text,
  'defect_action_due'::text,
  'defect_action_overdue'::text,
  'report_submit_due'::text,
  'report_submit_overdue'::text,
  'weekly_doc_briefing'::text,
  'law_revision'::text,
  'manager_edu_due'::text,
  'manager_edu_overdue'::text,
  'quote_approved'::text
]));
