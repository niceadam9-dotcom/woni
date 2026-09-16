-- 165 계단을 종류별로 — 서식 1.1 15~16행의 네 상자를 건물이 직접 들고 있게 한다 (2026-09-16)
--
-- ■ 왜
--   서식 1.1 15~16행은 `☐특별피난계단 ☐직통계단 ☐피난계단 ☐옥외계단` 네 상자인데, 그 값의 원천이
--   **건물이 아니라 소방계획서 1.5 탭의 JSON**(`fire_plan_forms.sections.evacFire.stairs`)이었다.
--   같은 「계단」을 세 화면이 나눠 들고 있었다:
--     · 건물·시설 탭        `buildings.stairs_count`            (별지 9호 2쪽 「직통(또는 피난계단)」)
--     · 소방계획서 정보 패널  같은 컬럼을 덮어씀                    (fire-plan-info-actions.ts)
--     · 1.5 피난·방화시설 탭  `evacFire.stairs` 종류→개소 JSON       (서식 1.1 15~16행)
--   갈라진 결과가 **실제 인쇄 불일치**로 나와 있었다(2026-09-16 스테이징 실측):
--     송학떡집·별그리다 — 서식 1.1엔 특별피난계단이 ☑인데 별지 9호 2쪽은 공란.
--     별지 9호의 특별피난계단 원천(`customer_facility_specs.s38_activity.smoke_lobby.stair_count`)은
--     **306명 중 0명**이다(s38 행 2건 모두 `smoke_lobby` 자체가 없다). 즉 구조적으로 빈 축이었다.
--
-- ■ 무엇을
--   종류별 개소 네 컬럼을 buildings에 세워 **건물이 유일 원천**이 되게 한다.
--
--   ⚠ `stairs_count`는 **지우지 않는다.** 별지 9호 법정 서식은 `☐직통(또는 피난계단) (N 개소)`
--     **한 행**이라 그 합계가 진짜로 필요한 모양이다(doc-templates/report9.ts). 앞으로 이 컬럼은
--     사람이 적는 칸이 아니라 **직통+피난의 파생 저장**이다 — 폼이 저장할 때 함께 쓴다.
--     덕분에 이 값을 읽는 네 곳(report9.ts:487 · xlsx-workbook.ts:216·327 · fire-plan-template.ts)은
--     한 줄도 안 고친다. 회귀 면적을 「인쇄 4표면」에서 「저장 2표면」으로 줄이려는 의도다.
--
--   ⚠ 특별피난계단도 컬럼을 만든다. 종전 설계는 「세부제원 3-8이 유일 원천」이었는데 위 실측이
--     그 전제를 뒤집었다. 3-8은 **폐지하지 않고 폴백으로 격하**한다(값이 생기면 여전히 읽되
--     건물 값이 이긴다) — 쓰는 사람이 없을 뿐 규칙 자체가 틀린 것은 아니기 때문이다.

ALTER TABLE buildings
  ADD COLUMN IF NOT EXISTS stair_direct_count  INTEGER,
  ADD COLUMN IF NOT EXISTS stair_escape_count  INTEGER,
  ADD COLUMN IF NOT EXISTS stair_special_count INTEGER,
  ADD COLUMN IF NOT EXISTS stair_outdoor_count INTEGER;

COMMENT ON COLUMN buildings.stair_direct_count  IS '직통계단 개소 — 서식 1.1 AJ15. 별지 9호 합계(stairs_count)의 피가산항';
COMMENT ON COLUMN buildings.stair_escape_count  IS '피난계단 개소 — 서식 1.1 L16. 별지 9호 합계(stairs_count)의 피가산항';
COMMENT ON COLUMN buildings.stair_special_count IS '특별피난계단 개소 — 서식 1.1 L15 · 별지 9호 2쪽. 세부제원 3-8 전실은 이제 폴백';
COMMENT ON COLUMN buildings.stair_outdoor_count IS '옥외계단 개소 — 서식 1.1 AJ16. 별지 9호엔 칸이 없다';
COMMENT ON COLUMN buildings.stairs_count        IS '직통+피난 합계(파생 저장) — 별지 9호 2쪽 「직통(또는 피난계단)」 한 행이 이 모양을 요구한다. 사람이 직접 적는 칸이 아니다';

