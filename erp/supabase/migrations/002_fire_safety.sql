-- ============================================================
-- Fire Safety Inspection Module — Schema
-- 소방 점검 업무 관리 모듈
-- ============================================================

-- ============================================================
-- ENUM Types
-- ============================================================
CREATE TYPE inspection_type   AS ENUM ('종합', '최초', '기타');
CREATE TYPE inspection_status AS ENUM ('scheduled', 'in_progress', 'completed', 'overdue');
CREATE TYPE step_status       AS ENUM ('pending', 'completed', 'overdue');
CREATE TYPE report_type       AS ENUM ('fire_station', 'stakeholder', 'completion');
CREATE TYPE contact_role      AS ENUM ('대표', '직원1', '직원2');

-- ============================================================
-- holidays (공휴일 — 작업일 계산용)
-- ============================================================
CREATE TABLE holidays (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  date        DATE        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  is_national BOOLEAN     NOT NULL DEFAULT TRUE,
  year        INT         GENERATED ALWAYS AS (EXTRACT(YEAR FROM date)::INT) STORED,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_holidays_date ON holidays(date);
CREATE INDEX idx_holidays_year ON holidays(year);

-- ============================================================
-- add_working_days: N 작업일 후 날짜 계산
-- 작업일 = 토·일·공휴일 제외
-- ============================================================
CREATE OR REPLACE FUNCTION add_working_days(start_date DATE, n INT)
RETURNS DATE AS $$
DECLARE
  result    DATE := start_date;
  days_added INT  := 0;
BEGIN
  WHILE days_added < n LOOP
    result := result + 1;
    IF EXTRACT(DOW FROM result) NOT IN (0, 6)
       AND NOT EXISTS (SELECT 1 FROM holidays WHERE date = result)
    THEN
      days_added := days_added + 1;
    END IF;
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- customers (고객)
-- ============================================================
CREATE TABLE customers (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_code   TEXT            NOT NULL UNIQUE,
  customer_name   TEXT            NOT NULL,
  contract_date   DATE            NOT NULL,
  inspection_type inspection_type NOT NULL,
  address         TEXT,
  notes           TEXT,
  is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
  created_by      UUID            NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customers_code   ON customers(customer_code);
CREATE INDEX idx_customers_type   ON customers(inspection_type);
CREATE INDEX idx_customers_active ON customers(is_active) WHERE is_active = TRUE;

CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- customer_contacts (관계인 — 고객당 최대 3명)
-- ============================================================
CREATE TABLE customer_contacts (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  role         contact_role NOT NULL,
  name         TEXT         NOT NULL,
  phone        TEXT,
  email        TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, role)
);

CREATE INDEX idx_customer_contacts_customer ON customer_contacts(customer_id);

CREATE TRIGGER trg_customer_contacts_updated_at
  BEFORE UPDATE ON customer_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- inspections (점검 업무)
-- ============================================================
CREATE TABLE inspections (
  id                    UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           UUID              NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  contact_id            UUID              REFERENCES customer_contacts(id) ON DELETE SET NULL,
  assigned_employee_id  UUID              NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  inspection_type       inspection_type   NOT NULL,
  inspection_start_date DATE              NOT NULL,
  notification_date     DATE,
  year                  INT               GENERATED ALWAYS AS (EXTRACT(YEAR FROM inspection_start_date)::INT) STORED,
  sequence_num          SMALLINT          NOT NULL DEFAULT 1
                        CHECK (sequence_num IN (1, 2)),
  status                inspection_status NOT NULL DEFAULT 'scheduled',
  notes                 TEXT,
  created_by            UUID              NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at            TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, year, sequence_num)
);

CREATE INDEX idx_inspections_customer    ON inspections(customer_id);
CREATE INDEX idx_inspections_employee    ON inspections(assigned_employee_id);
CREATE INDEX idx_inspections_year_status ON inspections(year, status);
CREATE INDEX idx_inspections_start_date  ON inspections(inspection_start_date);

-- sequence_num=2 는 종합 점검만 허용
CREATE OR REPLACE FUNCTION check_inspection_sequence()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sequence_num = 2 AND NEW.inspection_type <> '종합' THEN
    RAISE EXCEPTION 'sequence_num=2 는 종합 점검 유형에만 허용됩니다';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_inspection_sequence
  BEFORE INSERT OR UPDATE ON inspections
  FOR EACH ROW EXECUTE FUNCTION check_inspection_sequence();

CREATE TRIGGER trg_inspections_updated_at
  BEFORE UPDATE ON inspections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- inspection_steps (업무 단계 — 7개, 자동 생성)
-- ============================================================
CREATE TABLE inspection_steps (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id   UUID        NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  step_num        SMALLINT    NOT NULL CHECK (step_num BETWEEN 1 AND 7),
  name_ko         TEXT        NOT NULL,
  due_days        SMALLINT,
  is_working_days BOOLEAN,
  due_date        DATE,
  status          step_status NOT NULL DEFAULT 'pending',
  completed_at    TIMESTAMPTZ,
  completed_by    UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (inspection_id, step_num)
);

