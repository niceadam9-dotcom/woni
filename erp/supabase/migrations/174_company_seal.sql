-- 174: 회사 직인 이미지 (통합 실행계획 C5 마무리, 2026-10-03)
--
-- 배경: 공문(PDF 결과보고서 제출 공문·갑지 엑셀 「공문」 시트) 하단 명의가 「대표이사 OOO(직인생략)」 고정이었다
--   — 직인 이미지 기능이 없어서다(doc-templates/official.ts). 회사정보 화면에서 직인을 올리면 두 출력 모두
--   명의 끝에 직인을 겹쳐 찍고, 없으면 종전처럼 「(직인생략)」.
--
-- 보관(사용자 결정 2026-10-03): 직인은 위조 위험 자산이라 **비공개 버킷**이고 **정책을 하나도 두지 않는다** —
--   authenticated·anon 어느 쪽도 storage.objects로 읽거나 쓸 수 없고, 서버(service role)만 문서 생성 때
--   바이트로 내려받는다. 업로드·교체·삭제는 company_manage 권한 서버 액션만 한다(company/seal-actions.ts).
--   logo_url처럼 공개 URL을 저장하지 않고 **버킷 안 경로**만 저장한다.

ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS seal_path TEXT;

COMMENT ON COLUMN company_profile.seal_path IS
  '직인 이미지의 company-assets 버킷 내 경로(비공개) — 공문 하단 명의에 겹쳐 찍는다. NULL이면 (직인생략) (174, C5)';

-- 비공개·1MB 상한·PNG/JPEG만. 업로드 액션이 sharp로 투명 PNG(장변 600px)로 정규화해 넣는다
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('company-assets', 'company-assets', false, 1048576, ARRAY['image/png', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;
