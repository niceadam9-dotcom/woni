-- ============================================================
-- Storage Buckets — Supabase Storage 버킷 설정
-- ============================================================

-- 불량사진 버킷 (inspection-defects)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inspection-defects',
  'inspection-defects',
  false,
  5242880,   -- 5 MB
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- 버킷 RLS: 인증된 사용자만 읽기 허용
CREATE POLICY "defect_photos_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'inspection-defects'
    AND auth.uid() IS NOT NULL
  );

-- 버킷 RLS: manager/admin만 업로드·삭제
CREATE POLICY "defect_photos_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'inspection-defects'
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('employee','manager','admin')
    )
  );

CREATE POLICY "defect_photos_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'inspection-defects'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('manager','admin')
    )
  );
