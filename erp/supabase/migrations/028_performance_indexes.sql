-- 성능 개선: 주요 필터/정렬 컬럼 인덱스 추가

-- customers
CREATE INDEX IF NOT EXISTS idx_customers_created_at      ON customers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_is_active       ON customers(is_active);
CREATE INDEX IF NOT EXISTS idx_customers_region_si       ON customers(region_si)         WHERE region_si   IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_region_si_myeon ON customers(region_si, region_myeon) WHERE region_myeon IS NOT NULL;

-- buildings
CREATE INDEX IF NOT EXISTS idx_buildings_customer_id  ON buildings(customer_id);
CREATE INDEX IF NOT EXISTS idx_buildings_is_active    ON buildings(is_active);
CREATE INDEX IF NOT EXISTS idx_buildings_created_at   ON buildings(created_at DESC);

-- notifications: 기존 (recipient_id, is_read) 인덱스 외에 날짜 정렬용 추가
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_date ON notifications(recipient_id, created_at DESC);

-- inspection_plan_items: status 필터용 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_plan_items_status_active
  ON inspection_plan_items(plan_id, scheduled_date)
  WHERE status != 'cancelled';

-- inspection_plans: year+month 복합 인덱스
CREATE INDEX IF NOT EXISTS idx_inspection_plans_year_month ON inspection_plans(year, month);

-- inspections: 날짜 정렬 + 담당자 필터 복합
CREATE INDEX IF NOT EXISTS idx_inspections_employee_date
  ON inspections(assigned_employee_id, inspection_start_date DESC);
