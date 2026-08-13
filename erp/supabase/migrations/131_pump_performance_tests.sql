-- 131: 펌프성능시험 실측치 (2026-08-13, 소방계획서_21 R5-7 후속 / R5-6 선행)
--
-- 배경: 37시트 엑셀(operational_v2026.xlsx)에만 있고 우리 별지 4호 구현에는 없던 데이터가
-- 항목 대조(erp_goal/_대조_엑셀37시트_vs_별지4호.md)에서 확인됐다 — 펌프성능시험 실측표다.
-- 엑셀에만 있던 12개 코드가 전부 각 설비 3면(제어반 + 펌프성능시험)이었고,
-- 별지 4호를 O/X 항목으로만 구현해 둔 탓에 체절·정격·150% 실측 수치를 넣을 자리가 없었다.
-- 엑셀을 먼저 지우면 실측치 기록처가 사라지므로(R5-6 차단 사유) 자리를 먼저 만든다.
--
-- ⚠ 이 표는 우리가 만들어 낸 것이 아니라 **법정 별지 4호 서식에 원래 있는 표**다.
--    (「소방시설 자체점검사항 등에 관한 고시」 별지 제4호서식 — "※ 펌프성능시험(펌프 명판 및 설계치 참조)")
--    옥내소화전(2)·스프링클러(3)·간이스프링클러(4)·물분무(6)·미분무(7)·포소화설비(8) 6개 설비에 붙는다.
--    우리 구현이 그 표를 빠뜨렸던 것이지, 서식에 없는 칸을 신설하는 것이 아니다.
--
-- inspection_sheet_responses에 끼우지 않는 이유: 그 표는 O/X 한 칸 모델이고,
-- 여기는 설비 × 펌프(주/예비) × 3구간 × (토출량·토출압)의 격자다. 형태가 다르다.
-- customer_facility_specs(설비 대장)에 두지 않는 이유: 대장은 '설치 제원'(잘 안 변하는 값)이고
-- 실측치는 '회차마다 다시 재는 값'이다. 대장에 두면 회차별 이력이 남지 않는다.
CREATE TABLE IF NOT EXISTS inspection_pump_tests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id   UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  -- item_code 앞자리와 같은 설비 번호 (2=옥내소화전 · 3=스프링클러 · 4=간이스프링클러
  -- · 6=물분무 · 7=미분무 · 8=포소화설비). 법정 서식에서 이 표가 붙는 6개만 허용한다.
  sheet_no        SMALLINT NOT NULL CHECK (sheet_no IN (2, 3, 4, 6, 7, 8)),
  pump_kind       TEXT NOT NULL CHECK (pump_kind IN ('주', '예비')),

  -- 실측 격자 — 서식의 "토출량(ℓ/min) / 토출압(MPa)" × "체절운전 / 정격운전(100%) / 정격유량의 150% 운전"
  shutoff_flow    NUMERIC,   -- 체절운전 토출량 (통상 0)
  shutoff_press   NUMERIC,   -- 체절운전 토출압
  rated_flow      NUMERIC,   -- 정격운전(100%) 토출량
  rated_press     NUMERIC,   -- 정격운전(100%) 토출압
  over_flow       NUMERIC,   -- 정격유량의 150% 운전 토출량
  over_press      NUMERIC,   -- 정격유량의 150% 운전 토출압

  -- 서식 좌측 "ㅇ설정압력" 블록 — 펌프별 기동·정지 압력
  set_start_press NUMERIC,
  set_stop_press  NUMERIC,

  -- 판정 3건. 값이 있으면 앱이 자동 계산하지만 수동 보정을 남겨 둔다 —
  -- 설계치가 명판과 다르거나 현장 사유가 있을 때 자동 판정만으로는 단정할 수 없다.
  --   judge1 = 체절운전 시 토출압은 정격토출압의 140% 이하일 것
  --   judge2 = 정격운전 시 토출량과 토출압이 규정치 이상일 것
  --   judge3 = 정격토출량의 150%에서 토출압이 정격토출압의 65% 이상일 것
  judge1          TEXT CHECK (judge1 IN ('O', 'X')),
  judge2          TEXT CHECK (judge2 IN ('O', 'X')),
  judge3          TEXT CHECK (judge3 IN ('O', 'X')),
  note            TEXT,

  updated_by      UUID REFERENCES profiles(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 한 점검 건의 한 설비에 주/예비 각 1행 — upsert 키
  UNIQUE (inspection_id, sheet_no, pump_kind)
);

COMMENT ON TABLE inspection_pump_tests IS
  '펌프성능시험 실측치 — 법정 별지 4호서식 "※ 펌프성능시험" 표의 원천. 회차별 측정값이라 설비 대장이 아니라 점검 건에 매단다 (소방계획서_21 R5-7 후속)';

CREATE INDEX IF NOT EXISTS idx_pump_tests_inspection ON inspection_pump_tests(inspection_id);

ALTER TABLE inspection_pump_tests ENABLE ROW LEVEL SECURITY;
-- 읽기는 로그인 사용자, 쓰기는 서버 액션(service role)만 — 권한 판정은 앱의 inspection_manage가 한다.
-- 이 리포의 다른 점검 테이블과 같은 규약이다.
CREATE POLICY "pump_tests_select_all" ON inspection_pump_tests
  FOR SELECT USING (auth.uid() IS NOT NULL);
