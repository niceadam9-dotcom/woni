-- 166: 불량 → 매출 1단계 — 외래키 셋 + 견적 승인 상태 (비교진단 「불량 → 매출 해결방안」 절, 2026-10-02)
--
-- 새 표는 만들지 않는다. quotes·orders는 운영·스테이징 모두 0건(2026-10-02 실측)이라 백필이 없고,
-- 열을 더하고 상태값을 바꿔도 되돌릴 데이터가 없다.
--   quotes  → inspection_id(회차)·source·승인 기록·pdf_path. items JSONB 줄에는 defect_ids(배열, 선택)가 실린다.
--   orders  → inspection_id·계약서 경로·시공사(외주일 때)·완료일·부가세
--   bills   → order_id (수주 완료 → 청구 만들기)
-- ⑤⑥ 완료 조건·기한 사슬·inspection_defects 열은 건드리지 않는다.

-- ── quotes ───────────────────────────────────────────────────────────────────
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS inspection_id    UUID REFERENCES inspections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source           VARCHAR(10) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS approved_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by_name TEXT,
  ADD COLUMN IF NOT EXISTS approval_channel VARCHAR(10),
  ADD COLUMN IF NOT EXISTS pdf_path         TEXT;

ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_source_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_source_check
  CHECK (source IN ('manual', 'defect', 'asset'));

ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_approval_channel_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_approval_channel_check
  CHECK (approval_channel IS NULL OR approval_channel IN ('portal', 'email', 'phone', 'paper'));

-- 상태에 「승인」을 더한다: 작성중 → 발송 → 승인 → 수주 (취소·만료는 종전대로)
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_status_check
  CHECK (status IN ('작성중', '발송', '승인', '수주', '취소', '만료'));

CREATE INDEX IF NOT EXISTS idx_quotes_inspection ON quotes(inspection_id);

COMMENT ON COLUMN quotes.inspection_id    IS '불량 보수 견적이 속한 점검 회차(선택). 영업관리 수기 견적은 NULL.';
COMMENT ON COLUMN quotes.source           IS 'manual(수기) / defect(⑤ 칸 불량에서 생성) / asset(설비 대장 만료 예정에서 생성)';
COMMENT ON COLUMN quotes.approved_at      IS '관계인 승인 시각 — 전자서명이 아니라 열람·동의 기록';
COMMENT ON COLUMN quotes.approval_channel IS 'portal(링크 토큰 페이지) / email / phone / paper';
COMMENT ON COLUMN quotes.pdf_path         IS 'fire-plans 버킷 경로 {customer_id}/quotes/{quote_id}_{ts}.pdf';

-- ── orders ───────────────────────────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS inspection_id       UUID REFERENCES inspections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contract_file_path  TEXT,
  ADD COLUMN IF NOT EXISTS contractor_name     TEXT,
  ADD COLUMN IF NOT EXISTS contractor_biz_no   VARCHAR(12),
  ADD COLUMN IF NOT EXISTS contractor_rep      TEXT,
  ADD COLUMN IF NOT EXISTS contractor_phone    VARCHAR(20),
  ADD COLUMN IF NOT EXISTS contractor_address  TEXT,
  ADD COLUMN IF NOT EXISTS completed_at        DATE,
  ADD COLUMN IF NOT EXISTS tax_amount          NUMERIC(15,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_orders_inspection ON orders(inspection_id);

COMMENT ON COLUMN orders.contract_file_path IS '⑤ 칸에 올린 소방시설공사 계약서(fire-plans 버킷 경로) — 별지 11호 법정 첨부(시행규칙 23조)';
COMMENT ON COLUMN orders.contractor_name    IS '외주 시공사 상호. 비면 자사 시공 — 별지 11호 「소방공사업체」 칸은 이 값이 있으면 이것을, 없으면 company_profile을 인쇄';
COMMENT ON COLUMN orders.completed_at       IS '수주 상태가 「완료」로 바뀐 날 — 청구 만들기의 기준일';

-- ── bills ────────────────────────────────────────────────────────────────────
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bills_order ON bills(order_id);

COMMENT ON COLUMN bills.order_id IS '보수공사 수주에서 만든 건별 청구. 월정액 크론은 NULL 그대로.';
