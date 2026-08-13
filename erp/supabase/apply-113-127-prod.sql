-- ================================================================================
--  운영 DB 일괄 적용 — 마이그레이션 113 · 119 ~ 127
--  2026-08-12 · 소방계획서_7·15·16·17·19 계열
--
--  배경: 운영은 112 + (114~118)까지 적용된 상태다. 2026-08-12 읽기 전용 대조로
--        114~118과 시드(region_fire_stations 112행 · fire_station_centers 103행)는
--        이미 스테이징과 동일함을 확인했다 — apply-114-118-prod.sql은 재실행 불필요.
--        실제 누락은 113과 119~127이며 이 파일이 그 전부다.
--
--  이 파일은 마이그레이션이 아니라 **일회성 적용본**이다(번호를 붙이지 않는 이유).
--  원본 10개와 내용은 같고, 보강은 한 곳뿐:
--    · 113 DROP CONSTRAINT 에 IF EXISTS 추가 (원본은 없어 재실행 시 실패)
--  전부 IF NOT EXISTS·NOT EXISTS 가드가 있어 **재실행해도 안전**하다.
--
--  ⚠ 순서 의존: 124(컬럼 신설) → 127(기본값·백필). 파일 순서를 바꾸지 말 것.
--  ⚠ 127은 customers 전 행의 manager_appointment_type NULL 을 업무대행감독 으로 채운다
--     (2026-08-12 사용자 확정 — 전 고객 업무대행 계약이라 사실과 일치).
--  ⚠ 121은 create_inspection_steps 트리거 함수를 교체한다 — 기존 행은 무변경,
--     신규 점검 INSERT 부터 ②단계 기산점이 법정(점검종료일)으로 바뀐다.
-- ================================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────────
-- 113_report4_job_type.sql
-- ────────────────────────────────────────────────────────────────────────────────
-- 113: fire_plan_gen_jobs.report_type에 'report4'(소방시설등점검표 별지 4호) 추가
-- (2026-08-03, 소방계획서_7.md S3A H-21 — 별지 4호 HTML 템플릿·서버 동기 생성 전환)
-- 102와 동일 패턴 — CHECK 제약 재생성. 생성 자체는 서버 동기(HTML→Gotenberg PDF)이고
-- 잡 행은 완료 기록용이지만, CHECK에 없으면 insert가 실패하므로 허용값 확장이 필수.

ALTER TABLE fire_plan_gen_jobs DROP CONSTRAINT IF EXISTS fire_plan_gen_jobs_report_type_check;  -- 적용본 보강: IF EXISTS

ALTER TABLE fire_plan_gen_jobs
  ADD CONSTRAINT fire_plan_gen_jobs_report_type_check
  CHECK (report_type IN ('fire_plan', 'report9', 'report10', 'report11', 'exterior', 'report4'));

COMMENT ON COLUMN fire_plan_gen_jobs.report_type IS
  '서식 종류 — fire_plan(소방계획서)/report4(별지 4호 소방시설등점검표)/report9(별지 9호)/report10(별지 10호)/report11(별지 11호)/exterior(외관점검표)';

-- ────────────────────────────────────────────────────────────────────────────────
-- 119_plan_text_library.sql
-- ────────────────────────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────────────────────────
-- 120_fire_plan_revisions.sql
-- ────────────────────────────────────────────────────────────────────────────────
-- 120: 소방계획서 개정이력 연도별 히스토리 (2026-08-10, 소방계획서_17.md §2)
-- 종전에는 개정 사유를 fire_plan_forms.sections.revision 단일 슬롯에 넣어 저장할 때마다 덮어썼다(K-1).
-- 이 테이블로 승격해 연도별(year)·행 단위(seq)로 이력을 남기고, 행마다 서술·작성자·검토·승인을 보존한다.
-- 접근은 서버 액션(service role)뿐 — RLS는 켜되 정책 없음(096·119 관례).

CREATE TABLE IF NOT EXISTS fire_plan_revisions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  year          INT NOT NULL,                 -- 연도별 그룹 축 = 계획서 연도(fire_plans.year 계열)
  seq           INT NOT NULL,                 -- 연도 내 순번
  revised_on    DATE,                         -- 개정일 (비우면 화면·인쇄에서 빈칸)
  content       TEXT NOT NULL DEFAULT '',     -- 주요 개정내용 — 행마다 보존 (K-1 해소)
  author_name   TEXT,                         -- 작성자 (K-4)
  reviewer_name TEXT,                         -- 검토 (Q-2: ERP 입력 + 빈칸 허용)
  approver_name TEXT,                         -- 승인
  source        TEXT NOT NULL DEFAULT 'manual'
                CHECK (source IN ('generated', 'uploaded', 'manual')),
  fire_plan_id  UUID REFERENCES fire_plans(id) ON DELETE SET NULL,  -- 생성·업로드 실적 연결
  created_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 연도 내 순번은 유일 — 서버가 max(seq)+1로 채번하고 경합 시 재시도한다
