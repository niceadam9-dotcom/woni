-- ============================================================
-- ERP System — Initial Schema
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- departments
-- ============================================================
CREATE TABLE departments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  manager_id  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- profiles (extends auth.users)
-- ============================================================
CREATE TABLE profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id     TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'employee'
                  CHECK (role IN ('employee', 'manager', 'admin')),
  department_id   UUID REFERENCES departments(id) ON DELETE SET NULL,
  position        TEXT,
  hire_date       DATE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  failed_logins   INT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- departments.manager_id FK (after profiles exists)
ALTER TABLE departments
  ADD CONSTRAINT fk_dept_manager
  FOREIGN KEY (manager_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- ============================================================
-- documents (기안서)
-- ============================================================
CREATE TABLE documents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title          TEXT NOT NULL,
  content        TEXT NOT NULL DEFAULT '',
  template_type  TEXT NOT NULL DEFAULT 'general',
  author_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'recalled')),
  submitted_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- document_approvers
-- ============================================================
CREATE TABLE document_approvers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  approver_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  order_num     INT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
  comment       TEXT,
  processed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, order_num)
);

-- ============================================================
-- document_attachments
-- ============================================================
CREATE TABLE document_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  file_name    TEXT NOT NULL,
  file_path    TEXT NOT NULL,
  file_size    INT,
  mime_type    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- leave_balances
-- ============================================================
CREATE TABLE leave_balances (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  year         INT NOT NULL,
  total_days   DECIMAL(4,1) NOT NULL DEFAULT 15,
  used_days    DECIMAL(4,1) NOT NULL DEFAULT 0,
  UNIQUE (employee_id, year)
);

-- ============================================================
-- leaves (휴가 신청)
-- ============================================================
CREATE TABLE leaves (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  leave_type       TEXT NOT NULL
                   CHECK (leave_type IN ('annual', 'half_am', 'half_pm', 'sick', 'special')),
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  days_count       DECIMAL(3,1) NOT NULL,
  reason           TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'manager_approved', 'approved', 'rejected')),
  manager_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  admin_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  manager_comment  TEXT,
  admin_comment    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- notifications
-- ============================================================
CREATE TABLE notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  type            TEXT NOT NULL
                  CHECK (type IN ('approval_request','approved','rejected','recalled','leave_request','leave_approved','leave_rejected')),
  reference_id    UUID,
  reference_type  TEXT CHECK (reference_type IN ('document', 'leave')),
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- push_subscriptions (Web Push / PWA)
-- ============================================================
CREATE TABLE push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh_key  TEXT NOT NULL,
  auth_key    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- activity_logs (append-only, immutable)
-- ============================================================
CREATE TABLE activity_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    UUID,
  metadata     JSONB,
  ip_address   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent UPDATE and DELETE on activity_logs
CREATE OR REPLACE RULE no_update_logs AS ON UPDATE TO activity_logs DO INSTEAD NOTHING;
CREATE OR REPLACE RULE no_delete_logs AS ON DELETE TO activity_logs DO INSTEAD NOTHING;

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX idx_documents_author      ON documents(author_id);
CREATE INDEX idx_documents_status      ON documents(status);
CREATE INDEX idx_doc_approvers_doc     ON document_approvers(document_id);
CREATE INDEX idx_doc_approvers_approver ON document_approvers(approver_id, status);
CREATE INDEX idx_leaves_employee       ON leaves(employee_id);
CREATE INDEX idx_leaves_status         ON leaves(status);
CREATE INDEX idx_leaves_dates          ON leaves(start_date, end_date);
CREATE INDEX idx_notifications_recipient ON notifications(recipient_id, is_read);
CREATE INDEX idx_activity_logs_actor   ON activity_logs(actor_id);
CREATE INDEX idx_activity_logs_entity  ON activity_logs(entity_type, entity_id);

-- ============================================================
-- updated_at trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_leaves_updated_at
  BEFORE UPDATE ON leaves
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_departments_updated_at
  BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_approvers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaves               ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances       ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs        ENABLE ROW LEVEL SECURITY;

-- Helper: current user role
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: current user department
CREATE OR REPLACE FUNCTION current_user_department()
RETURNS UUID AS $$
  SELECT department_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- profiles
CREATE POLICY "Users can view all active profiles"
  ON profiles FOR SELECT
  USING (is_active = TRUE);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "Admins can manage all profiles"
  ON profiles FOR ALL
  USING (current_user_role() = 'admin');

