-- 156: 무조건 hard delete — 업무 이력이 있어도 전부 함께 삭제 (2026-09-03 사용자 결정)
--
-- 152의 조건부 판정(이력이 있으면 has_history로 차단하고 비활성화 유도)을 폐지한다.
-- 이력 카운트(v_hist)는 계속 만들되 용도가 바뀐다: 차단 → 모달 고지·감사 로그.
-- ⚠ 축 목록·순서는 actions.ts HISTORY_AXES와 계속 일치시킬 것.
--
-- ── 삭제 순서 (FK 삭제 규칙 실측 — 152 주석 DEF-6 + inspection_reports) ──────────
-- customers 직접 참조 21건:
--   RESTRICT 7표(bills·buildings·inquiries·inspection_plan_items·inspections·orders·quotes)
--     → 명시 삭제 필수.
--   SET NULL 1표(mobile_documents) → 명시 삭제하지 않으면 customer_id만 NULL인 고아 행이
--     문서 목록에 영구히 남는다. '모두 삭제' 결정에 따라 함께 지운다.
--   CASCADE 13표 → customers DELETE로 연쇄.
-- RESTRICT 7표의 자식들:
--   inspections <- inspection_reports 만 RESTRICT(002:219)라 점검보다 먼저 지운다.
--     나머지 자식(inspection_steps·action_plans·participants·generated_reports·sheet_responses·
--     doc_timeline·pump_performance_tests·gen_jobs 등)은 전부 CASCADE, inspection_plan_items의
--     inspection_id는 SET NULL(005:46)이나 그 행도 곧이어 지운다.
--   bills <- bill_items CASCADE(009:44).
--   quotes <- orders.quote_id SET NULL(013:40) — orders를 먼저 지워 무의미한 NULL 갱신을 피한다.
--   inspection_plan_items <- inspection_status_log·inspection_report_status CASCADE(006·007),
--     bills.inspection_plan_item_id SET NULL(009) — bills는 이미 지웠다.
--   buildings <- customer_facility_specs·fire_facilities·fire_facility_floors 전부 CASCADE.
--   orders·inquiries·inspection_reports·mobile_documents — 자식 없음(마이그레이션 전수 grep).
--
-- 동시성은 152 그대로: 같은 고객 대상 hard delete끼리 advisory 잠금 직렬화 + FOR UPDATE.
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
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_customer_id::text, 0));

  SELECT customer_name, customer_code INTO v_name, v_code
  FROM customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- 무엇이 지워졌는지 세어 둔다(고지·감사용 — 156부터 차단하지 않는다).
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

  DELETE FROM inspection_reports
   WHERE inspection_id IN (SELECT id FROM inspections WHERE customer_id = p_customer_id);
  DELETE FROM bills                 WHERE customer_id = p_customer_id;
  DELETE FROM inspections           WHERE customer_id = p_customer_id;
  DELETE FROM orders                WHERE customer_id = p_customer_id;
  DELETE FROM quotes                WHERE customer_id = p_customer_id;
  DELETE FROM inquiries             WHERE customer_id = p_customer_id;
  DELETE FROM inspection_plan_items WHERE customer_id = p_customer_id;
  DELETE FROM buildings             WHERE customer_id = p_customer_id;
  DELETE FROM mobile_documents      WHERE customer_id = p_customer_id;
  DELETE FROM customers             WHERE id = p_customer_id;

  RETURN jsonb_build_object('ok', true, 'name', v_name, 'code', v_code, 'history', v_hist);
END $$;

-- service_role(서버 액션 admin 클라이언트) 전용 — 클라이언트 직접 호출 금지 (152와 동일)
REVOKE ALL ON FUNCTION public.hard_delete_customer(uuid) FROM public;
REVOKE ALL ON FUNCTION public.hard_delete_customer(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.hard_delete_customer(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.hard_delete_customer(uuid) TO service_role;
