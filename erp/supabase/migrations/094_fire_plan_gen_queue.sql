-- 094: 소방계획서 HWP 생성 큐 — 스토리지(fire-plans/_queue/*.json) → DB 테이블 전환 (2026-07-21)
-- 상태 추적(pending/processing/done/failed)·중복 방지·중단 복구를 위해 테이블로 관리.
-- 접근 경로는 서버 액션(service role)과 Windows 워커(scripts/fireplan-worker.py, service role)뿐 —
-- RLS는 켜되 정책 없음(클라이언트 직접 접근 차단).

CREATE TABLE IF NOT EXISTS fire_plan_gen_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  customer_name     TEXT NOT NULL,              -- 요청 시점 스냅샷 (표시용)
  year              INT  NOT NULL,
  preset_type       TEXT,                       -- 주택형/상가형/공장형 (NULL이면 양식 기본값)
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts          INT  NOT NULL DEFAULT 0,    -- 워커 중단 복구용 — 한도 초과 시 failed 처리
  error             TEXT,
  missing           TEXT[],                     -- 완료 시 누락 필드 라벨 (src/lib/fire-plan-readiness.ts 어휘)
  requested_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  requested_by_name TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fpgj_status_created ON fire_plan_gen_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_fpgj_finished ON fire_plan_gen_jobs(finished_at DESC);

-- 같은 고객·연도의 대기/처리 중 요청은 1건만 — 워커 오프라인 중 재요청으로 인한 중복 생성 방지
CREATE UNIQUE INDEX IF NOT EXISTS uq_fpgj_active ON fire_plan_gen_jobs(customer_id, year)
  WHERE status IN ('pending', 'processing');

ALTER TABLE fire_plan_gen_jobs ENABLE ROW LEVEL SECURITY;

-- 워커 하트비트 (단일 행 id=1) — processing_note = 현재 처리 중인 작업 표시
CREATE TABLE IF NOT EXISTS fire_plan_worker_status (
  id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing_note TEXT
);
ALTER TABLE fire_plan_worker_status ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE fire_plan_gen_jobs IS '소방계획서 HWP 생성 큐 — Windows 워커(scripts/fireplan-worker.py)가 폴링·처리';
COMMENT ON TABLE fire_plan_worker_status IS '생성 워커 하트비트 — 단일 행(id=1), 90초 내 갱신이면 온라인';