-- departments
CREATE POLICY "All authenticated users can view departments"
  ON departments FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage departments"
  ON departments FOR ALL
  USING (current_user_role() = 'admin');

-- documents
CREATE POLICY "Authors can view own documents"
  ON documents FOR SELECT
  USING (author_id = auth.uid());

CREATE POLICY "Approvers can view documents assigned to them"
  ON documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM document_approvers
      WHERE document_id = documents.id
        AND approver_id = auth.uid()
    )
  );

CREATE POLICY "Admins can view all documents"
  ON documents FOR SELECT
  USING (current_user_role() = 'admin');

CREATE POLICY "Authors can create documents"
  ON documents FOR INSERT
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "Authors can update draft documents"
  ON documents FOR UPDATE
  USING (author_id = auth.uid() AND status = 'draft');

-- document_approvers
CREATE POLICY "View approvers for accessible documents"
  ON document_approvers FOR SELECT
  USING (
    approver_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM documents
      WHERE id = document_approvers.document_id
        AND author_id = auth.uid()
    )
    OR current_user_role() = 'admin'
  );

CREATE POLICY "Authors can set approvers on draft documents"
  ON document_approvers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM documents
      WHERE id = document_approvers.document_id
        AND author_id = auth.uid()
        AND status = 'draft'
    )
  );

CREATE POLICY "Approvers can update their own approval record"
  ON document_approvers FOR UPDATE
  USING (approver_id = auth.uid());

-- document_attachments
CREATE POLICY "View attachments for accessible documents"
  ON document_attachments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM documents
      WHERE id = document_attachments.document_id
        AND (author_id = auth.uid() OR EXISTS (
          SELECT 1 FROM document_approvers
          WHERE document_id = documents.id AND approver_id = auth.uid()
        ))
    )
    OR current_user_role() = 'admin'
  );

CREATE POLICY "Authors can attach files to own documents"
  ON document_attachments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM documents
      WHERE id = document_attachments.document_id
        AND author_id = auth.uid()
    )
  );

-- leaves
CREATE POLICY "Employees can view own leaves"
  ON leaves FOR SELECT
  USING (employee_id = auth.uid());

CREATE POLICY "Managers can view team leaves"
  ON leaves FOR SELECT
  USING (
    current_user_role() IN ('manager', 'admin')
  );

CREATE POLICY "Employees can create own leaves"
  ON leaves FOR INSERT
  WITH CHECK (employee_id = auth.uid());

CREATE POLICY "Employees can update pending own leaves"
  ON leaves FOR UPDATE
  USING (employee_id = auth.uid() AND status = 'pending');

CREATE POLICY "Managers and admins can update leave status"
  ON leaves FOR UPDATE
  USING (current_user_role() IN ('manager', 'admin'));

-- leave_balances
CREATE POLICY "Employees view own balance"
  ON leave_balances FOR SELECT
  USING (employee_id = auth.uid());

CREATE POLICY "Managers and admins view all balances"
  ON leave_balances FOR SELECT
  USING (current_user_role() IN ('manager', 'admin'));

CREATE POLICY "Admins manage leave balances"
  ON leave_balances FOR ALL
  USING (current_user_role() = 'admin');

-- notifications
CREATE POLICY "Users view own notifications"
  ON notifications FOR SELECT
  USING (recipient_id = auth.uid());

CREATE POLICY "Users update own notifications (mark read)"
  ON notifications FOR UPDATE
  USING (recipient_id = auth.uid());

-- push_subscriptions
CREATE POLICY "Users manage own push subscriptions"
  ON push_subscriptions FOR ALL
  USING (user_id = auth.uid());

-- activity_logs
CREATE POLICY "Users view own activity"
  ON activity_logs FOR SELECT
  USING (actor_id = auth.uid());

CREATE POLICY "Admins view all activity"
  ON activity_logs FOR SELECT
  USING (current_user_role() = 'admin');

CREATE POLICY "Insert only via service role"
  ON activity_logs FOR INSERT
  WITH CHECK (TRUE);

-- ============================================================
-- Function: handle new user (auto-create profile)
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, employee_id, name, email)
  VALUES (
    NEW.id,
    'EMP-' || UPPER(SUBSTR(NEW.id::TEXT, 1, 8)),
    COALESCE(NEW.raw_user_meta_data->>'name', SPLIT_PART(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
