-- 124: 소방안전관리자 선임 형태 (소방계획서_19 B-4d · A9-4, Q-2 확정 2026-08-11 — 고객 마스터 컬럼안)
-- 별지 9호 2쪽 '소방안전관리자' 칸의 선임 형태 5종 체크(소방기술자격·소방안전관리자수첩·업무대행감독·겸직·기타)가
-- 원천 부재로 영구 ☐이던 결함 해소. 고객 고정값이라 점검 건마다 재입력하는 ③ 보정 대신 마스터에 둔다.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS manager_appointment_type TEXT
  CHECK (manager_appointment_type IS NULL
         OR manager_appointment_type IN ('소방기술자격', '소방안전관리자수첩', '업무대행감독', '겸직', '기타'));
