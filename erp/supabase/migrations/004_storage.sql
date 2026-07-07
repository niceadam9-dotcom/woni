-- ============================================================
-- 004_storage.sql
-- Supabase Storage bucket for inspection reports
-- ============================================================

-- 버킷 생성 (이미 존재하면 무시)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inspection-reports',
  'inspection-reports',
  false,
  20971520, -- 20MB
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'application/octet-stream'
  ]
) ON CONFLICT (id) DO NOTHING;

-- ── Storage RLS 정책 ──────────────────────────────────────

-- 인증된 사용자: 업로드 가능
CREATE POLICY "Authenticated users can upload inspection reports"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'inspection-reports');

-- 인증된 사용자: 조회 가능
CREATE POLICY "Authenticated users can view inspection reports"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'inspection-reports');

-- manager/admin: 삭제 가능
CREATE POLICY "Managers and admins can delete inspection reports"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'inspection-reports' AND
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('manager', 'admin')
  )
);
