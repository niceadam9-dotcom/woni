-- 161: 계획 항목 전건 확정 백필 — 점검계획일=점검확정일 (2026-09-12 사용자 결정)
--
-- 확정 절차(점검확정 화면) 폐지의 데이터 축. 코드 축은 같은 커밋의
-- inspection-plan-generator.ts(생성 즉시 전건 confirmed)·reconcile-special-slots.ts·
-- customers/actions.ts(_resetPlanItemsForCustomer 전건 동행)가 담당한다.
--
-- 종전 체계(2026-07-14): 정기(monthly)만 생성 즉시 자동 확정(089), 특별점검(special_*)은
-- planned로 태어나 사람이 점검확정 화면에서 날짜를 골라 확정했다. 이제 특별점검도
-- 기산일 규칙 날짜(planned_date)를 그대로 확정일로 받는다.
--
-- scheduled_date가 이미 있는 planned 행(날짜 입력 후 확정 해제된 건)은 그 값을 보존하고,
-- 없는 행만 planned_date로 채운다. planned_date까지 없는 퇴화 행(기산일 없던 시절 잔재)은
-- 날짜 없이 confirmed가 된다 — 화면에서 인라인 달력으로 채우는 기존 경로가 그대로 있다.
--
-- 단계 마감일(step1~6_date)은 여기서 계산하지 않는다 — 점검 시작 경로
-- (confirmPlanItemStageOneAction)가 시작 시점 공휴일 표 기준으로 계산하는 것이 정본이고,
-- SQL로 복제하면 두 사본이 어긋난다(add_working_days 규칙 드리프트 전례: 050).
--
-- 멱등: planned가 0건이면 아무것도 하지 않는다. 재실행 안전.
--
-- ⚠ enum plan_item_status에서 'planned' 값 자체를 지우는 것은 이 마이그레이션이 아니다 —
--   화면·코드의 planned 참조가 전부 걷힌 뒤 별도 마이그레이션(5단계)에서 한다.

UPDATE inspection_plan_items
   SET status         = 'confirmed',
       scheduled_date = COALESCE(scheduled_date, planned_date)
 WHERE status = 'planned';
