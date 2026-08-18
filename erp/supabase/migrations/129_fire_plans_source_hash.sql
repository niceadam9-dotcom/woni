-- 129: 소방계획서 원천 해시 (2026-08-12, 소방계획서_21 R2 / #2 D-7)
-- ※ 처음 127로 만들었으나 같은 날 127(선임 형태 기본값)·128(recalc 3인자)이 다른 세션에서 선점돼 129로 옮겼다.
--
-- 배경: 저장된 PDF가 최신인지 판정할 근거가 없었다. fire_plan_forms.updated_at만 보면
-- 고객·건물·시설 대장·자위소방대 변경을 놓치는데, 계획서 내용의 상당 부분이 거기서 온다.
-- 조립 결과(assembleFirePlan)를 해시해 저장하고, 인쇄 시 다시 조립한 해시와 비교한다.
-- 같으면 Gotenberg를 건너뛰고 저장본을 그대로 쓴다.
--
-- NULL = 해시를 남기지 않은 기존 행 → 항상 stale로 보고 첫 인쇄 때 1회 갱신된다.
ALTER TABLE fire_plans ADD COLUMN IF NOT EXISTS source_hash TEXT;

COMMENT ON COLUMN fire_plans.source_hash IS
  '생성 시점 원천 조립 결과의 해시 — 인쇄 시 재조립 해시와 비교해 갱신 여부 판정 (소방계획서_21 R2)';
