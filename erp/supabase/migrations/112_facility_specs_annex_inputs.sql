-- 112: 설비 세부현황·별지 고유 값 저장소 (2026-08-03, 소방계획서_7.md §4-A / H-18, S3A)
--
-- 배경: 입력 3계층(§4-A-0) 중 ③ 서식 고유 값의 단일 원본 2종.
--   1) customer_facility_specs — 고객·건물 단위 설비 제원(별지 4호 3~7쪽 = 별지 9호 4~7쪽
--      "소방시설등의 세부 현황" 공용 원본). 제원은 점검마다 불변이므로 고객당 1세트,
--      다동 건물 대응(building_id, NULL = 대표/공통). 소방계획서 1.4장도 같은 원본을 읽는다.
--      section_key는 src/lib/facility-spec-schema.ts의 FACILITY_SPEC_SECTIONS(s31~s38) 기준.
--   2) annex_inputs — 점검 건 단위 별지 9·10·11호 고유 값(비고·보완, 이행계획 기간·업체,
--      완료 보고·제출인 등). inspection_id × annex_no × JSONB — 같은 점검의 서식을 다시
--      열면 이전 입력 유지, 수정·재생성 가능(§4-A-2b).

-- ── 1) 설비 세부현황 (고객·건물 단위) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_facility_specs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  building_id UUID REFERENCES buildings(id) ON DELETE CASCADE,  -- NULL = 대표/공통 (단일 동)
  section_key TEXT NOT NULL,                                    -- s31_extinguisher ~ s38_activity
  spec        JSONB NOT NULL DEFAULT '{}',                      -- { blockKey: { fieldKey: 값 } }
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- UNIQUE(customer_id, building_id, section_key) — building_id NULL은 일반 UNIQUE 제약에서
-- 중복 허용되므로 coalesce 식 인덱스로 NULL도 1행만 허용
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_facility_specs
  ON customer_facility_specs (
    customer_id,
    COALESCE(building_id, '00000000-0000-0000-0000-000000000000'::uuid),
    section_key
  );
CREATE INDEX IF NOT EXISTS idx_customer_facility_specs_customer
  ON customer_facility_specs (customer_id);

-- 서버 액션(service role) 전용 — RLS 활성화, 정책 없음 (105 report_deliveries와 동일 패턴)
ALTER TABLE customer_facility_specs ENABLE ROW LEVEL SECURITY;

-- ── 2) 별지 서식 고유 값 (점검 건 단위) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS annex_inputs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  annex_no      TEXT NOT NULL CHECK (annex_no IN ('report9', 'report10', 'report11')),
  fields        JSONB NOT NULL DEFAULT '{}',                    -- 서식 고유 값 ③ (문서 레벨 값만)
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (inspection_id, annex_no)
);
CREATE INDEX IF NOT EXISTS idx_annex_inputs_insp ON annex_inputs (inspection_id);

-- 서버 액션(service role) 전용 — RLS 활성화, 정책 없음
ALTER TABLE annex_inputs ENABLE ROW LEVEL SECURITY;
