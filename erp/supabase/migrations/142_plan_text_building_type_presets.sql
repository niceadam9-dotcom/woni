-- 142: 공통 수기 프리셋 폐지 → 유형별 문구를 '계획서 공통문구'로 이관 (2026-08-19 사용자 확정)
--
-- 배경: 유형별(주택형·상가형·공장형) 문구는 fire-plans 버킷의 _presets/{유형}.json에 있었고,
-- 생성된 HTML에 find→value를 **문서 전역** 문자열 치환하는 방식이었다. 위험이 셋이었다:
--   (1) 섹션 범위가 없어 '1층 주차장'(6자) 같은 짧은 앵커가 문서 어디든 바꿨다
--   (2) DB에 없는 문구가 인쇄물에만 존재해 화면과 제출 문서가 갈라졌다
--   (3) 고객이 그 칸을 채우면 앵커가 사라져 치환이 조용히 불발됐다
-- 이제 plan_text_library의 대안 항목으로 두고, 사람이 골라 고객 서식에 주입한다.
--
-- 이관 대상은 실제로 저장돼 있던 상가형(_presets/retail.json)의 실효 문구다.
-- 주택형은 전 칸이 양식 기본값과 동일해(실측: 12칸 중 0칸 실효) 옮길 것이 없다 —
-- 아무것도 고르지 않으면 템플릿 기본값이 그대로 인쇄되므로 주택형은 지금과 결과가 같다.
-- 공장형은 파일이 아예 없어 프리셋이 작동한 적이 없다(loadPresetPairs가 빈 배열 반환).
-- 그래도 유형별 문구를 쓰던 의도를 살려 세 유형을 모두 항목으로 넣는다(기본 지정은 하지 않는다).
--
-- ⚠ is_default는 건드리지 않는다. 섹션당 활성 기본은 최대 1개(uq_plan_text_library_default)이고,
--    자동주입 대상이 바뀌면 신규 고객의 문서 내용이 조용히 달라진다. 선택은 사람이 한다.

-- 1.11 훈련·교육 — 시나리오(서식 1.11.3). body는 plan-text-sections.ts training.pick과 같은 모양
INSERT INTO plan_text_library (section_key, title, body, sort_order)
SELECT * FROM (VALUES
  ('training', '상가형 훈련 시나리오',
   '{"scenarioType":"상가형","scenario":"2층 매장 초기화재 — 1. 2층 매장에서 연기발생 / 2. 2층에서 화재발생 구두 및 방송으로 각 매장 전파 / 3. 소화기를 이용하여 화재진압 실시 / 4. 자위소방대 피난유도팀은 피난이 안된 매장·사무실 확인 후 소방서 도착시 통보 / 안내방송: 1층 화재 발생 (영업을 중단하고 최대한 빨리 집결 요함)","details":[]}'::jsonb,
   10),
  ('training', '공장형 훈련 시나리오',
   '{"scenarioType":"공장형","scenario":"생산동 작업장 초기화재 — 1. 작업장에서 연기발생 / 2. 작업장 화재발생 구두 및 방송으로 전 구역 전파 / 3. 소화기를 이용하여 화재진압 실시 및 전원·가스 차단 / 4. 자위소방대 피난유도팀은 작업장·창고 잔류 인원 확인 후 소방서 도착시 통보 / 안내방송: 작업장 화재 발생 (설비 정지 후 최대한 빨리 집결 요함)","details":[]}'::jsonb,
   20)
) AS v(section_key, title, body, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM plan_text_library p WHERE p.section_key = v.section_key AND p.title = v.title);

-- 3.4 피난유도 절차 — 비화재보·화재 시·대피방법 3줄(이번 차수에 falseAlarm·evacMethod 신설)
INSERT INTO plan_text_library (section_key, title, body, sort_order)
SELECT * FROM (VALUES
  ('evacPlan', '상가형 피난유도',
   '{"falseAlarm":"피난 실시 및 건물 앞 주차장 대기 후 오동작 각 매장 전파","procedure":"피난유도자 지시에 따라 각 매장 주 출입구 및 직통계단으로 피난 실시, 피난 늦은 인원은 옥상 대피","evacMethod":"2층 화재 초기에 1층 주 출입구로 대피 및 피난 늦은 자는 옥상으로 대피"}'::jsonb,
   10),
  ('evacPlan', '공장형 피난유도',
   '{"falseAlarm":"피난 실시 및 정문 앞 공터 대기 후 오동작 각 작업장 전파","procedure":"피난유도자 지시에 따라 작업장 비상구 및 직통계단으로 피난 실시, 설비를 정지하고 잔류 인원을 확인한다","evacMethod":"화재 초기에 작업장 비상구로 대피 및 피난 늦은 자는 외부 공터로 대피"}'::jsonb,
   20)
) AS v(section_key, title, body, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM plan_text_library p WHERE p.section_key = v.section_key AND p.title = v.title);

-- 2장 팀별임무 — 초기소화(서식 2.9 '초기소화 방법'의 원천)
INSERT INTO plan_text_library (section_key, title, body, sort_order)
SELECT * FROM (VALUES
  ('brigadeTeams', '상가형 팀별임무(초기소화)',
   '{"extinguish":"소화기 및 옥내소화전을 이용하여 초기 진압 실시"}'::jsonb, 10),
  ('brigadeTeams', '공장형 팀별임무(초기소화)',
   '{"extinguish":"소화기 및 옥내소화전을 이용하여 초기 진압 실시, 위험물은 안전거리 확보"}'::jsonb, 20)
) AS v(section_key, title, body, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM plan_text_library p WHERE p.section_key = v.section_key AND p.title = v.title);

COMMENT ON TABLE plan_text_library IS
  '소방계획서 공통 서술 항목 (서술형 8섹션 — 소방계획서_15_별도라이브러리.md §3-1). 2026-08-19: 폐지된 공통 수기 프리셋의 유형별 문구를 대안 항목으로 흡수';