CREATE UNIQUE INDEX IF NOT EXISTS uq_fire_plan_revisions_seq
  ON fire_plan_revisions (customer_id, year, seq);
CREATE INDEX IF NOT EXISTS idx_fire_plan_revisions_cust
  ON fire_plan_revisions (customer_id, year DESC, seq);

ALTER TABLE fire_plan_revisions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE fire_plan_revisions IS '소방계획서 개정이력 (연도별 히스토리 — 소방계획서_17.md §2-1)';

-- ── 백필 ① 기존 보관함 행(fire_plans) → generated/uploaded 행 ───────────────────
-- content는 현행 화면·인쇄의 자동 문구 규칙을 그대로 옮긴다(note ?? '{year}년 소방계획서{ (개정N)}').
-- 규칙을 바꾸면 이미 제출된 문서와 다음 생성분의 문구가 어긋나므로 손대지 않는다.
-- fire_plan_id 기준 NOT EXISTS 가드 — 재실행해도 중복되지 않는다.
INSERT INTO fire_plan_revisions (customer_id, year, seq, revised_on, content, source, fire_plan_id, created_by, created_at)
SELECT
  p.customer_id,
  p.year,
  ROW_NUMBER() OVER (PARTITION BY p.customer_id, p.year ORDER BY p.created_at, p.id),
  p.created_at::date,
  COALESCE(
    NULLIF(p.note, ''),
    p.year || '년 소방계획서' || CASE WHEN p.revision > 1 THEN ' (개정' || p.revision || ')' ELSE ' 작성' END
  ),
  CASE WHEN COALESCE(p.pdf_path, '') LIKE '%generated_%' THEN 'generated' ELSE 'uploaded' END,
  p.id,
  p.uploaded_by,
  p.created_at
FROM fire_plans p
WHERE NOT EXISTS (
  SELECT 1 FROM fire_plan_revisions r WHERE r.fire_plan_id = p.id
);

-- ── 백필 ② sections.revision 단일 슬롯 → 아직 생성되지 않은 manual 행 ──────────
-- 이 값은 '다음 생성 시 마지막 행으로 찍힐 예정'이던 미발행 개정이라 manual로 옮긴다.
-- 연도는 작성일의 연도, 없으면 올해. 고객·연도당 manual 행이 이미 있으면 건너뛴다(재실행 안전).
WITH src AS (
  SELECT
    f.customer_id,
    NULLIF(f.sections -> 'revision' ->> 'revisionDate', '') AS rdate,
    NULLIF(f.sections -> 'revision' ->> 'revisionNote', '') AS rnote,
    f.updated_by
  FROM fire_plan_forms f
  WHERE f.sections ? 'revision'
    AND (
      NULLIF(f.sections -> 'revision' ->> 'revisionDate', '') IS NOT NULL
      OR NULLIF(f.sections -> 'revision' ->> 'revisionNote', '') IS NOT NULL
    )
), t AS (
  SELECT s.*, COALESCE(substring(s.rdate FROM 1 FOR 4)::int, EXTRACT(YEAR FROM now())::int) AS y
  FROM src s
)
INSERT INTO fire_plan_revisions (customer_id, year, seq, revised_on, content, source, created_by)
SELECT
  t.customer_id,
  t.y,
  COALESCE((SELECT MAX(r.seq) FROM fire_plan_revisions r WHERE r.customer_id = t.customer_id AND r.year = t.y), 0) + 1,
  t.rdate::date,
  COALESCE(t.rnote, ''),
  'manual',
  t.updated_by
FROM t
WHERE NOT EXISTS (
  SELECT 1 FROM fire_plan_revisions r
  WHERE r.customer_id = t.customer_id AND r.year = t.y AND r.source = 'manual'
);

