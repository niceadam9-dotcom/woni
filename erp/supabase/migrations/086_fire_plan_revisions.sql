-- 086: 소방계획서 개정이력·부속자료·제출추적 (FP-2, doc02 §8-1~8-3)

ALTER TABLE fire_plans
  ADD COLUMN IF NOT EXISTS revision      INT  NOT NULL DEFAULT 1,   -- 개정 차수
  ADD COLUMN IF NOT EXISTS revision_note TEXT,                      -- 개정 사유
  ADD COLUMN IF NOT EXISTS submitted_at  DATE,                      -- 관할 소방서 제출일
  ADD COLUMN IF NOT EXISTS fire_station  TEXT;                      -- 제출 관할 소방서

COMMENT ON COLUMN fire_plans.revision IS '개정 차수 (연차발행/개정 시 증가)';
COMMENT ON COLUMN fire_plans.submitted_at IS '관할 소방서 제출일 (제출추적)';

-- 부속자료 (지도·사진 등)
CREATE TABLE IF NOT EXISTS fire_plan_attachments (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  fire_plan_id  UUID        NOT NULL REFERENCES fire_plans(id) ON DELETE CASCADE,
  kind          TEXT        NOT NULL DEFAULT '기타' CHECK (kind IN ('지도', '사진', '기타')),
  file_name     TEXT        NOT NULL,
  file_path     TEXT        NOT NULL,
  uploaded_by   UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fire_plan_attachments_plan ON fire_plan_attachments(fire_plan_id, created_at);

ALTER TABLE fire_plan_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fire_plan_attachments_read ON fire_plan_attachments;
CREATE POLICY fire_plan_attachments_read ON fire_plan_attachments
  FOR SELECT USING (auth.uid() IS NOT NULL);
