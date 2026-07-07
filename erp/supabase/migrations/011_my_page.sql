-- ============================================================
-- schedules — 개인 일정
-- ============================================================
CREATE TABLE schedules (
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

CREATE INDEX idx_schedules_employee ON schedules(employee_id);
CREATE INDEX idx_schedules_dates    ON schedules(start_date, end_date);

ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "schedules_own" ON schedules
  FOR ALL USING (employee_id = auth.uid());
CREATE POLICY "schedules_manager_read" ON schedules
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin')
    )
  );

CREATE TRIGGER trg_schedules_updated_at
  BEFORE UPDATE ON schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- todos — ToDo 체크리스트
-- ============================================================
CREATE TABLE todos (
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

CREATE INDEX idx_todos_employee ON todos(employee_id);
CREATE INDEX idx_todos_due_date ON todos(due_date);

ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "todos_own" ON todos
  FOR ALL USING (employee_id = auth.uid());

CREATE TRIGGER trg_todos_updated_at
  BEFORE UPDATE ON todos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
