-- 155: 법정 점검 시기 축 — 기산점 예외 플래그 + 최초점검 판정 출처 (2026-09-01)
--
-- 왜: 법령(시행규칙 [별표 3])은 종합점검을 **사용승인일이 속하는 달**, 작동점검을 그로부터
--     6개월이 되는 달, 최초점검을 **사용승인일부터 60일 이내**의 종합점검으로 정한다.
--     이 앱은 2026-07-14 이후 기산점을 점검계획일만 봤고(법정 월과 무관), 최초점검은
--     "우리 DB에 종합점검 이력이 있는가"로 판정했다 — 2009년 사용승인 건물도 신규 등록하면
--     별지 9호에 [√]최초점검이 찍혔다(법정 서식 허위 기재).
--
-- ⚠ 배포 순서 자유 규약(151·154와 동일): 앱은 두 컬럼을 **관용적으로** 읽는다.
--    · plan_anchor_manual — lib/inspection-plan-generator.ts:fillAnchorFields가 별도·관용 조회로
--      읽고, 실패하면 이후 묻지 않는다. 컬럼이 없으면 resolveAnchor가 **종전 동작**(점검계획일
--      최우선)을 그대로 재현하므로 이 마이그레이션 전에 코드를 배포해도 일정이 한 칸도 안 움직인다.
--    · is_initial_source — INSERT 목록에 넣지 않는다(없는 컬럼이면 INSERT가 통째로 실패한다).
--      적용 후엔 아래 DEFAULT가 같은 값을 준다.
--
-- ⚠ 한글 리터럴 규약(153:18-24): **비교 술어**에는 한글을 쓰지 않는다. 아래 백필은 전부
--    숫자(EXTRACT MONTH)·NULL 축이라 인코딩이 깨져도 술어가 조용히 0건이 되지 않는다.
--
-- ⚠ 이 마이그레이션은 **is_initial 값을 고치지 않는다.** 종전 판정으로 켜진 행이 법령과
--    어긋날 수 있으나, 보정은 목록을 사람이 보고 결정할 일이다(끝의 NOTICE가 규모만 알린다).

-- ── ① 기산점 예외 플래그 ────────────────────────────────────────────
-- true = 사람이 정한 점검계획일을 계속 쓴다 / false = 법정 축(사용승인일)을 탄다
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS plan_anchor_manual BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN customers.plan_anchor_manual IS
  '기산점 예외 — true면 점검계획일을 계속 기산점으로 쓴다(법정 축 사용승인일을 쓰지 않는다)';

-- 백필: **지금 두 날짜의 (월)이 다른 고객만** 예외로 고정한다.
--   그 불일치는 데이터 썩음이 아니라 방문을 열두 달로 분산한 운영 결정이다(스테이징 실측
--   88/246 = 35.8%, 계획일이 2026-01-08·-09·-13처럼 순차로 깔려 있다). 이 백필이 없으면
--   적용 즉시 그 고객들의 연간 일정이 통째로 다른 달로 이동한다.
DO $$
DECLARE v_before integer; v_after integer; v_null_approval integer;
BEGIN
  SELECT count(*) INTO v_before FROM customers
   WHERE use_approval_date IS NOT NULL AND plan_anchor_date IS NOT NULL
     AND EXTRACT(MONTH FROM use_approval_date) <> EXTRACT(MONTH FROM plan_anchor_date);

  UPDATE customers SET plan_anchor_manual = true
   WHERE use_approval_date IS NOT NULL AND plan_anchor_date IS NOT NULL
     AND EXTRACT(MONTH FROM use_approval_date) <> EXTRACT(MONTH FROM plan_anchor_date);

  SELECT count(*) INTO v_after FROM customers WHERE plan_anchor_manual;
  IF v_after < v_before THEN
    RAISE EXCEPTION '기산점 예외 백필 누락: 대상 % 건 중 % 건만 표시됨', v_before, v_after;
  END IF;

  -- 사용승인일이 비어 있는 고객은 예외로 잡히지 않는다 — manual=false지만 resolveAnchor가
  -- 사용승인일 없음을 보고 점검계획일로 폴백하므로 일정은 그대로다. 규모만 알린다.
  SELECT count(*) INTO v_null_approval FROM customers WHERE is_active AND use_approval_date IS NULL;
  RAISE NOTICE '기산점 예외 % 건 고정 / 사용승인일 공백 활성고객 % 건(화면 경고 대상)', v_after, v_null_approval;
END $$;

-- ── ② 최초점검 판정 출처 ────────────────────────────────────────────
-- auto = 법령 자동판정(사용승인일+60일) / manual = 사람이 화면에서 재지정
-- 재계산은 auto 행만 건드린다 — 사람이 고친 값을 자동이 덮으면 안 된다.
ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS is_initial_source TEXT NOT NULL DEFAULT 'auto';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inspections_is_initial_source_chk'
  ) THEN
    ALTER TABLE inspections ADD CONSTRAINT inspections_is_initial_source_chk
      CHECK (is_initial_source IN ('auto', 'manual'));
  END IF;
END $$;

COMMENT ON COLUMN inspections.is_initial_source IS
  '최초점검 판정 출처 — auto=법령 자동판정(사용승인일+60일) / manual=사람이 재지정. 재계산은 auto만 덮는다';

-- ── ③ 진단 (데이터는 고치지 않는다) ──────────────────────────────────
-- 종전 판정("DB에 종합점검 이력 없음 = 최초")으로 켜진 행 중, 법령 기준으로는 최초가 아닌 건수.
-- 보정 여부는 이 수를 보고 사람이 정한다.
DO $$
DECLARE v_wrong integer;
BEGIN
  SELECT count(*) INTO v_wrong
    FROM inspections i JOIN customers c ON c.id = i.customer_id
   WHERE i.is_initial
     AND (c.use_approval_date IS NULL
          OR i.inspection_start_date IS NULL
          OR i.inspection_start_date < c.use_approval_date
          OR i.inspection_start_date > c.use_approval_date + 60);
  RAISE NOTICE '최초점검으로 표시됐으나 법정 60일 창 밖인 점검: % 건 (이 마이그레이션은 고치지 않는다)', v_wrong;
END $$;
