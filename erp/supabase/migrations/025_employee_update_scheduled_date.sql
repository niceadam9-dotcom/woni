-- 일반 직원도 점검 예정일(scheduled_date) 수정 가능하도록 UPDATE 정책 추가
CREATE POLICY "inspection_plan_items_employee_update_schedule"
  ON inspection_plan_items FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
