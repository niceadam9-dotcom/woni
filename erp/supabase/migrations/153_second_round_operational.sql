-- 153: 종합 대상의 2차 점검을 '작동'으로 — 가드의 축 이동 + 기존 데이터 백필 (소방계획서_33 S1)
--
-- 왜: 종합점검 대상 건물은 사용승인월에 종합(1차), +6개월에 작동(2차)을 한다. 즉 2차는 **법적으로
-- 작동점검**이다. 그런데 002:126 트리거가 `sequence_num=2 AND inspection_type <> '종합'`을
-- RAISE EXCEPTION 하고 있어, 2차를 '작동'으로 저장하는 것 자체가 DB에서 거부돼 왔다.
-- 그래서 생성기는 2차를 special_종합으로 만들었고, 별지 9호 체크박스·표지 제목·갑지 A2·점검표
-- 범위가 전부 2차를 종합으로 인쇄했다. 표시 문구가 아니라 **가드가 잘못된 축에 걸려 있는** 문제다.
--
-- 축 이동: '점검 행의 inspection_type이 종합인가' → '고객이 종합 대상인가'.
-- 작동 전용 고객의 2차 생성은 계속 차단된다(가드를 없애는 게 아니라 옮기는 것 — D33-4).
-- inspection_plan_items에는 트리거를 걸지 않는다: 작동 고객에 seq2+monthly를 만드는 정상
-- 픽스처가 최소 4곳 있어 그 축에 가드를 걸면 멀쩡한 경로가 죽는다.
--
-- 순서가 강제된다: 002:137 트리거가 BEFORE INSERT **OR UPDATE**라, 구 함수를 둔 채 백필하면
-- 백필 UPDATE 전건이 EXCEPTION으로 죽는다. 함수 교체가 반드시 먼저다.
-- TRIGGER는 재생성하지 않는다 — 트리거는 함수 이름으로 묶여 있어 함수 본문 교체만으로 충분하다.
--
-- 한글 리터럴 표기 규약: **비교 술어는 U&'...' 이스케이프로만** 쓴다. 전송 과정에서 인코딩이
-- 깨지면 한글 비교는 에러 없이 조용히 0건이 되어(가드가 무력화되고 백필이 아무 행도 안 고치는데
-- 성공으로 보인다) 실패를 알아챌 수 없다. 주석과 RAISE 메시지는 깨져도 결과가 틀리지 않으므로
-- 기존 마이그레이션 관례대로 한글을 그대로 쓴다.
--   U&'\C885\D569'           = 종합
--   U&'\C791\B3D9'           = 작동
--   U&'\C77C\BC18\AD00\B9AC' = 일반관리
--
-- 적용 전 실측(2026-08-29, scripts/_probe-33-measure.mjs):
--   스테이징 — plan_items seq2 166건(전부 special_종합, 그중 일반관리 고객 1건) /
--              inspections seq2 16건(전부 special_종합, plan_type NULL 0건) /
--              그 16건에 달린 inspection_sheet_responses **0건**(점검표 범위 축소의 소급 피해 없음)
--   운영     — plan_items seq2 2건 / inspections seq2 0건
--   양쪽 모두 '고객이 종합 대상이 아닌 seq2' 0건 → 새 가드로 바꿔도 기존 데이터는 한 건도 안 걸린다.

-- ────────────────────────────────────────────────────────────────
-- 1. 가드의 축 이동 (백필보다 반드시 먼저)
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_inspection_sequence()
RETURNS TRIGGER AS $$
DECLARE
  v_is_comprehensive boolean;
BEGIN
  IF NEW.sequence_num = 2 THEN
    -- 고객 축으로 판정한다. sub_type이 정본이고, 미보유 레거시 고객만 inspection_type으로 폴백한다
    -- (생성기 inspection-plan-generator.ts:93-95의 유도식과 같은 술어).
    SELECT c.inspection_sub_type = U&'\C885\D569'
           OR (c.inspection_sub_type IS NULL AND c.inspection_type = U&'\C885\D569')
      INTO v_is_comprehensive
      FROM customers c
     WHERE c.id = NEW.customer_id;

    -- 고객을 못 찾으면(NULL) 차단한다 — FK상 발생하지 않지만 '모르면 통과'로 새지 않게 못박는다.
    IF v_is_comprehensive IS NOT TRUE THEN
      RAISE EXCEPTION 'sequence_num=2(2차 점검)는 종합점검 대상 고객에게만 허용됩니다 (customer_id=%)', NEW.customer_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_inspection_sequence() IS
  '2차 점검은 종합점검 대상 고객에게만 허용 (소방계획서_33 D33-4). '
  '판정 축은 점검 행의 유형이 아니라 고객의 종합 여부 — 2차 행 자체는 작동점검이므로 '
  '점검 행 유형으로 판정하면 법적으로 옳은 데이터가 거부된다.';

