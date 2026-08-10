-- 120: 소방계획서 개정이력 연도별 히스토리 (2026-08-10, 소방계획서_17.md §2)
-- 종전에는 개정 사유를 fire_plan_forms.sections.revision 단일 슬롯에 넣어 저장할 때마다 덮어썼다(K-1).
-- 이 테이블로 승격해 연도별(year)·행 단위(seq)로 이력을 남기고, 행마다 서술·작성자·검토·승인을 보존한다.
-- 접근은 서버 액션(service role)뿐 — RLS는 켜되 정책 없음(096·119 관례).

CREATE TABLE IF NOT EXISTS fire_plan_revisions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  year          INT NOT NULL,                 -- 연도별 그룹 축 = 계획서 연도(fire_plans.year 계열)
  seq           INT NOT NULL,                 -- 연도 내 순번
  revised_on    DATE,                         -- 개정일 (비우면 화면·인쇄에서 빈칸)
  content       TEXT NOT NULL DEFAULT '',     -- 주요 개정내용 — 행마다 보존 (K-1 해소)
  author_name   TEXT,                         -- 작성자 (K-4)
  reviewer_name TEXT,                         -- 검토 (Q-2: ERP 입력 + 빈칸 허용)
  approver_name TEXT,                         -- 승인
  source        TEXT NOT NULL DEFAULT 'manual'
                CHECK (source IN ('generated', 'uploaded', 'manual')),
  fire_plan_id  UUID REFERENCES fire_plans(id) ON DELETE SET NULL,  -- 생성·업로드 실적 연결
  created_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 연도 내 순번은 유일 — 서버가 max(seq)+1로 채번하고 경합 시 재시도한다
CREATE UNIQUE INDEX IF NOT EXISTS uq_fire_plan_revisions_seq
  ON fire_plan_revisions (customer_id, year, seq);
CREATE INDEX IF NOT EXISTS idx_fire_plan_revisions_cust
  ON fire_plan_revisions (customer_id, year DESC, seq);

ALTER TABLE fire_plan_revisions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE fire_plan_revisions IS '소방계획서 개정이력 (연도별 히스토리 — 소방계획서_17.md §2-1)';

-- ── 백필 ① 기존 보관함 행(fire_plans) → generated/uploaded 행 ───────────────────
-- content는 현행 화면·인쇄의 자동 문구 규칙을 그대로 옮긴다(note ?? '{year}년 소방계획서{ (개정N)}').
-- 규칙을 바꾸면 이미 제출된 문서와 다음 생성분의 문구가 어긋나므로 손대지 않는다.
-- fire_plan_id 기준 NOT EXISTS 가드 — 재실행해도 중복되지 않는다.
INSERT INTO fire_plan_revisions (customer_id, year, seq, revised_on, content, source, fire_plan_id, created_by, created_at)
SELECT
  p.customer_id,
  p.year,
  ROW_NUMBER() OVER (PARTITION BY p.customer_id, p.year ORDER BY p.created_at, p.id),
  p.created_at::date,
  COALESCE(
    NULLIF(p.note, ''),
    p.year || '년 소방계획서' || CASE WHEN p.revision > 1 THEN ' (개정' || p.revision || ')' ELSE ' 작성' END
  ),
  CASE WHEN COALESCE(p.pdf_path, '') LIKE '%generated_%' THEN 'generated' ELSE 'uploaded' END,
  p.id,
  p.uploaded_by,
  p.created_at
FROM fire_plans p
WHERE NOT EXISTS (
  SELECT 1 FROM fire_plan_revisions r WHERE r.fire_plan_id = p.id
);

-- ── 백필 ② sections.revision 단일 슬롯 → 아직 생성되지 않은 manual 행 ──────────
-- 이 값은 '다음 생성 시 마지막 행으로 찍힐 예정'이던 미발행 개정이라 manual로 옮긴다.
-- 연도는 작성일의 연도, 없으면 올해. 고객·연도당 manual 행이 이미 있으면 건너뛴다(재실행 안전).
WITH src AS (
  SELECT
    f.customer_id,
    NULLIF(f.sections -> 'revision' ->> 'revisionDate', '') AS rdate,
    NULLIF(f.sections -> 'revision' ->> 'revisionNote', '') AS rnote,
    f.updated_by
  FROM fire_plan_forms f
  WHERE f.sections ? 'revision'
    AND (
      NULLIF(f.sections -> 'revision' ->> 'revisionDate', '') IS NOT NULL
      OR NULLIF(f.sections -> 'revision' ->> 'revisionNote', '') IS NOT NULL
    )
), t AS (
  SELECT s.*, COALESCE(substring(s.rdate FROM 1 FOR 4)::int, EXTRACT(YEAR FROM now())::int) AS y
  FROM src s
)
INSERT INTO fire_plan_revisions (customer_id, year, seq, revised_on, content, source, created_by)
SELECT
  t.customer_id,
  t.y,
  COALESCE((SELECT MAX(r.seq) FROM fire_plan_revisions r WHERE r.customer_id = t.customer_id AND r.year = t.y), 0) + 1,
  t.rdate::date,
  COALESCE(t.rnote, ''),
  'manual',
  t.updated_by
FROM t
WHERE NOT EXISTS (
  SELECT 1 FROM fire_plan_revisions r
  WHERE r.customer_id = t.customer_id AND r.year = t.y AND r.source = 'manual'
);
