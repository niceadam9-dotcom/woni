-- 044_fix_document_rls_recursion.sql
-- FIX-16 (critical): 전자결재 RLS 무한 재귀로 결재 기능 전면 마비 (2026-07-08 발견)
--
-- 증상: user 세션의 documents/document_approvers 조회가 전부 42P17
--       (infinite recursion detected in policy) → 문서함·결재함이 항상 빈 목록,
--       결재 상세 404, 회수 액션 항상 실패.
-- 원인: 001의 정책 순환 —
--       documents "Approvers can view..." 가 document_approvers를 참조하고,
--       document_approvers "View approvers..." 가 다시 documents를 참조.
-- 조치: documents 쪽 정책의 approvers 참조를 SECURITY DEFINER 함수로 교체해
--       순환 사슬을 절단. (definer 함수 내부 쿼리는 RLS를 타지 않음)
--       나머지 정책(approvers→documents 방향)은 사이클이 끊겨 안전 — 원문 유지.

-- 결재자 여부 검사 — RLS 우회(definer)로 재귀 없이 판정
CREATE OR REPLACE FUNCTION is_document_approver(doc_id uuid)
RETURNS boolean
SECURITY DEFINER
SET search_path = public
STABLE
LANGUAGE sql AS $$
  SELECT EXISTS (
    SELECT 1 FROM document_approvers
    WHERE document_id = doc_id AND approver_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION is_document_approver(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_document_approver(uuid) TO authenticated;

-- 재귀 유발 정책 교체
DROP POLICY IF EXISTS "Approvers can view documents assigned to them" ON documents;
CREATE POLICY "Approvers can view documents assigned to them"
  ON documents FOR SELECT TO authenticated
  USING (is_document_approver(id));

NOTIFY pgrst, 'reload schema';

-- 적용 확인용 — 아래 두 조회가 모두 에러 없이 실행되면 재귀 해소
SELECT count(*) AS documents_ok FROM documents;
SELECT count(*) AS approvers_ok FROM document_approvers;
