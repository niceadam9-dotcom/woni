-- 171: 불량 → 매출 3단계 — 링크 종류 둘(회차 문서 묶음·청구 이력) + 관계인 손글씨 서명 (2026-10-02)
--
--   share_links.kind += 'round'(한 회차의 별지 9·10·11호 최신 PDF 묶음) · 'billing'(고객의 청구·세금계산서 이력)
--     round는 inspection_id 필요, billing은 customer_id만(회차와 무관).
--   quotes.approval_signature_path — 링크 승인 때 관계인이 그린 서명 PNG(fire-plans/{customer}/signatures/…).
--     전자서명법상 전자서명이 아니라 「동의 확인」의 시각 증빙이다. 견적 PDF 승인란에 찍힌다.
-- 비파괴·멱등. 기존 행은 전부 quote/report9/10/11이라 새 CHECK를 그대로 만족한다.

ALTER TABLE share_links DROP CONSTRAINT IF EXISTS share_links_kind_check;
ALTER TABLE share_links ADD CONSTRAINT share_links_kind_check
  CHECK (kind IN ('quote', 'report9', 'report10', 'report11', 'round', 'billing'));

ALTER TABLE share_links DROP CONSTRAINT IF EXISTS share_links_report_has_insp;
ALTER TABLE share_links ADD CONSTRAINT share_links_report_has_insp
  CHECK (kind IN ('quote', 'billing') OR inspection_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_share_links_customer ON share_links(customer_id);

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS approval_signature_path TEXT;
COMMENT ON COLUMN quotes.approval_signature_path IS '링크 승인 때 관계인이 그린 서명 PNG 경로(fire-plans 버킷). 동의 확인의 시각 증빙 — 전자서명 아님';
