-- ============================================================
-- 승진소방 ERP: 마이그레이션 002 + 003 + 고객 시드 데이터
-- Supabase SQL Editor에 전체 붙여넣기 후 Run
-- ============================================================

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
-- 6단계, 각 단계 7일 균등 간격 (달력일 기준)
CREATE OR REPLACE FUNCTION create_inspection_steps()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO inspection_steps (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES (NEW.id, 1, '점검 완료',                             0,  FALSE, NEW.inspection_start_date);

  INSERT INTO inspection_steps (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES (NEW.id, 2, '배치확인서 보고서 작성',                 7,  FALSE, NEW.inspection_start_date + INTERVAL '7 days');

  INSERT INTO inspection_steps (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES (NEW.id, 3, '관계인 보고서 제출',                    14,  FALSE, NEW.inspection_start_date + INTERVAL '14 days');

  INSERT INTO inspection_steps (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES (NEW.id, 4, '소방서 보고서 제출 및 이행계획서 등록', 21,  FALSE, NEW.inspection_start_date + INTERVAL '21 days');

  INSERT INTO inspection_steps (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES (NEW.id, 5, '소방보수 완료',                         28,  FALSE, NEW.inspection_start_date + INTERVAL '28 days');

  INSERT INTO inspection_steps (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES (NEW.id, 6, '이행완료보고서 제출',                   35,  FALSE, NEW.inspection_start_date + INTERVAL '35 days');

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


-- ============================================================
-- Add assigned_employee_id to customers
-- 고객 담당직원 배정 기능
-- ============================================================

ALTER TABLE customers
  ADD COLUMN assigned_employee_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX idx_customers_assigned_employee
  ON customers(assigned_employee_id)
  WHERE assigned_employee_id IS NOT NULL;



-- ============================================================
-- SEED: customers 100건
-- admin UUID: d14acfb3-23a1-4ac7-b700-233b64eda2c6
-- ============================================================
INSERT INTO customers
  (id, customer_code, customer_name, contract_date,
   inspection_type, address, notes, is_active,
   created_by, created_at, updated_at)
VALUES
(gen_random_uuid(), 'C001', '강남 파크빌딩', '2021-03-15'::DATE, '종합'::inspection_type, '서울 강남구 테헤란로 152', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C002', '서초 럭키아파트', '2021-04-01'::DATE, '종합'::inspection_type, '서울 서초구 방배동 500', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C003', '마포 공덕오피스텔', '2021-05-20'::DATE, '종합'::inspection_type, '서울 마포구 공덕동 325', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C004', '종로 중앙빌딩', '2021-06-10'::DATE, '종합'::inspection_type, '서울 종로구 종로 200', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C005', '송파 헬리오시티', '2021-07-01'::DATE, '종합'::inspection_type, '서울 송파구 문정동 1', '대형 아파트 단지', true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C006', '강서 마곡테크빌딩', '2021-08-15'::DATE, '종합'::inspection_type, '서울 강서구 마곡동 800', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C007', '용산 아이파크몰', '2021-09-01'::DATE, '종합'::inspection_type, '서울 용산구 한강대로 23길 55', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C008', '은평 롯데캐슬', '2021-09-20'::DATE, '종합'::inspection_type, '서울 은평구 진관동 120', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C009', '광진 자양한양아파트', '2021-10-05'::DATE, '종합'::inspection_type, '서울 광진구 자양동 680', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C010', '노원 중계그린아파트', '2021-11-01'::DATE, '종합'::inspection_type, '서울 노원구 중계동 402', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C011', '성북 SK뷰아파트', '2021-11-20'::DATE, '종합'::inspection_type, '서울 성북구 정릉동 1200', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C012', '동대문 두산위브', '2021-12-01'::DATE, '종합'::inspection_type, '서울 동대문구 장안동 210', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C013', '중랑 망우중앙빌딩', '2021-12-15'::DATE, '종합'::inspection_type, '서울 중랑구 망우동 510', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C014', '강동 래미안힐스', '2022-01-10'::DATE, '종합'::inspection_type, '서울 강동구 암사동 300', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C015', '도봉 창동 센트럴', '2022-02-01'::DATE, '종합'::inspection_type, '서울 도봉구 창동 500', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C016', '수원 삼성디지털시티', '2022-02-20'::DATE, '종합'::inspection_type, '경기 수원시 영통구 삼성로 129', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C017', '성남 판교 알파돔', '2022-03-01'::DATE, '종합'::inspection_type, '경기 성남시 분당구 판교역로 166', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C018', '용인 기흥 동백센트레빌', '2022-03-15'::DATE, '종합'::inspection_type, '경기 용인시 기흥구 동백동 1012', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C019', '고양 일산 웨스턴돔', '2022-04-05'::DATE, '종합'::inspection_type, '경기 고양시 일산서구 킨텍스로 217', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C020', '부천 상동 한아름마트', '2022-04-20'::DATE, '종합'::inspection_type, '경기 부천시 원미구 상동 540', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C021', '안산 반월 물류창고', '2022-05-01'::DATE, '종합'::inspection_type, '경기 안산시 단원구 산단로 204', '지하 2층 포함', true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C022', '평택 삼성전자 협력사', '2022-05-20'::DATE, '종합'::inspection_type, '경기 평택시 고덕동 701', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C023', '화성 동탄 메타폴리스', '2022-06-01'::DATE, '종합'::inspection_type, '경기 화성시 동탄면 동탄대로 6', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C024', '남양주 다산 자이', '2022-06-15'::DATE, '종합'::inspection_type, '경기 남양주시 다산동 3500', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C025', '의정부 민락 센트럴', '2022-07-01'::DATE, '종합'::inspection_type, '경기 의정부시 민락동 850', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C026', '인천 송도 트리플스트리트', '2022-07-20'::DATE, '종합'::inspection_type, '인천 연수구 컨벤시아대로 109', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C027', '인천 청라 국제병원', '2022-08-01'::DATE, '종합'::inspection_type, '인천 서구 청라동 800', '병원 건물 전체', true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C028', '부산 해운대 엘시티', '2022-08-20'::DATE, '종합'::inspection_type, '부산 해운대구 중동 1411-4', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C029', '부산 서면 롯데백화점', '2022-09-01'::DATE, '종합'::inspection_type, '부산 부산진구 부전동 503-15', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C030', '부산 강서 물류단지', '2022-09-15'::DATE, '종합'::inspection_type, '부산 강서구 미음동 411', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C031', '대구 수성 범어센트레빌', '2022-10-01'::DATE, '종합'::inspection_type, '대구 수성구 범어동 1200', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C032', '대구 달서 이마트타운', '2022-10-20'::DATE, '종합'::inspection_type, '대구 달서구 월배동 901', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C033', '광주 상무 롯데시티호텔', '2022-11-01'::DATE, '종합'::inspection_type, '광주 서구 치평동 1189', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C034', '광주 봉선 현대아파트', '2022-11-20'::DATE, '종합'::inspection_type, '광주 남구 봉선동 600', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C035', '대전 둔산 센트럴파크', '2022-12-01'::DATE, '종합'::inspection_type, '대전 서구 둔산동 1400', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C036', '대전 유성 선비마을', '2022-12-20'::DATE, '종합'::inspection_type, '대전 유성구 노은동 550', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C037', '세종 새롬 스마트빌딩', '2023-01-10'::DATE, '종합'::inspection_type, '세종특별자치시 새롬동 2150', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C038', '울산 삼산 현대백화점', '2023-01-20'::DATE, '종합'::inspection_type, '울산 남구 삼산동 1655-2', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C039', '창원 용호 상남빌딩', '2023-02-01'::DATE, '종합'::inspection_type, '경남 창원시 성산구 상남동 350', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C040', '전주 에코시티 더샵', '2023-02-20'::DATE, '종합'::inspection_type, '전북 전주시 덕진구 팔복동 3가 1', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C041', '강남 삼성의료원', '2023-03-01'::DATE, '종합'::inspection_type, '서울 강남구 일원동 50', '대형병원 건물', true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C042', '여의도 국제금융센터', '2023-03-15'::DATE, '종합'::inspection_type, '서울 영등포구 여의도동 10', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C043', '강남 코엑스몰', '2023-04-01'::DATE, '종합'::inspection_type, '서울 강남구 삼성동 159', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C044', '홍대 현대카드뮤직라이브러리', '2023-04-20'::DATE, '종합'::inspection_type, '서울 마포구 어울마당로 65', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C045', '이태원 해밀턴호텔', '2023-05-01'::DATE, '종합'::inspection_type, '서울 용산구 이태원동 119-24', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C046', '잠실 롯데월드타워', '2023-05-20'::DATE, '종합'::inspection_type, '서울 송파구 올림픽로 300', '초고층 건물', true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C047', '수서 KTX 환승센터', '2023-06-01'::DATE, '종합'::inspection_type, '서울 강남구 수서동 724', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C048', '가산 G밸리 산업단지', '2023-06-15'::DATE, '종합'::inspection_type, '서울 금천구 가산동 60-30', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C049', '구로 신도림 디큐브시티', '2023-07-01'::DATE, '종합'::inspection_type, '서울 구로구 신도림동 337', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C050', '목동 현대41타워', '2023-07-20'::DATE, '종합'::inspection_type, '서울 양천구 목동 916', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C051', '관악 봉천 힐스테이트', '2023-08-01'::DATE, '종합'::inspection_type, '서울 관악구 봉천동 1700', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C052', '동작 흑석 한강센트레빌', '2023-08-20'::DATE, '종합'::inspection_type, '서울 동작구 흑석동 107-5', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C053', '영등포 타임스퀘어', '2023-09-01'::DATE, '종합'::inspection_type, '서울 영등포구 영중로 15', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C054', '하남 스타필드', '2023-09-20'::DATE, '종합'::inspection_type, '경기 하남시 미사대로 750', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C055', '수원 광교 아이파크', '2023-10-01'::DATE, '종합'::inspection_type, '경기 수원시 영통구 광교중앙로 248', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C056', '강남 논현 신축오피스', '2023-10-15'::DATE, '최초'::inspection_type, '서울 강남구 논현동 278', '2023년 준공', true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C057', '마포 합정 신축빌딩', '2023-11-01'::DATE, '최초'::inspection_type, '서울 마포구 합정동 413', '2023년 준공', true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C058', '송파 문정 법조단지', '2023-11-20'::DATE, '최초'::inspection_type, '서울 송파구 문정동 150-2', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C059', '성동 성수동 제조빌딩', '2023-12-01'::DATE, '최초'::inspection_type, '서울 성동구 성수동1가 660', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C060', '강북 수유 신축아파트', '2023-12-15'::DATE, '최초'::inspection_type, '서울 강북구 수유동 1130', '2023년 입주', true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C061', '인천 검단 신도시 상가', '2024-01-05'::DATE, '최초'::inspection_type, '인천 서구 원당동 1803', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C062', '파주 운정 힐스테이트', '2024-01-20'::DATE, '최초'::inspection_type, '경기 파주시 목동동 1601', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C063', '양주 옥정 현대아이파크', '2024-02-01'::DATE, '최초'::inspection_type, '경기 양주시 옥정동 830', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C064', '시흥 배곧 신도시 오피스텔', '2024-02-15'::DATE, '최초'::inspection_type, '경기 시흥시 배곧1로 50', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C065', '오산 세교 신축물류센터', '2024-03-01'::DATE, '최초'::inspection_type, '경기 오산시 세교동 520', '냉동창고 포함', true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C066', '광명 하안 자이더포레', '2024-03-15'::DATE, '최초'::inspection_type, '경기 광명시 하안동 340', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C067', '안양 평촌 신축오피스', '2024-04-01'::DATE, '최초'::inspection_type, '경기 안양시 동안구 귀인동 200', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C068', '군포 산본 힐즈파크', '2024-04-15'::DATE, '최초'::inspection_type, '경기 군포시 산본동 1152', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C069', '의왕 포일 센트럴타워', '2024-05-01'::DATE, '최초'::inspection_type, '경기 의왕시 포일동 680', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C070', '김포 한강 신도시 상업', '2024-05-15'::DATE, '최초'::inspection_type, '경기 김포시 구래동 4502', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C071', '부산 에코델타시티 호텔', '2024-05-20'::DATE, '최초'::inspection_type, '부산 강서구 명지동 3500', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C072', '대구 수성의료지구 병원', '2024-06-01'::DATE, '최초'::inspection_type, '대구 수성구 삼덕동 400', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C073', '광주 첨단 신산업단지', '2024-06-10'::DATE, '최초'::inspection_type, '광주 북구 오룡동 850', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C074', '세종 3생활권 상업시설', '2024-06-15'::DATE, '최초'::inspection_type, '세종특별자치시 보람동 4002', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C075', '청주 가경 아이파크몰', '2024-06-20'::DATE, '최초'::inspection_type, '충북 청주시 서원구 가경동 2400', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C076', '천안 불당 신축물류', '2024-07-01'::DATE, '최초'::inspection_type, '충남 천안시 서북구 불당동 1040', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C077', '아산 탕정 삼성 기숙사', '2024-07-10'::DATE, '최초'::inspection_type, '충남 아산시 탕정면 삼성로 181', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C078', '전주 혁신도시 신축빌딩', '2024-07-15'::DATE, '최초'::inspection_type, '전북 전주시 완산구 효자동3가 850', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C079', '여수 신항만 물류센터', '2024-07-20'::DATE, '최초'::inspection_type, '전남 여수시 경호동 550', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C080', '포항 영일만 산단 공장', '2024-08-01'::DATE, '최초'::inspection_type, '경북 포항시 북구 흥해읍 790', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C081', '구미 산단 전자공장', '2024-08-10'::DATE, '최초'::inspection_type, '경북 구미시 산동면 봉산리 1200', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C082', '진주 신진주역세권 오피스텔', '2024-08-15'::DATE, '최초'::inspection_type, '경남 진주시 충무공동 250', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C083', '제주 노형 드림타워', '2024-08-20'::DATE, '최초'::inspection_type, '제주 제주시 노형동 2700', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C084', '제주 중문 리조트빌딩', '2024-09-01'::DATE, '최초'::inspection_type, '제주 서귀포시 색달동 2900', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C085', '강릉 세인트존스 호텔', '2024-09-10'::DATE, '최초'::inspection_type, '강원 강릉시 창해로 307', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C086', '강남 논현 교회', '2022-03-01'::DATE, '기타'::inspection_type, '서울 강남구 논현동 10-5', '예배당 포함 지하 1층', true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C087', '서초 반포 성당', '2022-05-15'::DATE, '기타'::inspection_type, '서울 서초구 반포동 1-1', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C088', '마포 망원 중학교', '2022-07-01'::DATE, '기타'::inspection_type, '서울 마포구 망원동 400', '학교 본관 및 체육관', true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C089', '종로 사직 고등학교', '2022-09-01'::DATE, '기타'::inspection_type, '서울 종로구 사직동 130', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C090', '성동 금호 도서관', '2022-11-01'::DATE, '기타'::inspection_type, '서울 성동구 금호동2가 120', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C091', '양천 목동 체육관', '2023-01-15'::DATE, '기타'::inspection_type, '서울 양천구 목동 916-1', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C092', '수원 영통 하나원큰교회', '2023-03-01'::DATE, '기타'::inspection_type, '경기 수원시 영통구 영통동 1020', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C093', '고양 화정 종합사회복지관', '2023-05-20'::DATE, '기타'::inspection_type, '경기 고양시 덕양구 화정동 600', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C094', '인천 부평 공공청사', '2023-07-01'::DATE, '기타'::inspection_type, '인천 부평구 부평동 500', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C095', '부산 동래 사찰', '2023-09-01'::DATE, '기타'::inspection_type, '부산 동래구 온천동 480', '문화재 주변 건물', true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C096', '대구 칠성 시장 상가', '2023-11-01'::DATE, '기타'::inspection_type, '대구 북구 칠성동2가 50', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C097', '광주 동명 복지관', '2024-01-10'::DATE, '기타'::inspection_type, '광주 동구 동명동 120', NULL, true, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C098', '서울 중구 구청사(폐기)', '2021-01-01'::DATE, '기타'::inspection_type, '서울 중구 을지로1가 31', '계약 해지됨', false, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C099', '경기 광주 재건축 예정 빌딩', '2021-03-01'::DATE, '기타'::inspection_type, '경기 광주시 경안동 250', '재건축으로 계약 종료', false, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
(gen_random_uuid(), 'C100', '인천 남동 이전 공장', '2021-06-01'::DATE, '기타'::inspection_type, '인천 남동구 고잔동 710', '공장 이전으로 계약 종료', false, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW())
ON CONFLICT (customer_code) DO NOTHING;

SELECT COUNT(*) AS inserted_customers FROM customers;

