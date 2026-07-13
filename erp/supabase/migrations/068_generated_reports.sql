-- 068: 보고서 생성 이력 (doc02 §1-6, P32-5)
CREATE TABLE IF NOT EXISTS generated_reports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id    UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  report_kind      TEXT NOT NULL,          -- '작동' / '종합' / '완료보고서'
  template_version TEXT NOT NULL,          -- '작동_v2025'
  file_name        TEXT NOT NULL,
  xlsx_path        TEXT NOT NULL,          -- Storage 경로
  facilities_snapshot JSONB,               -- 생성 시점 시설현황 스냅샷 (§4-2)
  generated_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  generated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_generated_reports_insp ON generated_reports(inspection_id, generated_at DESC);

ALTER TABLE generated_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY generated_reports_select ON generated_reports FOR SELECT TO authenticated USING (true);

-- 보고서 파일 버킷 (비공개)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('reports', 'reports', false, 20971520)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "reports_storage_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'reports' AND auth.uid() IS NOT NULL);
