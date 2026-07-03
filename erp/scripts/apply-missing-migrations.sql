-- ============================================================
-- 미적용 마이그레이션 통합 적용 SQL (자동 생성)
-- 생성일: 2026-07-03
-- Supabase 대시보드 → SQL Editor에 전체 붙여넣기 후 실행
-- 멱등 변환됨: 이미 존재하는 객체는 건너뜀 (재실행 안전)
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- ▼ 007_inspection_report_status.sql
-- ────────────────────────────────────────────────────────────
-- ============================================================
-- Inspection Report Status — 점검보고서 제출현황 모니터링
-- Victory4.md §10-8 기반
-- ============================================================

CREATE TABLE IF NOT EXISTS inspection_report_status (
  id                        UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_item_id              UUID    NOT NULL REFERENCES inspection_plan_items(id) ON DELETE CASCADE,
  inspection_completed_at   DATE,
  notification_date         DATE,
  notification_due_date     DATE    GENERATED ALWAYS AS (
                              CASE
                                WHEN inspection_completed_at IS NOT NULL
                                THEN inspection_completed_at + INTERVAL '7 days'
                                ELSE NULL
                              END
                            ) STORED,
  submission_deadline       DATE    GENERATED ALWAYS AS (
                              CASE
                                WHEN inspection_completed_at IS NOT NULL
                                THEN inspection_completed_at + INTERVAL '30 days'
                                ELSE NULL
                              END
                            ) STORED,
  sent_at                   DATE,
  received_at               DATE,
  returned_at               DATE,
  fire_station_submitted    BOOLEAN NOT NULL DEFAULT FALSE,
  fee_billed                BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by                UUID    REFERENCES profiles(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(plan_item_id)
);

CREATE INDEX IF NOT EXISTS idx_report_status_plan_item    ON inspection_report_status(plan_item_id);
CREATE INDEX IF NOT EXISTS idx_report_status_deadline     ON inspection_report_status(submission_deadline);
CREATE INDEX IF NOT EXISTS idx_report_status_notif_due    ON inspection_report_status(notification_due_date);
CREATE INDEX IF NOT EXISTS idx_report_status_submitted    ON inspection_report_status(fire_station_submitted);

DROP TRIGGER IF EXISTS trg_inspection_report_status_updated_at ON inspection_report_status;
CREATE TRIGGER trg_inspection_report_status_updated_at
  BEFORE UPDATE ON inspection_report_status
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE inspection_report_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "report_status_select_all" ON inspection_report_status;
CREATE POLICY "report_status_select_all"
  ON inspection_report_status FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "report_status_manage" ON inspection_report_status;
CREATE POLICY "report_status_manage"
  ON inspection_report_status FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );


-- ────────────────────────────────────────────────────────────
-- ▼ 008_action_plans.sql
-- ────────────────────────────────────────────────────────────
-- ============================================================
-- Action Plans — 이행계획/완료 제출현황 모니터링
-- Victory5.md §4 기반
-- ============================================================

-- 점검 불량내역
CREATE TABLE IF NOT EXISTS inspection_defects (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id  UUID         NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  defect_code    VARCHAR(20),
  defect_name    VARCHAR(200) NOT NULL,
  defect_detail  TEXT,
  photo_url      TEXT,
  severity       VARCHAR(10)  NOT NULL DEFAULT '보통' CHECK (severity IN ('경미', '보통', '중대')),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_defects_inspection ON inspection_defects(inspection_id);

ALTER TABLE inspection_defects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "defects_select_all" ON inspection_defects;
CREATE POLICY "defects_select_all"
  ON inspection_defects FOR SELECT  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "defects_manage" ON inspection_defects;
CREATE POLICY "defects_manage"
  ON inspection_defects FOR ALL     USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
);

-- 이행계획서
CREATE TABLE IF NOT EXISTS action_plans (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id           UUID        NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  plan_file_url           TEXT,
  completion_target_date  DATE,
  submitted_at            DATE,
  sent_at                 DATE,
  created_by              UUID        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(inspection_id)
);

CREATE INDEX IF NOT EXISTS idx_action_plans_inspection ON action_plans(inspection_id);
CREATE INDEX IF NOT EXISTS idx_action_plans_submitted  ON action_plans(submitted_at);

