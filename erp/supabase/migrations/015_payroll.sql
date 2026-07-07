-- 015_payroll.sql
-- 급여 관리: 급여대장 + 급여 항목

CREATE TABLE payrolls (
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

CREATE INDEX idx_payrolls_employee ON payrolls(employee_id);
CREATE INDEX idx_payrolls_year_month ON payrolls(pay_year, pay_month);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION update_payrolls_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
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