-- ────────────────────────────────────────────────────────────────────────────────
-- 121_step2_legal_anchor.sql
-- ────────────────────────────────────────────────────────────────────────────────
-- ============================================================
-- 121_step2_legal_anchor.sql
-- 소방계획서_14 #14 후속 — ②단계(점검인력 배치신고) 기한을 법정 기산점으로 정정
--
-- 법정 근거 (한국소방시설관리협회 배치신고 안내 · 관리업종합정보시스템 공지 1079,
--   2022-12-01 개정): "점검이 끝난 날부터 5일 이내"이며 협회 계산법은
--   "종료일 당일 및 기간 내 모든 토요일·공휴일 산입 제외" —
--   즉 종료일 다음 영업일부터 5영업일 = add_working_days(종료일, 5).
--   따라서 종전의 '5영업일'이라는 일수 자체는 옳았고, 틀린 것은 기산점이다.
--
-- 종전: add_working_days(step1_due, 5)
--   step1_due = add_working_days(base_date, 1)이고 base_date는 사용승인일 응당일(있으면)이라
--   ① 통상 고객: 법정보다 1영업일 늦다 (예: 종료 9/15(화) → 법정 9/22, 종전 9/23)
--   ② 사용승인일 고객: 점검일과 무관한 날짜가 나온다 (기준일 자체가 다름)
-- 변경: add_working_days(COALESCE(inspection_end_date, inspection_start_date), 5)
--   079가 "6단계 기산점의 기준"으로 예고해 두고 미적용이던 종료일 기산을 ②단계에 한해 적용한다.
--   ①③④⑤⑥은 이번 범위가 아니라 무변경 — ④(별지 9호 15일)도 같은 기산점 문제가 있으나
--   별도 결정 대기 항목이다.
--
-- 기존 행은 변경하지 않는다 (트리거는 INSERT 시에만 동작). 이미 생성된 점검의 ②단계 마감일
-- 소급 보정이 필요하면 별도 백필로 진행한다.
-- ============================================================

CREATE OR REPLACE FUNCTION create_inspection_steps()
RETURNS TRIGGER AS $$
DECLARE
  approval  DATE;
  base_date DATE;
  insp_year INT;
  step1_due DATE;
  step2_due DATE;
  step4_due DATE;
  step5_due DATE;
