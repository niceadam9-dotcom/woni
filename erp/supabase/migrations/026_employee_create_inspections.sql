-- ============================================================
-- 026_employee_create_inspections.sql
-- 모바일 앱에서 일반 직원이 본인 담당 점검을 시작(생성)할 수 있도록 허용
--
-- 배경: 기존 정책(002)은 manager/admin만 inspections INSERT 가능.
--       모바일 앱의 "점검 시작" 버튼은 로그인한 직원 본인을
--       assigned_employee_id로 지정해 점검을 생성하므로 RLS에 차단됨.
--       (plan_items UPDATE는 025에서 이미 전 직원 허용)
-- ============================================================

CREATE POLICY "Employees create own inspections"
  ON inspections FOR INSERT
  WITH CHECK (assigned_employee_id = auth.uid());
