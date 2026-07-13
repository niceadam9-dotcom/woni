-- 056: 소방계획서 보관함 (2026-07-14, doc02 §8)
-- 표준양식으로 작성된 소방계획서를 고객별·연도별로 업로드 보관.
-- 인쇄용 PDF(필수) + 한글 원본 HWP(선택) 두 벌. 인쇄는 ERP에서 PDF 자동 인쇄.

CREATE TABLE IF NOT EXISTS fire_plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  year        INT  NOT NULL,
  title       TEXT,                     -- 예: '2025년 소방계획서' (미입력 시 자동 생성)
  pdf_name    TEXT NOT NULL,            -- 인쇄용 PDF (표준양식) — 필수
  pdf_path    TEXT NOT NULL,
  hwp_name    TEXT,                     -- 한글 원본 — 선택
  hwp_path    TEXT,
  note        TEXT,
  uploaded_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fire_plans_customer ON fire_plans(customer_id, year DESC, created_at DESC);

ALTER TABLE fire_plans ENABLE ROW LEVEL SECURITY;

-- 서버는 service role로 접근 — RLS는 anon 차단용 방어선 (039 패턴)
CREATE POLICY fire_plans_read ON fire_plans
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- 스토리지 버킷 (비공개, 30MB, 형식 제한 없음 — HWP mime가 브라우저마다 달라 서버 검증으로 대체)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('fire-plans', 'fire-plans', false, 31457280)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "fire_plans_storage_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'fire-plans' AND auth.uid() IS NOT NULL);