DROP TRIGGER IF EXISTS trg_action_plans_updated_at ON action_plans;
CREATE TRIGGER trg_action_plans_updated_at
  BEFORE UPDATE ON action_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE action_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "action_plans_select_all" ON action_plans;
CREATE POLICY "action_plans_select_all"
  ON action_plans FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "action_plans_manage" ON action_plans;
CREATE POLICY "action_plans_manage"
  ON action_plans FOR ALL   USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
);

-- 이행완료보고서
CREATE TABLE IF NOT EXISTS action_complete_reports (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  action_plan_id  UUID        NOT NULL REFERENCES action_plans(id) ON DELETE CASCADE,
  report_file_url TEXT,
  completed_at    DATE,
  submitted_at    DATE,
  created_by      UUID        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(action_plan_id)
);

CREATE INDEX IF NOT EXISTS idx_complete_reports_plan ON action_complete_reports(action_plan_id);

DROP TRIGGER IF EXISTS trg_action_complete_reports_updated_at ON action_complete_reports;
CREATE TRIGGER trg_action_complete_reports_updated_at
  BEFORE UPDATE ON action_complete_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE action_complete_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "complete_reports_select_all" ON action_complete_reports;
CREATE POLICY "complete_reports_select_all"
  ON action_complete_reports FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "complete_reports_manage" ON action_complete_reports;
CREATE POLICY "complete_reports_manage"
  ON action_complete_reports FOR ALL   USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
);

-- 이행계획 진행 상태 로그
CREATE TABLE IF NOT EXISTS action_plan_status (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  action_plan_id             UUID        NOT NULL REFERENCES action_plans(id) ON DELETE CASCADE,
  sent_at                    DATE,
  fire_station_submitted_at  DATE,
  defect_certificate_count   INT         NOT NULL DEFAULT 0,
  updated_by                 UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(action_plan_id)
);

CREATE INDEX IF NOT EXISTS idx_action_plan_status_plan ON action_plan_status(action_plan_id);

DROP TRIGGER IF EXISTS trg_action_plan_status_updated_at ON action_plan_status;
CREATE TRIGGER trg_action_plan_status_updated_at
  BEFORE UPDATE ON action_plan_status
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE action_plan_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "action_plan_status_select_all" ON action_plan_status;
CREATE POLICY "action_plan_status_select_all"
  ON action_plan_status FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "action_plan_status_manage" ON action_plan_status;
CREATE POLICY "action_plan_status_manage"
  ON action_plan_status FOR ALL   USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
);


-- ────────────────────────────────────────────────────────────
-- ▼ 009_billing.sql
-- ────────────────────────────────────────────────────────────
-- ============================================================
-- Billing — 정산현황 모니터링 (회계연동)
-- Victory6.md §10 기반
-- ============================================================

-- 청구서
CREATE TABLE IF NOT EXISTS bills (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id              UUID         NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  inspection_plan_item_id  UUID         REFERENCES inspection_plan_items(id) ON DELETE SET NULL,
  billing_month            VARCHAR(7)   NOT NULL,                          -- 'YYYY.MM'
  bill_type                VARCHAR(30)  NOT NULL DEFAULT '일괄점검',
  bill_date                DATE         NOT NULL,
  supply_value             NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_value                NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount             NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid_amount              NUMERIC(15,2) NOT NULL DEFAULT 0,
  paid_at                  DATE,
  payment_method           VARCHAR(20),
  notes                    TEXT,
  created_by               UUID         NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bills_customer    ON bills(customer_id);
CREATE INDEX IF NOT EXISTS idx_bills_month       ON bills(billing_month);
CREATE INDEX IF NOT EXISTS idx_bills_bill_date   ON bills(bill_date);
CREATE INDEX IF NOT EXISTS idx_bills_paid_at     ON bills(paid_at);

DROP TRIGGER IF EXISTS trg_bills_updated_at ON bills;
CREATE TRIGGER trg_bills_updated_at
  BEFORE UPDATE ON bills
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bills_select" ON bills;
CREATE POLICY "bills_select"
  ON bills FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "bills_manage" ON bills;
CREATE POLICY "bills_manage"
  ON bills FOR ALL    USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
);

-- 세금계산서
CREATE TABLE IF NOT EXISTS tax_invoices (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id         UUID         NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  issue_date      DATE,
  approval_num    VARCHAR(50),
  invoice_status  VARCHAR(20)  NOT NULL DEFAULT '전송대기'
                               CHECK (invoice_status IN ('발행완료','취소','전송대기')),
  issued          BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(bill_id)
);

