-- 119: 공통 서술 라이브러리 (2026-08-10, 소방계획서_15_별도라이브러리.md §3)
-- 서술형 8섹션(training·기록부4·brigadeTeams·evacPlan·vulnerableMethods)의 공통 문구를
-- 항목 단위로 저장하고, 어느 고객이 어느 항목 몇 버전을 가져갔는지 스탬프로 남긴다.
-- 접근은 서버 액션(service role)뿐 — RLS는 켜되 정책 없음(클라이언트 직접 접근 차단, 096 관례).

CREATE TABLE IF NOT EXISTS plan_text_library (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key TEXT NOT NULL,               -- §2의 섹션 키 (training·fireworkLog·…·vulnerableMethods)
  title       TEXT NOT NULL,               -- 항목 이름 (예: "아파트용 훈련 시나리오")
  body        JSONB NOT NULL DEFAULT '{}', -- 섹션별 부분 값 (§2 '라이브러리 대상' 필드만)
  is_default  BOOLEAN NOT NULL DEFAULT FALSE, -- 자동주입 대상 (§4-0)
  version     INT NOT NULL DEFAULT 1,      -- body 수정 시 +1 — 개정 알림(로드맵 L-2) 판정 기준
  bundle_id   UUID,                        -- 서술 세트(로드맵 L-3) 자리만 확보
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_text_library_section ON plan_text_library (section_key, is_active, sort_order);
-- 섹션당 활성 기본항목은 최대 1개 — 자동주입이 무엇을 넣을지 모호해지면 안 된다
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_text_library_default
  ON plan_text_library (section_key) WHERE is_default AND is_active;

ALTER TABLE plan_text_library ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE plan_text_library IS '소방계획서 공통 서술 항목 (서술형 8섹션 — 소방계획서_15_별도라이브러리.md §3-1)';

-- 출처 스탬프 — pull/자동주입이 어느 항목 몇 버전에서 왔는지. 자동주입 1회성 가드 겸
-- 개정 알림형 push(로드맵 L-2)의 역조회("이 항목을 쓰는 고객") 인덱스.
CREATE TABLE IF NOT EXISTS plan_text_applied (
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  section_key     TEXT NOT NULL,
  library_id      UUID REFERENCES plan_text_library(id) ON DELETE SET NULL,
  library_version INT NOT NULL,            -- 가져간 시점의 plan_text_library.version
  source          TEXT NOT NULL,           -- 'pull'(가져오기, 서식 저장 성공 시) | 'default'(자동주입)
  applied_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (customer_id, section_key)   -- 섹션당 최신 출처 1건 (덮어쓰기)
);

CREATE INDEX IF NOT EXISTS idx_plan_text_applied_library ON plan_text_applied (library_id);

ALTER TABLE plan_text_applied ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE plan_text_applied IS '공통 서술 적용 스탬프 (출처 추적·자동주입 1회 가드 — 소방계획서_15_별도라이브러리.md §3-2)';
