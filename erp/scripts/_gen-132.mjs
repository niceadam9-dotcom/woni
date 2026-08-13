// 마이그레이션 132 생성기 — 검증된 _orphan-items.json에서 SQL을 만든다(손으로 옮겨 적지 않는다).
import { readFileSync, writeFileSync } from 'fs'

const items = JSON.parse(readFileSync('scripts/_orphan-items.json', 'utf8'))
const esc = s => s.replace(/'/g, "''")
const vals = items
  .map(i => `  ('${i.sheetId}', '${i.code}', '${esc(i.name)}', '${i.fac}', ${i.order}, ${i.comprehensive})`)
  .join(',\n')

const sql = `-- 132: 별지 4호 누락 점검항목 12건 편입 + 펌프성능시험 대상 설비 확장
--       (2026-08-13, 소방계획서_21 R5-6 선행 / R5-9 독립검증 V21-1 해소)
--
-- 왜 지금 하는가: R5-6(37시트 엑셀 생성 폐지)의 차단을 푸는 작업이다. R5-7 대조가 "엑셀에만 있고
-- 별지 4호에는 없는 12건"을 찾았는데 항목명이 병합 셀이라 '미추출'로 남아 정체가 불명이었다.
-- 고시 원문(erp_goal/_doc01/[별지 4]…xml)에서 복원해 보니 **전부 법정 실재 점검항목**이었다.
-- 지금 엑셀을 지우면 이 12건이 어디에도 남지 않는다 — 그래서 먼저 편입한다.
--
-- 문구·종합전용(●/○)은 고시 원문에서 기계 추출했고, 추출기를 이미 DB에 있는 항목과 먼저 대조해
-- 검증했다(불일치는 전부 괄호 앞뒤 공백 관습 차이 · 종합전용은 689건 중 1건).
-- 표기는 기존 형제 항목 규약을 따랐다 — 괄호 붙임, 곡선따옴표, \`하고,"…"표지\`.
--   ● = 종합점검에서만(comprehensive_only=true) · ○ = 작동+종합(false)
--
-- ⚠ 구획 통째로 대조해 누락이 이 12건뿐임을 확인했다(2-H·3-K·3-L·13-G, DB 잉여 0).
--    앞서 15건으로 셌던 것은 \`2-H-002\`가 \`12-H-002\` 안에서 잡힌 정규식 오탐이었다.
--
-- 재실행 안전: item_code에는 유니크 제약이 **없다**(024 확인) — ON CONFLICT를 쓸 수 없어
-- 행마다 NOT EXISTS로 거른다. 유니크 인덱스를 새로 걸지 않는 이유는, 기존 830건에 중복이
-- 있으면 인덱스 생성 자체가 실패해 이 마이그레이션이 통째로 막히기 때문이다.

-- ── ① 누락 점검항목 12건 ──────────────────────────────────────────────────────
INSERT INTO inspection_sheet_items
  (sheet_id, item_code, item_name, facility_type, order_num, comprehensive_only)
SELECT v.sheet_id::uuid, v.item_code, v.item_name, v.facility_type, v.order_num::int, v.comprehensive_only::boolean
FROM (VALUES
${vals}
) AS v(sheet_id, item_code, item_name, facility_type, order_num, comprehensive_only)
WHERE NOT EXISTS (
  SELECT 1 FROM inspection_sheet_items x WHERE x.item_code = v.item_code
);

-- ── ② 펌프성능시험 대상 설비 확장 (독립검증 V21-1) ───────────────────────────
-- 131은 표가 붙는 설비를 6개(2·3·4·6·7·8)로 봤으나 **고시 원문 기준 8개**다.
-- _doc01 별지4호 XML과 _form 추출 txt 두 원문이 8개로 일치했고(차이 0), 9회 출현의 직전
-- 항목코드로 귀속까지 확정했다: 2-H-031→2 · 3-L-002→3 · 5-M-001→5 · 6-L-001→6
-- · 7-I-031→7 · 8-L-041→8 · 13-G-041→13 (그리고 '4쪽 중 4쪽' 면→4).
-- 5(화재조기진압용 스프링클러)·13(옥외소화전)이 빠져 있었다 — CHECK가 막아 코드만으론 못 고친다.
ALTER TABLE inspection_pump_tests DROP CONSTRAINT IF EXISTS inspection_pump_tests_sheet_no_check;
ALTER TABLE inspection_pump_tests
  ADD CONSTRAINT inspection_pump_tests_sheet_no_check
  CHECK (sheet_no IN (2, 3, 4, 5, 6, 7, 8, 13));

COMMENT ON COLUMN inspection_pump_tests.sheet_no IS
  'item_code 앞자리 = 설비 번호. 법정 별지 4호서식에서 ※펌프성능시험 표가 붙는 8개(2·3·4·5·6·7·8·13)';
`

writeFileSync('supabase/migrations/132_annex4_missing_items.sql', sql, 'utf8')
console.log(`생성: 132_annex4_missing_items.sql (${sql.length}바이트 · 항목 ${items.length}건)`)
