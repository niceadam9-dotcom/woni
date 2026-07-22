-- 096: 소방계획서 서식 입력 저장소 (2026-07-21, 소방계획서_4.md §7 — 4-1 골격)
-- 고객당 1행. 서식 전용 항목(개정이력 입력·구역·피난방화 등)을 섹션 키별 JSONB로 저장.
-- 정규 테이블이 있는 데이터(고객·건물·시설·자위소방대)는 여기 중복 저장하지 않는다.
-- 접근은 서버 액션(service role)뿐 — RLS는 켜되 정책 없음(클라이언트 직접 접근 차단).

CREATE TABLE IF NOT EXISTS fire_plan_forms (
  customer_id UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  sections    JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES profiles(id) ON DELETE SET NULL
);

ALTER TABLE fire_plan_forms ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE fire_plan_forms IS '소방계획서 서식 입력 (섹션 키별 JSONB: revision·zones·hazards·evacFire 등 — 소방계획서_4.md §7)';
