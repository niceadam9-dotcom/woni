-- 168: 크론 실행 기록 cron_runs (통합 실행계획 A3 관측, 2026-10-02)
--
-- 배경(코드 실측): VPS 크론 11개는 `curl -s … >> /var/log/sjfire-cron.log`에 `MAILTO=""`라 실패가 **묵음**이다.
--   라우트가 500을 내도, 아예 발화하지 않아도 아무도 모른다(로드맵 Stage 0.4 「크론 실패 묵음」).
--   이 표는 라우트 공용 래퍼 `withCronRun`(src/lib/cron-run.ts)이 발화마다 한 행을 쓰는 곳이고,
--   /api/health와 신선도 경고(마지막 성공이 주기의 2배를 넘으면 Sentry)가 여기를 읽는다.
--
-- 규칙: 새 표에는 company_id(nullable)를 처음부터 둔다(SaaS 로드맵 Stage 1 백필 비용 축소).
--   쓰기는 서비스 롤만(래퍼), 읽기는 로그인 사용자(131 패턴). 보존은 래퍼가 180일 지난 행을 지운다.

CREATE TABLE IF NOT EXISTS cron_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job          TEXT NOT NULL,                       -- 라우트 디렉터리명 (예: inspection-deadline-notify)
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  ok           BOOLEAN,                             -- NULL = 진행 중(끝을 못 적고 죽은 경우 그대로 남는다)
  status       INT,                                 -- HTTP 상태
  duration_ms  INT,
  error        TEXT,
  result       JSONB,                               -- 라우트 응답 본문(8KB 이하만)
  company_id   UUID                                 -- 테넌시 대비. 지금은 NULL
);

COMMENT ON TABLE  cron_runs IS '크론 라우트 발화 기록 — withCronRun(src/lib/cron-run.ts)이 쓴다. 신선도 경고·/api/health의 원천';
COMMENT ON COLUMN cron_runs.job IS '라우트 디렉터리명 11종 — src/lib/cron-run.ts CRON_MAX_AGE_HOURS 키와 일치';
COMMENT ON COLUMN cron_runs.ok IS 'true 성공 / false 실패(예외 또는 4xx·5xx 또는 본문 ok:false) / NULL 미완료';

CREATE INDEX IF NOT EXISTS idx_cron_runs_job_started ON cron_runs (job, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_started ON cron_runs (started_at);

ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;

-- 읽기: 로그인 사용자(운영 화면·/ops에서 볼 수 있게). 쓰기 정책은 두지 않는다 — 서비스 롤(래퍼)만 쓴다.
DROP POLICY IF EXISTS "cron_runs_select_authenticated" ON cron_runs;
CREATE POLICY "cron_runs_select_authenticated" ON cron_runs
  FOR SELECT TO authenticated USING (true);
