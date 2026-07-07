-- ============================================================
-- Add assigned_employee_id to customers
-- 고객 담당직원 배정 기능
-- ============================================================

ALTER TABLE customers
  ADD COLUMN assigned_employee_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX idx_customers_assigned_employee
  ON customers(assigned_employee_id)
  WHERE assigned_employee_id IS NOT NULL;
