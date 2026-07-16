-- 093: 증명서 발급 대장 (2026-07-16, 전체테스트 HR-6 실측 — 코드(/hr/certificates)만 있고 테이블이 미배포 상태였음)
-- 재직/경력/급여확인/휴직 증명서 발급 이력. 발급·조회는 매니저 이상(HR 문서).

CREATE TABLE IF NOT EXISTS certificates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cert_type   TEXT NOT NULL CHECK (cert_type IN ('employment', 'career', 'salary', 'leave')),
  purpose     TEXT,               -- 제출처/용도
  notes       TEXT,
  issued_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_certificates_employee ON certificates(employee_id, issued_at DESC);

ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;
CREATE POLICY certificates_manage ON certificates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'admin')));

COMMENT ON TABLE certificates IS '증명서 발급 대장 — cert_type: employment(재직)/career(경력)/salary(급여확인)/leave(휴직)';
