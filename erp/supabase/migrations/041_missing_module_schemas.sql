-- 041_missing_module_schemas.sql
-- KI-2 해소: 화면·서버 코드는 존재하나 테이블이 미배포였던 5개 모듈 스키마 (2026-07-08)
--   구매/재고: item_categories, inventory_items, stock_movements, purchase_orders(+lines)
--   영업:      partners
--   업무관리:  work_tasks, work_journals, vehicles, vehicle_logs
-- 컬럼은 기존 코드(actions.ts/page.tsx의 insert·select·embed)에서 역추출 — 코드 무수정 원칙.
-- 예외: purchase-orders의 partners.company_name 참조는 partner_name으로 코드 측 수정(불일치 2건).

-- ── 품목 분류 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS item_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 품목 ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code      TEXT NOT NULL UNIQUE,
  item_name      TEXT NOT NULL,
  category_id    UUID REFERENCES item_categories(id) ON DELETE SET NULL,
  unit           TEXT,
  standard_price NUMERIC(15,2),
  description    TEXT,
  current_stock  NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category_id);

-- ── 재고 이동 (입고/출고/조정) ───────────────────────────────
CREATE TABLE IF NOT EXISTS stock_movements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id        UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT, -- 이력 있는 품목 삭제 차단 (EX-R2)
  movement_type  VARCHAR(10) NOT NULL CHECK (movement_type IN ('in','out','adjust')),
  quantity       NUMERIC(15,2) NOT NULL,
  unit_price     NUMERIC(15,2),
  before_stock   NUMERIC(15,2),
  after_stock    NUMERIC(15,2),
  reference_type TEXT,
  reference_id   UUID,
  notes          TEXT,
  created_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(item_id, created_at);

-- ── 거래처 ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partners (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_name    TEXT NOT NULL,
  partner_type    VARCHAR(20) NOT NULL DEFAULT 'supplier'
                  CHECK (partner_type IN ('supplier','subcontractor','client','other')),
  business_number TEXT,
  representative  TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 발주 ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id    UUID REFERENCES partners(id) ON DELETE RESTRICT, -- 발주 이력 있는 거래처 삭제 차단 (EX-R1)
  order_date    DATE NOT NULL,
  expected_date DATE,
  notes         TEXT,
  status        VARCHAR(10) NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','ordered','received','cancelled')),
  total_amount  NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_partner ON purchase_orders(partner_id);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id             UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id           UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity          NUMERIC(15,2) NOT NULL,
  unit_price        NUMERIC(15,2) NOT NULL DEFAULT 0,
  subtotal          NUMERIC(15,2) NOT NULL DEFAULT 0,
  received_quantity NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_lines_po ON purchase_order_lines(po_id);

-- ── 차량 ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_number    TEXT NOT NULL UNIQUE,
  vehicle_name      TEXT NOT NULL,
  vehicle_type      TEXT,
  maker             TEXT,
  model_year        INTEGER,
  color             TEXT,
  fuel_type         TEXT,
  insurance_expiry  DATE,
  inspection_expiry DATE,
  notes             TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicle_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id         UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  driver_id          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  log_date           DATE NOT NULL,
  departure_time     TIME,
  arrival_time       TIME,
  departure_location TEXT,
  destination        TEXT,
  purpose            TEXT,
  start_mileage      NUMERIC(12,1),
  end_mileage        NUMERIC(12,1),
  distance           NUMERIC(12,1),
  fuel_cost          NUMERIC(12,0),
  toll_cost          NUMERIC(12,0),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_logs_vehicle ON vehicle_logs(vehicle_id, log_date);

-- ── 업무지시 / 업무일지 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT,
  assignee_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  due_date    DATE,
  priority    VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
  status      VARCHAR(15) NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','in_progress','completed','cancelled')),
  created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_work_tasks_assignee ON work_tasks(assignee_id, status);

CREATE TABLE IF NOT EXISTS work_journals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date  DATE NOT NULL,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  work_hours NUMERIC(4,1),
  author_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_work_journals_author ON work_journals(author_id, work_date);

-- ── RLS — 조회는 로그인 사용자, 쓰기는 매니저 이상 (개인 기록성 테이블은 본인 쓰기 허용) ──
-- 실제 쓰기는 서버 액션(service role, RLS 우회)이 수행 — 아래 정책은 클라이언트 키 방어선 (039 교훈: 반드시 TO authenticated)
ALTER TABLE item_categories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners             ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_tasks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_journals        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "item_categories_select" ON item_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "item_categories_write"  ON item_categories FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin')));

CREATE POLICY "inventory_items_select" ON inventory_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "inventory_items_write"  ON inventory_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin')));

CREATE POLICY "stock_movements_select" ON stock_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "stock_movements_write"  ON stock_movements FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin')));

CREATE POLICY "partners_select" ON partners FOR SELECT TO authenticated USING (true);
CREATE POLICY "partners_write"  ON partners FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin')));

CREATE POLICY "purchase_orders_select" ON purchase_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "purchase_orders_write"  ON purchase_orders FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin')));

CREATE POLICY "po_lines_select" ON purchase_order_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY "po_lines_write"  ON purchase_order_lines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin')));

CREATE POLICY "vehicles_select" ON vehicles FOR SELECT TO authenticated USING (true);
CREATE POLICY "vehicles_write"  ON vehicles FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin')));

-- 운행일지·업무일지·업무지시: 전 직원 조회, 본인 기록 쓰기 + 매니저 관리
CREATE POLICY "vehicle_logs_select" ON vehicle_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "vehicle_logs_write"  ON vehicle_logs FOR ALL TO authenticated
  USING (driver_id = auth.uid()
         OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin')));

CREATE POLICY "work_tasks_select" ON work_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "work_tasks_write"  ON work_tasks FOR ALL TO authenticated
  USING (assignee_id = auth.uid() OR created_by = auth.uid()
         OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin')));

CREATE POLICY "work_journals_select" ON work_journals FOR SELECT TO authenticated USING (true);
CREATE POLICY "work_journals_write"  ON work_journals FOR ALL TO authenticated
  USING (author_id = auth.uid()
         OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin')));

-- PostgREST 스키마 캐시 갱신
NOTIFY pgrst, 'reload schema';
