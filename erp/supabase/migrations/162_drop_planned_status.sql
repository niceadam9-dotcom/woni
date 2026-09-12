-- 162: plan_item_status enum에서 'planned' 제거 (2026-09-12 사용자 결정 — 점검계획일=점검확정일)
--
-- 161(전건 confirmed 백필) + 코드 축(생성기·재계산·복귀 경로 전부 confirmed만 기록)이 선행이다.
-- PostgreSQL은 enum 값 삭제를 지원하지 않으므로 타입을 재생성해 교체한다.
-- 이 타입을 쓰는 컬럼은 inspection_plan_items.status 하나뿐이고(005), 이 타입을 참조하는
-- DB 함수·트리거는 없다(050의 create_inspection_steps 등은 inspections 축 — 무관, 실측 grep 0건).
--
-- ⚠ 코드보다 먼저 적용해도 안전하고(코드는 이미 planned를 안 쓴다), 나중에 적용해도
--   안전하다(그 사이 planned를 쓰는 코드가 없다). 단 161보다 먼저는 안 된다 —
--   planned 행이 남아 있으면 아래 USING 캐스팅이 invalid input value로 죽는다.
--   안전망으로 같은 백필을 한 번 더 돈다(멱등).

UPDATE inspection_plan_items
   SET status         = 'confirmed',
       scheduled_date = COALESCE(scheduled_date, planned_date)
 WHERE status = 'planned';

ALTER TABLE inspection_plan_items ALTER COLUMN status DROP DEFAULT;

-- 부분 인덱스가 옛 타입 캐스팅('cancelled'::plan_item_status)을 술어에 물고 있어
-- ALTER TYPE이 42883(operator does not exist)으로 막힌다 — 첫 적용 시도에서 실측(2026-09-12).
-- 지웠다가 타입 교체 후 같은 정의로 재생성한다(028_performance_indexes가 만든 인덱스).
DROP INDEX IF EXISTS idx_plan_items_status_active;

CREATE TYPE plan_item_status_new AS ENUM ('confirmed', 'completed', 'cancelled');

ALTER TABLE inspection_plan_items
  ALTER COLUMN status TYPE plan_item_status_new
  USING status::text::plan_item_status_new;

DROP TYPE plan_item_status;
ALTER TYPE plan_item_status_new RENAME TO plan_item_status;

CREATE INDEX IF NOT EXISTS idx_plan_items_status_active
  ON inspection_plan_items (plan_id, scheduled_date)
  WHERE (status <> 'cancelled');

-- 기본값도 새 체계로 — 생성기는 명시적으로 confirmed를 싣지만, 직접 INSERT하는
-- 경로(수동 SQL 등)가 planned 시절 기본값에 기대지 않도록 명시한다.
ALTER TABLE inspection_plan_items ALTER COLUMN status SET DEFAULT 'confirmed';
