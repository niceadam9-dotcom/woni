-- 160: 대표동(is_primary) — 「어느 동이 문서에 인쇄되는가」를 데이터로 만든다
--
-- 배경(2026-09-08 사용자 지적): 종전 규칙은 코드 여섯 군데에 각자 적힌
--   `is_active = true` + `created_at` 오름차순 + `limit(1)` = **등록이 가장 빠른 동**이었다.
-- 규칙 자체는 일관됐지만 이름이 없어서
--   · 사용자는 어느 동의 값이 별지 9호·소방계획서에 실리는지 알 수 없었고
--   · 대표를 바꾸려면 등록 순서를 되돌리는 수밖에 없었다.
--
-- ⭐ 이 마이그레이션은 **값을 바꾸지 않는다.** 백필이 각 고객의 `created_at` 최고참을 고르므로
--    적용 직후의 대표동 = 적용 직전에 인쇄되던 그 동이다. 산출물 변화 0이 설계 목표다.
--
-- ⚠ 코드는 이 컬럼이 **없어도** 동작한다(`lib/primary-building.ts`가 created_at으로 폴백).
--    그래서 적용 전에도 배포할 수 있고, 적용해도 폴백 경로가 죽지 않는다.

ALTER TABLE buildings
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN buildings.is_primary IS
  '대표동 — 별지 9호 2쪽·소방계획서 1.1이 인쇄하는 동. 미지정이면 활성 동 중 created_at 최고참(종전 규칙)';

-- 고객당 대표는 하나뿐. 부분 인덱스인 이유: false는 여럿이어야 하고, 비활성 동은 셈에서 뺀다.
-- (비활성 동이 대표로 남아 있으면 새 대표를 못 세우는 교착이 생긴다)
CREATE UNIQUE INDEX IF NOT EXISTS buildings_one_primary_per_customer
  ON buildings (customer_id)
  WHERE is_primary AND is_active;

-- 백필 — 각 고객의 활성 동 중 created_at 최고참(동률이면 id). 정렬 규칙은
-- `lib/primary-building.ts` sortBuildingsForPrint와 **같아야 한다**: 다르면 적용 순간 대표가
-- 바뀌어 문서가 조용히 달라진다.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY created_at ASC, id ASC) AS rn
    FROM buildings
   WHERE is_active
)
UPDATE buildings b
   SET is_primary = true
  FROM ranked r
 WHERE b.id = r.id AND r.rn = 1 AND NOT b.is_primary;

-- 검증용(수동 실행): 대표가 없거나 둘 이상인 고객은 0이어야 한다
--   SELECT customer_id, COUNT(*) FILTER (WHERE is_primary) AS primaries, COUNT(*) AS active
--     FROM buildings WHERE is_active GROUP BY customer_id HAVING COUNT(*) FILTER (WHERE is_primary) <> 1;
