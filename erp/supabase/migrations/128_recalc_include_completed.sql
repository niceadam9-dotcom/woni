-- 128: recalc_inspection_steps — 완료된 단계도 재계산할 수 있게 (소방계획서_21 R4 잔재 ②, 설계 C1-b)
--
-- 배경: 048/050의 recalc는 `status <> 'completed'` 행만 갱신한다. 버튼을 눌러야만 완료되던 시절엔
-- 완료 단계가 드물어 문제가 드러나지 않았지만, R4(증거 기반 자동 완료) 이후엔 점검표만 채워도
-- 2~4단계가 완료로 올라간다. 그 뒤에 종료일을 고치면 **이미 완료된 단계의 마감일만 낡은 채 남아**
-- 같은 점검 안에서 2단계는 옛 종료일 기준, 5단계는 새 종료일 기준이 되는 모순이 생긴다.
-- 마감일은 "언제 했는가"가 아니라 "언제까지였는가"이므로 기준일이 바뀌면 완료 여부와 무관하게 바뀐다.
--
-- 기본값은 FALSE라 기존 2인자 호출부는 종전과 동일하게 동작한다(종료일 변경 경로만 TRUE를 넘긴다).
-- 기존 2인자 함수는 DROP한다 — 3인자 DEFAULT 판과 공존하면 2인자 호출이 모호해져 오류가 난다.

DROP FUNCTION IF EXISTS recalc_inspection_steps(UUID, DATE);

CREATE OR REPLACE FUNCTION recalc_inspection_steps(
  p_inspection_id UUID,
  p_base_date DATE,
  p_include_completed BOOLEAN DEFAULT FALSE
)
RETURNS void AS $$
DECLARE
  step4_due DATE;
  step5_due DATE;
BEGIN
  step4_due := add_working_days(p_base_date, 15);
  step5_due := step4_due + INTERVAL '9 days'; -- 당일 포함 10일째 (050에서 통일)

  UPDATE inspection_steps SET due_date = add_working_days(p_base_date, 5)
   WHERE inspection_id = p_inspection_id AND step_num = 2
     AND (p_include_completed OR status <> 'completed');
  UPDATE inspection_steps SET due_date = add_working_days(p_base_date, 10)
   WHERE inspection_id = p_inspection_id AND step_num = 3
     AND (p_include_completed OR status <> 'completed');
  UPDATE inspection_steps SET due_date = step4_due
   WHERE inspection_id = p_inspection_id AND step_num = 4
     AND (p_include_completed OR status <> 'completed');
  UPDATE inspection_steps SET due_date = step5_due
   WHERE inspection_id = p_inspection_id AND step_num = 5
     AND (p_include_completed OR status <> 'completed');
  UPDATE inspection_steps SET due_date = add_working_days(step5_due, 10)
   WHERE inspection_id = p_inspection_id AND step_num = 6
     AND (p_include_completed OR status <> 'completed');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION recalc_inspection_steps(UUID, DATE, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION recalc_inspection_steps(UUID, DATE, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION recalc_inspection_steps(UUID, DATE, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION recalc_inspection_steps(UUID, DATE, BOOLEAN) TO service_role;