CREATE INDEX idx_inspection_steps_inspection ON inspection_steps(inspection_id);
CREATE INDEX idx_inspection_steps_due_date   ON inspection_steps(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX idx_inspection_steps_status     ON inspection_steps(status) WHERE status = 'pending';

-- 점검 생성 시 7단계 자동 생성
-- step 4 기준일 = step 3 due_date
-- step 5 = 달력 10일 (공휴일 포함)
CREATE OR REPLACE FUNCTION create_inspection_steps()
RETURNS TRIGGER AS $$
DECLARE
  step3_due DATE;
BEGIN
  INSERT INTO inspection_steps (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES (NEW.id, 1, '관계인 통보 1차', 3, TRUE,
          add_working_days(NEW.inspection_start_date, 3));

  INSERT INTO inspection_steps (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES (NEW.id, 2, '관계인 협의 2차 보강', 4, TRUE,
          add_working_days(NEW.inspection_start_date, 4));

  step3_due := add_working_days(NEW.inspection_start_date, 9);
  INSERT INTO inspection_steps (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES (NEW.id, 3, '보고서 작성', 9, TRUE, step3_due);

  INSERT INTO inspection_steps (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES (NEW.id, 4, '소방서 제출', 1, TRUE,
          add_working_days(step3_due, 1));

  INSERT INTO inspection_steps (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES (NEW.id, 5, '공사완료', 10, FALSE,
          NEW.inspection_start_date + INTERVAL '10 days');

  INSERT INTO inspection_steps (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES (NEW.id, 6, '이해관계자 보고서 만들다', NULL, NULL, NULL);

  INSERT INTO inspection_steps (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES (NEW.id, 7, '이행완료 보고서 제출', NULL, NULL, NULL);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_create_inspection_steps
  AFTER INSERT ON inspections
  FOR EACH ROW EXECUTE FUNCTION create_inspection_steps();

CREATE TRIGGER trg_inspection_steps_updated_at
  BEFORE UPDATE ON inspection_steps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- inspection_reports (보고서 — 점검당 유형별 1건)
-- ============================================================
CREATE TABLE inspection_reports (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id  UUID        NOT NULL REFERENCES inspections(id) ON DELETE RESTRICT,
  report_type    report_type NOT NULL,
  customer_code  TEXT        NOT NULL,
  customer_name  TEXT        NOT NULL,
  submitted_at   TIMESTAMPTZ,
  submitted_by   UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  file_name      TEXT,
  file_path      TEXT,
  file_size      INT,
  mime_type      TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (inspection_id, report_type)
);

CREATE INDEX idx_inspection_reports_inspection ON inspection_reports(inspection_id);
CREATE INDEX idx_inspection_reports_type       ON inspection_reports(report_type);
CREATE INDEX idx_inspection_reports_submitted  ON inspection_reports(submitted_at) WHERE submitted_at IS NOT NULL;

CREATE TRIGGER trg_inspection_reports_updated_at
  BEFORE UPDATE ON inspection_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- notifications: CHECK 제약 확장 (inspection 이벤트 추가)
-- ============================================================
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'approval_request', 'approved', 'rejected', 'recalled',
    'leave_request', 'leave_approved', 'leave_rejected',
    'inspection_assigned', 'inspection_step_due',
    'inspection_step_overdue', 'inspection_completed'
  ));

ALTER TABLE notifications DROP CONSTRAINT notifications_reference_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_reference_type_check
  CHECK (reference_type IN ('document', 'leave', 'inspection'));

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE holidays           ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_contacts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_steps   ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_reports ENABLE ROW LEVEL SECURITY;

-- holidays
CREATE POLICY "All employees view holidays"
  ON holidays FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins manage holidays"
  ON holidays FOR ALL
  USING (current_user_role() = 'admin');

-- customers
CREATE POLICY "All employees can view customers"
  ON customers FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Managers and admins manage customers"
  ON customers FOR ALL
  USING (current_user_role() IN ('manager', 'admin'));

-- customer_contacts
CREATE POLICY "All employees can view customer contacts"
  ON customer_contacts FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Managers and admins manage customer contacts"
  ON customer_contacts FOR ALL
  USING (current_user_role() IN ('manager', 'admin'));

-- inspections
CREATE POLICY "Employees see assigned inspections"
  ON inspections FOR SELECT
  USING (
    assigned_employee_id = auth.uid()
    OR current_user_role() IN ('manager', 'admin')
  );

CREATE POLICY "Employees update own inspection details"
  ON inspections FOR UPDATE
  USING (assigned_employee_id = auth.uid())
  WITH CHECK (assigned_employee_id = auth.uid());

CREATE POLICY "Managers and admins create inspections"
  ON inspections FOR INSERT
  WITH CHECK (current_user_role() IN ('manager', 'admin'));

CREATE POLICY "Managers and admins delete inspections"
  ON inspections FOR DELETE
  USING (current_user_role() IN ('manager', 'admin'));

-- inspection_steps
CREATE POLICY "View steps for accessible inspections"
  ON inspection_steps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM inspections
      WHERE id = inspection_steps.inspection_id
        AND (
          assigned_employee_id = auth.uid()
          OR current_user_role() IN ('manager', 'admin')
        )
    )
  );

CREATE POLICY "Employees complete steps on own inspections"
  ON inspection_steps FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM inspections
      WHERE id = inspection_steps.inspection_id
        AND assigned_employee_id = auth.uid()
    )
  );

CREATE POLICY "Service role inserts steps"
  ON inspection_steps FOR INSERT
  WITH CHECK (TRUE);

-- inspection_reports
CREATE POLICY "View reports for accessible inspections"
  ON inspection_reports FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM inspections
      WHERE id = inspection_reports.inspection_id
        AND (
          assigned_employee_id = auth.uid()
          OR current_user_role() IN ('manager', 'admin')
        )
    )
  );

CREATE POLICY "Employees manage reports on own inspections"
  ON inspection_reports FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM inspections
      WHERE id = inspection_reports.inspection_id
        AND assigned_employee_id = auth.uid()
    )
  );

CREATE POLICY "Employees update reports on own inspections"
  ON inspection_reports FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM inspections
      WHERE id = inspection_reports.inspection_id
        AND assigned_employee_id = auth.uid()
    )
  );

CREATE POLICY "Managers and admins manage all reports"
  ON inspection_reports FOR ALL
  USING (current_user_role() IN ('manager', 'admin'));
