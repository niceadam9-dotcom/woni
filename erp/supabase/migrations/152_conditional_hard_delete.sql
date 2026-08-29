-- 152: 조건부 hard delete — 업무 실이력 0건 고객만 물리 삭제 (소방계획서_30 S3, D-2 채택 2026-08-28)
--      2026-08-29 개정 — 독립 판정(소방계획서_32) DEF-1·DEF-4·DEF-6 반영. 아래 '축을 어떻게 골랐나' 참조.
--
-- 왜 DB 함수인가: Supabase JS는 다중문 트랜잭션이 안 된다. 이력 검사와 삭제가 한 트랜잭션에
-- 있어야 모달을 열어둔 사이(사람 시간 척도)에 생긴 새 이력이 유령 삭제를 만들지 못한다.
--
-- ── 축을 어떻게 골랐나 (DEF-1) ────────────────────────────────────────────────
-- 종전에는 '지워지는가'를 묻지 않고 '이력 같은가'를 눈대중으로 골라 13축을 적었다. 그 결과
-- customers를 CASCADE로 참조하는 6표(fire_plans·fire_brigade_members·customer_facility_specs·
-- plan_text_applied·billing_profiles·billing_autopay)가 차단축 밖에 있었고, 소방계획서·자위소방대·
-- 세부현황만 가진 고객이 '업무 이력이 없습니다'로 판정돼 되돌릴 수 없이 사라졌다.
-- 이제 축은 눈대중이 아니라 **customers 참조 FK 전수**에서 뺄셈으로 만든다:
--   customers 직접 참조 FK 21건
--   - 명시 DELETE 2표(inspection_plan_items·buildings) : 등록 시 자동 생성되는 비계
--   - customer_contacts                                 : 등록 화면의 기본정보(관계인)
--   = 나머지 전부가 차단축.
-- buildings를 비계로 두되 그 자식인 설비 대장(fire_facilities·fire_facility_floors)은 차단축이다 —
-- 자동 생성이 아니라 사용자가 [소방시설 현황]에서 직접 저장하는 값이고(saveFacilitiesAction),
-- 점검표의 설치/미설치 판정의 단일 원천이다. buildings 경유라 customer_id가 없어 EXISTS로 센다.
-- fire_plan_attachments는 fire_plans의 2차 폐포 — fire_plan_id NOT NULL FK라 fire_plans가 0이면
-- 함께 0이다. 별도 축을 두지 않는 이유가 이것이며, 축을 좁힐 때 이 전제가 깨지는지 먼저 볼 것.
--
-- 계획 항목 전부를 차단 축으로 삼지 않는 이유: 등록 시 연간 계획이 자동 생성되므로(롤링 생성)
-- 그 축이면 전 고객이 차단돼 기능이 공집합이 된다(가드 영향 실측 원칙). 자동 생성된 미가동
-- 계획(planned/confirmed/cancelled·점검 미연결)은 비계라 함께 지운다.
-- 확대 후 실측(2026-08-29 스테이징 312명): 삭제 가능 93명 → 92명. 공집합도 전건도 아니다.
--
-- 선삭제 2테이블은 FK RESTRICT라 명시 삭제가 필요하고(inspection_plan_items·buildings),
-- 그 자식들은 전부 CASCADE/SET NULL이라 연쇄된다(2026-08-29 스테이징 FK 그래프 실측:
-- buildings <- customer_facility_specs·fire_facilities·fire_facility_floors 전부 CASCADE /
-- inspection_plan_items <- bills SET NULL·inspection_report_status·inspection_status_log CASCADE).
-- customers 직접 참조 21건의 삭제 규칙 실측(DEF-6 — 종전 주석의 'CASCADE 13종'은 사실이 아니었다):
--   CASCADE 13 · RESTRICT 7(bills·buildings·inquiries·inspection_plan_items·inspections·orders·quotes)
--   · SET NULL 1(mobile_documents — 행은 살아남고 customer_id만 NULL이 된다).
--
-- ── 동시성 (DEF-4) ──────────────────────────────────────────────────────────
-- 이 함수는 같은 고객을 겨냥한 hard delete끼리를 advisory 잠금으로 직렬화하고, 대상 행을
-- FOR UPDATE로 잡는다. 다만 **다른 세션의 일반 INSERT를 배제하지는 못한다** — 이력 검사와
-- DELETE 사이(같은 트랜잭션 안, 밀리초 이하)에 커밋된 CASCADE축 행은 저항 없이 함께 지워진다.
-- 종전 주석은 '한 트랜잭션이라 레이스가 유령 삭제를 못 만든다'고 단언했으나 그것은 과장이었다.
-- 실제로 닫힌 것은 사람 시간 척도의 레이스(모달을 열어둔 몇 분 사이)이고, 남은 창은 미검증이다.
CREATE OR REPLACE FUNCTION public.hard_delete_customer(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_code text;
  v_hist jsonb;
  v_blocked boolean;
BEGIN
  -- 같은 고객을 겨냥한 동시 hard delete 직렬화 (트랜잭션 종료 시 자동 해제)
  PERFORM pg_advisory_xact_lock(hashtextextended(p_customer_id::text, 0));

  SELECT customer_name, customer_code INTO v_name, v_code
  FROM customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- ⚠ 아래 축 목록·순서는 actions.ts HISTORY_AXES와 반드시 일치시킬 것(프로브가 대조한다).
  v_hist := jsonb_build_object(
    'inspections',        (SELECT count(*) FROM inspections          WHERE customer_id = p_customer_id),
    'plan_items_real',    (SELECT count(*) FROM inspection_plan_items WHERE customer_id = p_customer_id
                             AND (status = 'completed' OR inspection_id IS NOT NULL)),
    'bills',              (SELECT count(*) FROM bills                WHERE customer_id = p_customer_id),
    'quotes',             (SELECT count(*) FROM quotes               WHERE customer_id = p_customer_id),
    'orders',             (SELECT count(*) FROM orders               WHERE customer_id = p_customer_id),
    'inquiries',          (SELECT count(*) FROM inquiries            WHERE customer_id = p_customer_id),
    'fire_plans',         (SELECT count(*) FROM fire_plans           WHERE customer_id = p_customer_id),
    'fire_plan_forms',    (SELECT count(*) FROM fire_plan_forms      WHERE customer_id = p_customer_id),
    'fire_plan_gen_jobs', (SELECT count(*) FROM fire_plan_gen_jobs   WHERE customer_id = p_customer_id),
    'fire_plan_revisions',(SELECT count(*) FROM fire_plan_revisions  WHERE customer_id = p_customer_id),
    'fire_brigade_members',    (SELECT count(*) FROM fire_brigade_members    WHERE customer_id = p_customer_id),
    'customer_facility_specs', (SELECT count(*) FROM customer_facility_specs WHERE customer_id = p_customer_id),
    'plan_text_applied',       (SELECT count(*) FROM plan_text_applied       WHERE customer_id = p_customer_id),
    -- 설비 대장 — buildings 경유(자식에 customer_id가 없다). 건물 자체는 비계라 세지 않는다.
    'facility_ledger',    (SELECT count(*) FROM buildings            WHERE customer_id = p_customer_id
                             AND (EXISTS (SELECT 1 FROM fire_facilities ff
                                            WHERE ff.building_id = buildings.id)
                               OR EXISTS (SELECT 1 FROM fire_facility_floors fl
                                            WHERE fl.building_id = buildings.id))),
    'billing_profiles',   (SELECT count(*) FROM billing_profiles     WHERE customer_id = p_customer_id),
    'billing_autopay',    (SELECT count(*) FROM billing_autopay      WHERE customer_id = p_customer_id),
    'report_deliveries',  (SELECT count(*) FROM report_deliveries    WHERE customer_id = p_customer_id),
    'sms_send_log',       (SELECT count(*) FROM sms_send_log         WHERE customer_id = p_customer_id),
    'mobile_documents',   (SELECT count(*) FROM mobile_documents     WHERE customer_id = p_customer_id),
    'account_access_log', (SELECT count(*) FROM account_access_log   WHERE customer_id = p_customer_id)
  );

  SELECT bool_or(value::int > 0) INTO v_blocked FROM jsonb_each_text(v_hist);

  IF v_blocked THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'has_history', 'history', v_hist,
                              'name', v_name, 'code', v_code);
  END IF;

  DELETE FROM inspection_plan_items WHERE customer_id = p_customer_id;
  DELETE FROM buildings             WHERE customer_id = p_customer_id;
  DELETE FROM customers             WHERE id = p_customer_id;

  RETURN jsonb_build_object('ok', true, 'name', v_name, 'code', v_code);
END $$;

-- service_role(서버 액션 admin 클라이언트) 전용 — 클라이언트 직접 호출 금지
REVOKE ALL ON FUNCTION public.hard_delete_customer(uuid) FROM public;
REVOKE ALL ON FUNCTION public.hard_delete_customer(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.hard_delete_customer(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.hard_delete_customer(uuid) TO service_role;