CREATE INDEX IF NOT EXISTS idx_tax_invoices_bill ON tax_invoices(bill_id);

ALTER TABLE tax_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tax_invoices_select" ON tax_invoices;
CREATE POLICY "tax_invoices_select"
  ON tax_invoices FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "tax_invoices_manage" ON tax_invoices;
CREATE POLICY "tax_invoices_manage"
  ON tax_invoices FOR ALL   USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
);


-- ────────────────────────────────────────────────────────────
-- ▼ 010_storage_buckets.sql
-- ────────────────────────────────────────────────────────────
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
DROP POLICY IF EXISTS "defect_photos_read" ON storage.objects;
CREATE POLICY "defect_photos_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'inspection-defects'
    AND auth.uid() IS NOT NULL
  );

-- 버킷 RLS: manager/admin만 업로드·삭제
DROP POLICY IF EXISTS "defect_photos_insert" ON storage.objects;
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

DROP POLICY IF EXISTS "defect_photos_delete" ON storage.objects;
CREATE POLICY "defect_photos_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'inspection-defects'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('manager','admin')
    )
  );


-- ────────────────────────────────────────────────────────────
-- ▼ 011_my_page.sql
-- ────────────────────────────────────────────────────────────
-- ============================================================
-- schedules — 개인 일정
-- ============================================================
CREATE TABLE IF NOT EXISTS schedules (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title         TEXT        NOT NULL,
  description   TEXT,
  start_date    DATE        NOT NULL,
  end_date      DATE        NOT NULL,
  start_time    TIME,
  end_time      TIME,
  schedule_type VARCHAR(20) NOT NULL DEFAULT '개인'
                CHECK (schedule_type IN ('개인','업무','점검','유지보수','회의','기타')),
  all_day       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedules_employee ON schedules(employee_id);
CREATE INDEX IF NOT EXISTS idx_schedules_dates    ON schedules(start_date, end_date);

ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "schedules_own" ON schedules;
CREATE POLICY "schedules_own"
  ON schedules
  FOR ALL USING (employee_id = auth.uid());
DROP POLICY IF EXISTS "schedules_manager_read" ON schedules;
CREATE POLICY "schedules_manager_read"
  ON schedules
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin')
    )
  );

DROP TRIGGER IF EXISTS trg_schedules_updated_at ON schedules;
CREATE TRIGGER trg_schedules_updated_at
  BEFORE UPDATE ON schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- todos — ToDo 체크리스트
-- ============================================================
CREATE TABLE IF NOT EXISTS todos (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL,
  description  TEXT,
  due_date     DATE,
  priority     VARCHAR(10) NOT NULL DEFAULT '보통'
               CHECK (priority IN ('낮음','보통','높음')),
  completed    BOOLEAN     NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_todos_employee ON todos(employee_id);
CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);

ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "todos_own" ON todos;
CREATE POLICY "todos_own"
  ON todos
  FOR ALL USING (employee_id = auth.uid());

DROP TRIGGER IF EXISTS trg_todos_updated_at ON todos;
CREATE TRIGGER trg_todos_updated_at
  BEFORE UPDATE ON todos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ────────────────────────────────────────────────────────────
-- ▼ 012_messages.sql
-- ────────────────────────────────────────────────────────────
-- ============================================================
-- messages — 사내 쪽지
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id                UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_id             UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject                  TEXT        NOT NULL,
  body                     TEXT        NOT NULL,
  is_read                  BOOLEAN     NOT NULL DEFAULT FALSE,
  read_at                  TIMESTAMPTZ,
  is_deleted_by_sender     BOOLEAN     NOT NULL DEFAULT FALSE,
  is_deleted_by_recipient  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id, is_read);
CREATE INDEX IF NOT EXISTS idx_messages_sender    ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created   ON messages(created_at DESC);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_sender_read" ON messages;
CREATE POLICY "messages_sender_read"
  ON messages
  FOR SELECT USING (sender_id = auth.uid() AND is_deleted_by_sender = FALSE);

DROP POLICY IF EXISTS "messages_recipient_read" ON messages;
CREATE POLICY "messages_recipient_read"
  ON messages
  FOR SELECT USING (recipient_id = auth.uid() AND is_deleted_by_recipient = FALSE);