BEGIN
  -- 정기(monthly)·레거시 일반 이벤트(event): 1단계(점검일)만 — 법정 보고 절차 없음.
  IF coalesce(NEW.plan_type, '') IN ('monthly', 'event') THEN
    INSERT INTO inspection_steps (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
    VALUES (NEW.id, 1, '1단계: 점검일', 0, FALSE, NEW.inspection_start_date);
    RETURN NEW;
  END IF;

  SELECT use_approval_date INTO approval FROM customers WHERE id = NEW.customer_id;

  IF approval IS NULL THEN
    base_date := NEW.inspection_start_date;
  ELSE
    -- 점검 연도의 응당일로 변환 (말일 초과분은 그 달 말일로 — 2/29 등)
    insp_year := EXTRACT(YEAR FROM NEW.inspection_start_date)::INT;
    base_date := make_date(
      insp_year,
      EXTRACT(MONTH FROM approval)::INT,
      LEAST(
        EXTRACT(DAY FROM approval)::INT,
        EXTRACT(DAY FROM (make_date(insp_year, EXTRACT(MONTH FROM approval)::INT, 1)
                          + INTERVAL '1 month - 1 day'))::INT
      )
    );
  END IF;

  step1_due := add_working_days(base_date, 1);
  -- ②단계만 법정 기산점(점검 종료일, 없으면 시작일)을 쓴다 — 위 주석 참조
  step2_due := add_working_days(coalesce(NEW.inspection_end_date, NEW.inspection_start_date), 5);
  step4_due := add_working_days(step1_due, 15);
  step5_due := step4_due + INTERVAL '9 days'; -- 당일 포함 10일째

  INSERT INTO inspection_steps (inspection_id, step_num, name_ko, due_days, is_working_days, due_date)
  VALUES
    (NEW.id, 1, '1단계: 점검일',                            1,  TRUE,  step1_due),
    (NEW.id, 2, '2단계: 배치확인서 보고서 작성',              5,  TRUE,  step2_due),
    (NEW.id, 3, '3단계: 관계인 보고서 제출',                 10, TRUE,  add_working_days(step1_due, 10)),
    (NEW.id, 4, '4단계: 소방서 보고서 제출 및 이행계획서 등록', 15, TRUE,  step4_due),
    (NEW.id, 5, '5단계: 소방보수 완료',                     10, FALSE, step5_due),
    (NEW.id, 6, '6단계: 이행완료보고서 제출',                10, TRUE,  add_working_days(step5_due, 10));

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────────────────────────
-- 122_realtime_sheet_responses.sql
-- ────────────────────────────────────────────────────────────────────────────────
-- 122: Realtime 활성화 (소방계획서_16 S5-1 · K-3)
-- postgres_changes는 supabase_realtime publication에 등록된 테이블만 이벤트를 낸다.
-- 지금까지 등록 테이블이 0개여서 알림 벨(notification-bell.tsx)의 실시간 수신도
-- 한 번도 동작한 적이 없다 — 점검표 응답과 함께 notifications도 등록한다.
-- (계획 당시 번호 119는 plan_text_library가 선점 — 122로 이월)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'inspection_sheet_responses'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inspection_sheet_responses;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- REPLICA IDENTITY FULL — UPDATE의 old 레코드 보존용.
-- ⚠ 실측(2026-08-10 스테이징): DELETE는 FULL이어도 Realtime이 old를 PK(id)로 잘라 전달하고
--   filter도 적용하지 않는다 — 클라이언트(use-sheet-responses-realtime)는 DELETE를 무필터로
--   받아 구독 건 전체 갱신으로 처리한다.
ALTER TABLE public.inspection_sheet_responses REPLICA IDENTITY FULL;

-- ────────────────────────────────────────────────────────────────────────────────
-- 123_company_management_reg_no.sql
-- ────────────────────────────────────────────────────────────────────────────────
-- 123: 소방시설관리업 등록번호 (소방계획서_15 A4-2, 2026-08-11 사용자 확정 — 회사 정보 컬럼 신설안)
-- 별지 4호 2쪽 '소방시설관리업체(등록번호)' 칸이 '(제    -    호)' 고정 공란이던 결함 해소.
-- 사업자등록번호(business_number)와 다른 별개 번호라 전용 컬럼으로 둔다. 값 예: "2026-15" → 인쇄 "(제 2026-15 호)"
ALTER TABLE company_profile
  ADD COLUMN IF NOT EXISTS management_reg_no TEXT;

-- ────────────────────────────────────────────────────────────────────────────────
-- 124_manager_appointment_type.sql
-- ────────────────────────────────────────────────────────────────────────────────
-- 124: 소방안전관리자 선임 형태 (소방계획서_19 B-4d · A9-4, Q-2 확정 2026-08-11 — 고객 마스터 컬럼안)
-- 별지 9호 2쪽 '소방안전관리자' 칸의 선임 형태 5종 체크(소방기술자격·소방안전관리자수첩·업무대행감독·겸직·기타)가
-- 원천 부재로 영구 ☐이던 결함 해소. 고객 고정값이라 점검 건마다 재입력하는 ③ 보정 대신 마스터에 둔다.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS manager_appointment_type TEXT
  CHECK (manager_appointment_type IS NULL
         OR manager_appointment_type IN ('소방기술자격', '소방안전관리자수첩', '업무대행감독', '겸직', '기타'));

-- ────────────────────────────────────────────────────────────────────────────────
-- 125_sheet_response_month.sql
-- ────────────────────────────────────────────────────────────────────────────────
-- 125: 점검표 응답에 월 축 추가 (소방계획서_19 EX-4 — 외관점검표 연간 누적본, 2026-08-12 사용자 승인)
--
-- 배경: 외관점검표(별지 6호)는 12개월 × 12행짜리 **연간 서식**인데 ERP는 회차 단위로 생성해
--   해당 월 1칸만 채웠다. 같은 해 이전 달을 병합하려 해도 저장할 자리가 없었다:
--     · inspection_sheet_responses UNIQUE (inspection_id, item_code) — 점검 건당 항목 1개 응답
--     · inspections CHECK (sequence_num IN (1,2)) + UNIQUE (customer_id, year, sequence_num)
--       → 고객·연도당 점검 건이 최대 2건이라 월 12회를 회차로 쪼갤 수도 없다(2026-08-12 실측 확인)
--
-- 해결: 응답에 month를 두어 **연간 서식 1장에 12개월치**를 담는다(서식 의미와 일치).
--   month = 0 은 '월 무관'(일반 점검표 1-A-001 등 기존 전 응답) — 기본값이라 기존 경로는 무변경.
--   외관(X%) 응답만 1~12를 쓴다.
-- NULL 대신 0을 쓰는 이유: UNIQUE에서 NULL은 서로 다른 값으로 취급돼 중복이 뚫린다.

ALTER TABLE inspection_sheet_responses
  ADD COLUMN IF NOT EXISTS month SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE inspection_sheet_responses
  DROP CONSTRAINT IF EXISTS inspection_sheet_responses_month_check;
ALTER TABLE inspection_sheet_responses
  ADD CONSTRAINT inspection_sheet_responses_month_check CHECK (month BETWEEN 0 AND 12);

-- 기존 외관 응답 백필 — 그 점검 건의 시작월(문서가 지금까지 찍던 바로 그 달)
UPDATE inspection_sheet_responses r
SET month = EXTRACT(MONTH FROM i.inspection_start_date)::SMALLINT
FROM inspections i
WHERE r.inspection_id = i.id
  AND r.item_code LIKE 'X%'
  AND r.month = 0
  AND i.inspection_start_date IS NOT NULL;

-- 유니크 축 교체 — (건, 항목) → (건, 항목, 월)
ALTER TABLE inspection_sheet_responses
  DROP CONSTRAINT IF EXISTS inspection_sheet_responses_inspection_id_item_code_key;
ALTER TABLE inspection_sheet_responses
  DROP CONSTRAINT IF EXISTS uq_sheet_responses_insp_item_month;
ALTER TABLE inspection_sheet_responses
  ADD CONSTRAINT uq_sheet_responses_insp_item_month UNIQUE (inspection_id, item_code, month);

CREATE INDEX IF NOT EXISTS idx_sheet_responses_insp_month
  ON inspection_sheet_responses(inspection_id, month);

-- ────────────────────────────────────────────────────────────────────────────────
-- 126_annex_inputs_exterior.sql
-- ────────────────────────────────────────────────────────────────────────────────
-- 126: annex_inputs에 외관점검표(exterior) 허용 — 소방계획서_19 EX-2
--
-- 배경: 별지 9·10·11호만 ③ 서식 고유 값 계층을 가졌고 외관점검표는 없었다. 그래서 점검일·비고를
-- 수기로 보정할 경로가 아예 없었다(자동값이 틀려도 고칠 수 없음).
-- 112의 CHECK가 세 서식만 허용하므로, 앱 화이트리스트만 열면 upsert가 CHECK 위반으로 조용히 실패한다.
ALTER TABLE annex_inputs DROP CONSTRAINT IF EXISTS annex_inputs_annex_no_check;
ALTER TABLE annex_inputs ADD CONSTRAINT annex_inputs_annex_no_check
  CHECK (annex_no IN ('report9', 'report10', 'report11', 'exterior'));

-- ────────────────────────────────────────────────────────────────────────────────
-- 127_manager_appointment_default.sql
-- ────────────────────────────────────────────────────────────────────────────────
-- 127: 선임 형태 기본값 '업무대행감독' + 기존 미입력 백필 (소방계획서_19 A9-4 입력 개선)
-- 전 고객이 업무대행 계약(19 Q-3 confirmed)이라 '업무대행감독'이 사실과 일치 — 2026-08-12 사용자 확정
-- ("일괄 백필 + 신규 기본값" 채택). 예외 고객(겸직·자격자 등)은 계획서 정보 패널에서 수동 수정.
-- 값은 124의 CHECK 5종(소방기술자격·소방안전관리자수첩·업무대행감독·겸직·기타)에 포함된다.

alter table customers alter column manager_appointment_type set default '업무대행감독';

update customers
set manager_appointment_type = '업무대행감독'
where manager_appointment_type is null;

COMMIT;

-- ── 적용 후 확인 (COMMIT 뒤 따로 실행) ──────────────────────────────────────────
-- SELECT
--   (SELECT count(*) FROM information_schema.columns WHERE table_name='customers' AND column_name='manager_appointment_type') AS m124,
--   (SELECT count(*) FROM customers WHERE manager_appointment_type IS NULL)                                                   AS null_남음_0이어야,
--   (SELECT count(*) FROM information_schema.tables  WHERE table_name='plan_text_library')                                    AS m119,
--   (SELECT count(*) FROM information_schema.tables  WHERE table_name='fire_plan_revisions')                                  AS m120,
--   (SELECT count(*) FROM information_schema.columns WHERE table_name='company_profile' AND column_name='management_reg_no')  AS m123,
--   (SELECT count(*) FROM information_schema.columns WHERE table_name='inspection_sheet_responses' AND column_name='month')   AS m125;
