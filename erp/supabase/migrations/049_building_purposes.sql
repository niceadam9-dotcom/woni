-- 049: 건물 용도 관리 테이블 (2026-07-09)
--
-- 배경: 건물 용도 선택지가 화면 코드에 하드코딩돼 있어 관리자가 추가·삭제 불가.
-- 조치: building_purposes 테이블로 이전, 관리자 > 건물 용도 관리 화면에서 CRUD.
--   buildings.purpose는 기존대로 TEXT 저장(용도 삭제 시에도 기존 건물 값은 유지).

CREATE TABLE IF NOT EXISTS building_purposes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL UNIQUE,
  sort_order  INT         NOT NULL DEFAULT 100,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 기존 하드코딩 목록 시드 (순서 유지)
INSERT INTO building_purposes (name, sort_order) VALUES
  ('공동주택', 10), ('근린생활시설', 20), ('판매시설', 30), ('의료시설', 40),
  ('교육시설', 50), ('숙박시설', 60), ('업무시설', 70), ('공장', 80),
  ('창고시설', 90), ('위험물저장시설', 100), ('기타', 999)
ON CONFLICT (name) DO NOTHING;

-- RLS: 로그인 사용자 조회 가능, 쓰기는 service role(관리자 서버 액션) 전용
ALTER TABLE building_purposes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "building_purposes_select" ON building_purposes;
CREATE POLICY "building_purposes_select"
  ON building_purposes FOR SELECT TO authenticated
  USING (true);

NOTIFY pgrst, 'reload schema';