DROP POLICY IF EXISTS "messages_insert" ON messages;
CREATE POLICY "messages_insert"
  ON messages
  FOR INSERT WITH CHECK (sender_id = auth.uid());

DROP POLICY IF EXISTS "messages_update_recipient" ON messages;
CREATE POLICY "messages_update_recipient"
  ON messages
  FOR UPDATE USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS "messages_update_sender" ON messages;
CREATE POLICY "messages_update_sender"
  ON messages
  FOR UPDATE USING (sender_id = auth.uid());


-- ────────────────────────────────────────────────────────────
-- ▼ 013_sales.sql
-- ────────────────────────────────────────────────────────────
-- ============================================================
-- quotes — 견적서
-- ============================================================
CREATE TABLE IF NOT EXISTS quotes (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID        NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  quote_number   VARCHAR(30) NOT NULL,
  quote_date     DATE        NOT NULL,
  valid_until    DATE,
  items          JSONB       NOT NULL DEFAULT '[]',
  subtotal       NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  status         VARCHAR(10) NOT NULL DEFAULT '작성중'
                 CHECK (status IN ('작성중','발송','수주','취소','만료')),
  notes          TEXT,
  created_by     UUID        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_customer ON quotes(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status   ON quotes(status);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "quotes_auth" ON quotes;
CREATE POLICY "quotes_auth"
  ON quotes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_active = TRUE)
  );

DROP TRIGGER IF EXISTS trg_quotes_updated_at ON quotes;
CREATE TRIGGER trg_quotes_updated_at
  BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- orders — 수주
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id       UUID        REFERENCES quotes(id) ON DELETE SET NULL,
  customer_id    UUID        NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  order_number   VARCHAR(30) NOT NULL,
  order_date     DATE        NOT NULL,
  delivery_date  DATE,
  items          JSONB       NOT NULL DEFAULT '[]',
  total_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  status         VARCHAR(10) NOT NULL DEFAULT '수주'
                 CHECK (status IN ('수주','진행중','완료','취소')),
  notes          TEXT,
  created_by     UUID        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(status);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orders_auth" ON orders;
CREATE POLICY "orders_auth"
  ON orders
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_active = TRUE)
  );

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ────────────────────────────────────────────────────────────
-- ▼ 014_accounting.sql
-- ────────────────────────────────────────────────────────────
-- ============================================================
-- account_codes — 계정과목
-- ============================================================
CREATE TABLE IF NOT EXISTS account_codes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code         VARCHAR(10) NOT NULL UNIQUE,
  name         VARCHAR(50) NOT NULL,
  account_type VARCHAR(10) NOT NULL
               CHECK (account_type IN ('자산','부채','자본','수익','비용')),
  parent_code  VARCHAR(10),
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE account_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "account_codes_read" ON account_codes;
CREATE POLICY "account_codes_read"
  ON account_codes FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS "account_codes_write" ON account_codes;
CREATE POLICY "account_codes_write"
  ON account_codes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
  );

-- 기본 계정과목 (소방점검업 기준)
INSERT INTO account_codes (code, name, account_type) VALUES
  -- 자산
  ('101', '현금',           '자산'),
  ('102', '보통예금',       '자산'),
  ('103', '당좌예금',       '자산'),
  ('110', '외상매출금',     '자산'),
  ('115', '미수금',         '자산'),
  ('120', '선급금',         '자산'),
  ('130', '재고자산',       '자산'),
  ('201', '건물',           '자산'),
  ('202', '차량운반구',     '자산'),
  ('203', '공구와기구',     '자산'),
  ('210', '감가상각누계액', '자산'),
  -- 부채
  ('301', '외상매입금',     '부채'),
  ('302', '미지급금',       '부채'),
  ('303', '선수금',         '부채'),
  ('310', '예수금',         '부채'),
  ('315', '부가세예수금',   '부채'),
  ('320', '단기차입금',     '부채'),
  ('330', '장기차입금',     '부채'),
  -- 자본
  ('401', '자본금',         '자본'),
  ('402', '이익잉여금',     '자본'),
  -- 수익
  ('501', '매출액',         '수익'),
  ('502', '용역수입',       '수익'),
  ('503', '기타수입',       '수익'),
  -- 비용
  ('601', '급여',           '비용'),
  ('602', '복리후생비',     '비용'),
  ('603', '여비교통비',     '비용'),
  ('604', '차량유지비',     '비용'),
  ('605', '소모품비',       '비용'),
  ('606', '통신비',         '비용'),
  ('607', '임차료',         '비용'),
  ('608', '수도광열비',     '비용'),
  ('609', '보험료',         '비용'),
  ('610', '외주용역비',     '비용'),
  ('611', '광고선전비',     '비용'),
  ('612', '접대비',         '비용'),
  ('613', '수수료비용',     '비용'),
  ('614', '감가상각비',     '비용'),
  ('615', '세금과공과',     '비용'),
  ('616', '잡비',           '비용')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- vouchers — 전표
