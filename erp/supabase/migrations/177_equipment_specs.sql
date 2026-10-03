-- 177: 설비 대장 개체 제원(통합계획 C3 4단계, 2026-10-03)
--
-- 첫 소비처: 펌프 명판 → 별지 4호 「※ 펌프성능시험(펌프 명판 및 설계치 참조)」 적정 여부 2
--   「정격운전 시 토출량과 토출압이 규정치 이상일 것」의 규정치. 지금은 시스템에 없어 사람이 판정한다(lib/pump-test.ts).
--   펌프 행 specs = { pump_sheet_no: 2|3|4|5|6|7|8|13, pump_kind: '주'|'예비', rated_flow_lpm: number, rated_head_m: number }
-- 품목마다 제원이 달라(펌프 명판·가스용기 각인·감지기 형식…) 열을 늘리지 않고 JSONB 한 칸으로 둔다.
-- 비파괴·멱등: ADD COLUMN IF NOT EXISTS + 기본값 '{}'(기존 행은 빈 객체 — 판정은 종전대로 수동).

ALTER TABLE equipment_assets ADD COLUMN IF NOT EXISTS specs JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN equipment_assets.specs IS
  '품목별 제원(177, C3 4단계). 펌프: pump_sheet_no(별지 4호 설비 번호)·pump_kind(주/예비)·rated_flow_lpm(정격 토출량 ℓ/min)·rated_head_m(정격 양정 m) — 펌프성능시험 판정 2 규정치';
