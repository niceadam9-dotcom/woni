-- 163: 소방안전관리 업무대행 여부·등급 (서식 1.1 21행 / 서식 1.8 대행여부)
--
-- 배경: 이 축을 재는 데이터가 **어디에도 없었다**.
--   · 서식 1.1의 「해당 / 해당없음」은 값 축이 `company_profile.company_name`이 비었는지로 대신
--     재고 있었는데, 그건 우리 회사 이름이라 항상 채워져 있다 → 전 고객이 `■ 해당`으로 인쇄됨.
--   · 서식 1.8의 상자 6개(해당없음·해당·1급·2급·3급·공공기관)는 앵커가 아예 없어 **영영 빈 □**.
--   · PDF는 `■ 해당`을 글자로 박아 두어 반대 방향으로 틀려 있었다.
--
-- 대상물 급수(`building_grade`)를 재사용하지 않는 이유: **다른 축**이다. 급수는 특급/1·2·3급이고
-- 서식 1.8은 1·2·3급/공공기관이다(특급은 업무대행 대상이 아니고, 공공기관은 급수에 없다).
-- 한 컬럼에 두 뜻을 담으면 한쪽을 고칠 때 다른 쪽이 조용히 따라 움직인다.
--
-- NULL의 뜻: **미입력**이지 '해당없음'이 아니다. 화면·문서 모두 미입력이면 상자를 둘 다 비운다.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS agency_applies BOOLEAN;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS agency_grade   TEXT;

COMMENT ON COLUMN customers.agency_applies IS
  '소방안전관리 업무대행 여부(서식 1.1 21행·1.8 대행여부). TRUE=해당 / FALSE=해당없음 / NULL=미입력. '
  'FALSE면 서식 1.8의 업체현황·계약사항 칸을 비운다(서식 원문 "(아래 내용 작성 생략)").';

COMMENT ON COLUMN customers.agency_grade IS
  '업무대행 등급(서식 1.8): 1급/2급/3급/공공기관. 대상물 급수(building_grade)와 다른 축 — '
  '거기엔 특급이 있고 공공기관이 없다. agency_applies가 TRUE일 때만 인쇄된다.';

-- ── 백필 ────────────────────────────────────────────────────────────────────────
-- 종전 동작은 사실상 「전 고객 해당」이었다(위 배경 참조). 그대로 TRUE로 옮겨 심는다 —
-- 여기서 NULL로 두면 컬럼이 생긴 순간 서식 1.1의 체크가 전건 사라져 **없던 회귀**가 생긴다.
-- 틀린 고객은 화면에서 「해당없음」으로 고치면 된다(그 경로가 이번에 처음 생긴다).
UPDATE customers SET agency_applies = TRUE WHERE agency_applies IS NULL;

-- 신규 고객도 같은 자리에서 출발한다. 기본값이 없으면 **오늘 등록한 고객만** 상자가 빈 채로
-- 인쇄되어 같은 신고가 되돌아온다(백필과 같은 근거로 TRUE). 코드는 여전히 NULL을 미입력으로
-- 다루므로(`lib/agency-status`), 기본값을 나중에 떼도 문서가 허위 「해당없음」을 찍지 않는다.
ALTER TABLE customers ALTER COLUMN agency_applies SET DEFAULT TRUE;

-- 등급은 겹치는 갈래(1·2·3급)만 대상물 급수에서 옮긴다. 특급은 업무대행 대상이 아니므로
-- 옮기지 않고 비워 둔다 — 추측으로 찍으면 법정 서식에 없는 사실이 인쇄된다.
UPDATE customers SET agency_grade = building_grade
 WHERE agency_grade IS NULL AND building_grade IN ('1급', '2급', '3급');