-- ────────────────────────────────────────────────────────────────
-- 2. 백필 전 계측 (ASCII 술어로만 — 한글이 깨져도 수치는 정확하다)
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_pi_before  integer;
  v_ins_before integer;
BEGIN
  SELECT count(*) INTO v_pi_before FROM inspection_plan_items
   WHERE sequence_num = 2 AND plan_type LIKE 'special\_%' AND plan_type <> 'special_' || U&'\C791\B3D9';
  SELECT count(*) INTO v_ins_before FROM inspections
   WHERE sequence_num = 2 AND plan_type LIKE 'special\_%' AND plan_type <> 'special_' || U&'\C791\B3D9';
  RAISE NOTICE '[153] backfill targets BEFORE: plan_items=%, inspections=%', v_pi_before, v_ins_before;
END $$;

-- ────────────────────────────────────────────────────────────────
-- 3. 백필 — plan_items 먼저(트리거 없음), inspections 나중
-- ────────────────────────────────────────────────────────────────
-- plan_type LIKE 'special\_%' 한정: monthly/event의 seq2는 건드리지 않는다(작동 고객의 정상 데이터).
--   ('\_'는 Postgres LIKE의 기본 이스케이프 — 밑줄 리터럴이지 임의 1문자가 아니다.)
-- 일반관리 고객의 행은 inspection_type='일반관리'를 유지한다: 그 컬럼이 이 행들에서는 점검의
-- 성격이 아니라 **관리유형 축**을 나르고 있어서, '작동'으로 덮으면 관리유형 정보가 사라진다.
-- (스테이징에 실제로 해당 행 1건이 있다 — 가상의 분기가 아니다.)
UPDATE inspection_plan_items
   SET plan_type           = 'special_' || U&'\C791\B3D9',
       inspection_sub_type = U&'\C791\B3D9',
       inspection_type     = CASE WHEN inspection_type = U&'\C77C\BC18\AD00\B9AC'
                                  THEN inspection_type
                                  ELSE U&'\C791\B3D9' END
 WHERE sequence_num = 2
   AND plan_type LIKE 'special\_%'
   AND plan_type <> 'special_' || U&'\C791\B3D9';

-- inspections에는 inspection_sub_type·inspection_category 컬럼이 **없다**(2026-08-29 실측).
-- 관리유형은 고객 축에만 있으므로 여기서는 inspection_type·plan_type 2컬럼만 고친다.
-- 088:91 uq_inspections_special_year_seq는 (customer_id, year, sequence_num) 키에
-- `plan_type NOT IN ('monthly','event')` 부분 조건이라, special_종합→special_작동은
-- 키 컬럼도 조건 소속도 바꾸지 않는다 → 충돌 없음.
UPDATE inspections
   SET plan_type       = 'special_' || U&'\C791\B3D9',
       inspection_type = CASE WHEN inspection_type = U&'\C77C\BC18\AD00\B9AC'
                              THEN inspection_type
                              ELSE U&'\C791\B3D9' END
 WHERE sequence_num = 2
   AND plan_type LIKE 'special\_%'
   AND plan_type <> 'special_' || U&'\C791\B3D9';

-- ────────────────────────────────────────────────────────────────
-- 4. 백필 후 검증 — 남은 게 있으면 마이그레이션을 실패시킨다
-- ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_pi_left  integer;
  v_ins_left integer;
  v_orphan   integer;
BEGIN
  SELECT count(*) INTO v_pi_left FROM inspection_plan_items
   WHERE sequence_num = 2 AND plan_type LIKE 'special\_%' AND plan_type <> 'special_' || U&'\C791\B3D9';
  SELECT count(*) INTO v_ins_left FROM inspections
   WHERE sequence_num = 2 AND plan_type LIKE 'special\_%' AND plan_type <> 'special_' || U&'\C791\B3D9';

  -- 새 가드의 술어를 결과 축에서도 확인 — 종합 대상이 아닌 고객의 2차가 남아 있으면 안 된다.
  SELECT count(*) INTO v_orphan
    FROM inspections i JOIN customers c ON c.id = i.customer_id
   WHERE i.sequence_num = 2
     AND NOT (c.inspection_sub_type = U&'\C885\D569'
              OR (c.inspection_sub_type IS NULL AND c.inspection_type = U&'\C885\D569'));

  RAISE NOTICE '[153] AFTER: plan_items_left=%, inspections_left=%, non_comprehensive_seq2=%',
    v_pi_left, v_ins_left, v_orphan;

  IF v_pi_left <> 0 OR v_ins_left <> 0 THEN
    RAISE EXCEPTION '[153] backfill incomplete: plan_items=%, inspections=%', v_pi_left, v_ins_left;
  END IF;
END $$;