-- ============================================================
CREATE TABLE IF NOT EXISTS vouchers (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_number VARCHAR(30) NOT NULL UNIQUE,
  voucher_date   DATE        NOT NULL,
  voucher_type   VARCHAR(10) NOT NULL DEFAULT '대체'
                 CHECK (voucher_type IN ('입금','출금','대체')),
  description    TEXT        NOT NULL,
  total_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  status         VARCHAR(10) NOT NULL DEFAULT '작성중'
                 CHECK (status IN ('작성중','승인','취소')),
  created_by     UUID        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vouchers_date   ON vouchers(voucher_date);
CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status);

ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vouchers_auth" ON vouchers;
CREATE POLICY "vouchers_auth"
  ON vouchers
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_active = TRUE)
  );

DROP TRIGGER IF EXISTS trg_vouchers_updated_at ON vouchers;
CREATE TRIGGER trg_vouchers_updated_at
  BEFORE UPDATE ON vouchers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- voucher_lines — 전표 명세 (차변/대변)
-- ============================================================
CREATE TABLE IF NOT EXISTS voucher_lines (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id      UUID          NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  account_code_id UUID          NOT NULL REFERENCES account_codes(id),
  debit_amount    NUMERIC(15,2) NOT NULL DEFAULT 0,
  credit_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  description     TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voucher_lines_voucher ON voucher_lines(voucher_id);
CREATE INDEX IF NOT EXISTS idx_voucher_lines_account ON voucher_lines(account_code_id);

ALTER TABLE voucher_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "voucher_lines_auth" ON voucher_lines;
CREATE POLICY "voucher_lines_auth"
  ON voucher_lines
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_active = TRUE)
  );


-- ────────────────────────────────────────────────────────────
-- ▼ 015_payroll.sql
-- ────────────────────────────────────────────────────────────
-- 015_payroll.sql
-- 급여 관리: 급여대장 + 급여 항목

CREATE TABLE IF NOT EXISTS payrolls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  pay_year        INTEGER NOT NULL,               -- 지급 연도
  pay_month       INTEGER NOT NULL CHECK (pay_month BETWEEN 1 AND 12),
  base_salary     NUMERIC(15,2) NOT NULL DEFAULT 0,   -- 기본급
  overtime_pay    NUMERIC(15,2) NOT NULL DEFAULT 0,   -- 시간외수당
  bonus           NUMERIC(15,2) NOT NULL DEFAULT 0,   -- 상여금
  allowances      NUMERIC(15,2) NOT NULL DEFAULT 0,   -- 기타수당
  gross_pay       NUMERIC(15,2) GENERATED ALWAYS AS (base_salary + overtime_pay + bonus + allowances) STORED,
  -- 공제 항목
  income_tax      NUMERIC(15,2) NOT NULL DEFAULT 0,   -- 소득세
  local_income_tax NUMERIC(15,2) NOT NULL DEFAULT 0,  -- 지방소득세
  national_pension NUMERIC(15,2) NOT NULL DEFAULT 0,  -- 국민연금
  health_insurance NUMERIC(15,2) NOT NULL DEFAULT 0,  -- 건강보험
  employment_insurance NUMERIC(15,2) NOT NULL DEFAULT 0, -- 고용보험
  other_deductions NUMERIC(15,2) NOT NULL DEFAULT 0,  -- 기타공제
  total_deductions NUMERIC(15,2) GENERATED ALWAYS AS (
    income_tax + local_income_tax + national_pension +
    health_insurance + employment_insurance + other_deductions
  ) STORED,
  net_pay         NUMERIC(15,2) GENERATED ALWAYS AS (
    base_salary + overtime_pay + bonus + allowances -
    (income_tax + local_income_tax + national_pension +
     health_insurance + employment_insurance + other_deductions)
  ) STORED,
  pay_date        DATE,                            -- 지급일
  status          VARCHAR(10) NOT NULL DEFAULT '작성중' CHECK (status IN ('작성중','확정','지급완료')),
  notes           TEXT,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, pay_year, pay_month)
);

