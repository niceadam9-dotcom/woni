-- 178: 설비 지점(책갈피 QR) — equipment_points (통합 실행계획 C4 — 설비 QR 절 3단계, 2026-10-03)
--
-- 배경: 수신기·펌프실·물탱크처럼 **회차마다 가는 자리**에 붙이는 책갈피 QR. 개체(172)가 아니라 「자리」라
--   별도 표다. 찍으면(/t/{code}) 그 자리의 점검표 시트(sheet_codes)로 바로 간다 — 진행 중 회차의
--   /inspections/{id}/sheet?sheet=… 딥링크. 사용자 결정(2026-10-03): 범위에 넣는다.
-- 과잉 등록 방지는 화면 문구(「회차마다 가는 곳만」)로 — 건물당 수십 행이 정상 상한이다.
-- company_id는 비워 둔다(SaaS Stage 2에서 채움 — 172와 같은 규약). RLS는 131 거울:
--   SELECT는 로그인, 쓰기는 service role만(정책 없음 = 거부, 서버 액션이 권한 검사 후 쓴다).

CREATE TABLE IF NOT EXISTS equipment_points (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID,
  customer_id  UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  building_id  UUID        REFERENCES buildings(id) ON DELETE SET NULL,
  label        TEXT        NOT NULL,                  -- '수신기(방재실)' '옥내소화전 펌프실'
  floor        TEXT,                                  -- 'B1' '3'
  room         TEXT,                                  -- '방재실' '기계실'
  sheet_codes  TEXT[]      NOT NULL DEFAULT '{}',     -- 점검표 시트 코드(STD-15 등) — 책갈피의 목적지
  tag_code     TEXT        UNIQUE,                    -- 개체와 같은 코드 공간(회사 접두 없는 8자) — /t/{code}가 세 표를 차례로 찾는다
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  note         TEXT,
  created_by   UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equipment_points_customer ON equipment_points(customer_id, sort_order);

ALTER TABLE equipment_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "equipment_points_select_all" ON equipment_points FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE TRIGGER trg_equipment_points_updated_at BEFORE UPDATE ON equipment_points
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE equipment_points IS '설비 지점(책갈피 QR) — 회차마다 가는 자리. 찍으면 sheet_codes의 점검표 시트로 (설비 QR 절 3단계, 178)';
