-- 126: annex_inputs에 외관점검표(exterior) 허용 — 소방계획서_19 EX-2
--
-- 배경: 별지 9·10·11호만 ③ 서식 고유 값 계층을 가졌고 외관점검표는 없었다. 그래서 점검일·비고를
-- 수기로 보정할 경로가 아예 없었다(자동값이 틀려도 고칠 수 없음).
-- 112의 CHECK가 세 서식만 허용하므로, 앱 화이트리스트만 열면 upsert가 CHECK 위반으로 조용히 실패한다.
ALTER TABLE annex_inputs DROP CONSTRAINT IF EXISTS annex_inputs_annex_no_check;
ALTER TABLE annex_inputs ADD CONSTRAINT annex_inputs_annex_no_check
  CHECK (annex_no IN ('report9', 'report10', 'report11', 'exterior'));