-- ── 백필 ────────────────────────────────────────────────────────────────────
--  1.5 탭에 값이 있으면 그것을, 없으면 기존 `stairs_count`를 직통에 보수적으로 귀속한다.
--
--  ⚠ **활성 건물이 정확히 1동인 고객에만** 적용한다. `evacFire.stairs`는 고객 단위 JSON이라
--    어느 동의 계단인지 말하지 않는다 — 여러 동에 같은 값을 복사하면 없는 사실을 지어내는 셈이다.
--    2026-09-16 실측에서 대상 5명이 **전원 1동**이라 이 가드는 아무도 떨구지 않는다.
--    (떨어지는 고객이 생기면 그건 조용히 넘길 일이 아니라 사람이 봐야 할 일이다.)
--
--  ⚠ `'0'`은 0으로 들어간다 — 그리고 새 판정은 **개소>0일 때만 체크**다. 송학떡집의
--    `옥외계단: "0"`은 지금 `!!txt(...)` 판정 탓에 「0개소인데 ☑」로 인쇄되고 있다(서식 1.1 AJ16).
--    이 백필이 그 모순을 끝낸다 — **의도된 인쇄 변화**이지 유실이 아니다.
WITH single AS (
  SELECT b.id, b.customer_id, b.stairs_count
  FROM buildings b
  WHERE COALESCE(b.is_active, true)
    AND (SELECT count(*) FROM buildings b2
         WHERE b2.customer_id = b.customer_id AND COALESCE(b2.is_active, true)) = 1
), src AS (
  SELECT s.id, s.stairs_count,
         -- 숫자만 남긴다. 빈 문자열·비숫자는 NULL(=미설치)로 떨어진다
         NULLIF(regexp_replace(COALESCE(f.sections->'evacFire'->'stairs'->>'직통계단',   ''), '\D', '', 'g'), '')::int AS d,
         NULLIF(regexp_replace(COALESCE(f.sections->'evacFire'->'stairs'->>'피난계단',   ''), '\D', '', 'g'), '')::int AS e,
         NULLIF(regexp_replace(COALESCE(f.sections->'evacFire'->'stairs'->>'특별피난계단', ''), '\D', '', 'g'), '')::int AS sp,
         NULLIF(regexp_replace(COALESCE(f.sections->'evacFire'->'stairs'->>'옥외계단',   ''), '\D', '', 'g'), '')::int AS o
  FROM single s
  LEFT JOIN fire_plan_forms f ON f.customer_id = s.customer_id
)
UPDATE buildings b
--  직통 = 1.5 값이 있으면 그것. 없고 **피난도 없으면** 기존 합계를 직통에 귀속한다
--  (합계는 직통+피난인데 피난을 모르니, 피난이 알려져 있으면 빼기를 하지 않고 비워 둔다 —
--   모르는 것을 지어내지 않는 쪽이 이 서식의 규약이다).
SET stair_direct_count  = COALESCE(src.d, CASE WHEN src.e IS NULL THEN src.stairs_count END),
    stair_escape_count  = src.e,
    stair_special_count = src.sp,
    stair_outdoor_count = src.o
FROM src
WHERE b.id = src.id
  AND (src.d IS NOT NULL OR src.e IS NOT NULL OR src.sp IS NOT NULL OR src.o IS NOT NULL
       OR src.stairs_count IS NOT NULL);

-- 합계를 새 원천에서 다시 세운다 — 이제부터 `stairs_count`는 파생이다.
UPDATE buildings
SET stairs_count = NULLIF(COALESCE(stair_direct_count, 0) + COALESCE(stair_escape_count, 0), 0)
WHERE stair_direct_count IS NOT NULL OR stair_escape_count IS NOT NULL;