CREATE INDEX IF NOT EXISTS idx_payrolls_employee ON payrolls(employee_id);
CREATE INDEX IF NOT EXISTS idx_payrolls_year_month ON payrolls(pay_year, pay_month);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION update_payrolls_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_payrolls_updated_at ON payrolls;
CREATE TRIGGER trg_payrolls_updated_at
  BEFORE UPDATE ON payrolls
  FOR EACH ROW EXECUTE FUNCTION update_payrolls_updated_at();

-- RLS
ALTER TABLE payrolls ENABLE ROW LEVEL SECURITY;

-- manager/admin: 전체 조회·수정
CREATE POLICY payrolls_manager_select ON payrolls
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
  );

CREATE POLICY payrolls_manager_insert ON payrolls
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
  );

CREATE POLICY payrolls_manager_update ON payrolls
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
  );

CREATE POLICY payrolls_manager_delete ON payrolls
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
  );

-- employee: 본인 급여명세서 조회 전용
CREATE POLICY payrolls_employee_own ON payrolls
  FOR SELECT USING (
    employee_id = auth.uid()
  );


-- ────────────────────────────────────────────────────────────
-- ▼ 016_mobile_documents.sql
-- ────────────────────────────────────────────────────────────
-- ============================================================
-- Mobile Documents — 현장 서류 (MB-04 ~ MB-08)
-- ============================================================

CREATE TABLE IF NOT EXISTS mobile_documents (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  customer_id  UUID        REFERENCES customers(id) ON DELETE SET NULL,
  doc_type     VARCHAR(30) NOT NULL
               CHECK (doc_type IN ('fire_plan','work_record','self_inspection','training_record','fire_incident')),
  doc_date     DATE        NOT NULL,
  title        TEXT        NOT NULL,
  content      JSONB       NOT NULL DEFAULT '{}',
  status       VARCHAR(20) NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','submitted')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mobile_docs_employee  ON mobile_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_mobile_docs_customer  ON mobile_documents(customer_id);
CREATE INDEX IF NOT EXISTS idx_mobile_docs_type_date ON mobile_documents(doc_type, doc_date DESC);

DROP TRIGGER IF EXISTS trg_mobile_docs_updated_at ON mobile_documents;
CREATE TRIGGER trg_mobile_docs_updated_at
  BEFORE UPDATE ON mobile_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE mobile_documents ENABLE ROW LEVEL SECURITY;

-- 직원은 본인 서류 전체 관리
DROP POLICY IF EXISTS "mobile_docs_own" ON mobile_documents;
CREATE POLICY "mobile_docs_own"
  ON mobile_documents FOR ALL
  USING (employee_id = auth.uid());

-- manager/admin은 전체 조회
DROP POLICY IF EXISTS "mobile_docs_manager_read" ON mobile_documents;
CREATE POLICY "mobile_docs_manager_read"
  ON mobile_documents FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin')
  ));


-- ────────────────────────────────────────────────────────────
-- ▼ 023_stage_reports.sql
-- ────────────────────────────────────────────────────────────
-- 023_stage_reports.sql
-- 6단계별 보고서 타입 추가

ALTER TYPE report_type ADD VALUE IF NOT EXISTS 'step1';
ALTER TYPE report_type ADD VALUE IF NOT EXISTS 'step2';
ALTER TYPE report_type ADD VALUE IF NOT EXISTS 'step3';
ALTER TYPE report_type ADD VALUE IF NOT EXISTS 'step4';
ALTER TYPE report_type ADD VALUE IF NOT EXISTS 'step5';
ALTER TYPE report_type ADD VALUE IF NOT EXISTS 'step6';


-- ────────────────────────────────────────────────────────────
-- ▼ 026_employee_create_inspections.sql
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Employees create own inspections" ON inspections;
CREATE POLICY "Employees create own inspections"
  ON inspections FOR INSERT
  WITH CHECK (assigned_employee_id = auth.uid());
