// 마이그레이션 134 생성기 — 별지 4호 현행판에서 중분류 213건·대괄호 소제목 379건을 추출해
// SQL을 만든다(손으로 옮겨 적지 않는다 — _gen-132.mjs 선례). 소방계획서_23 S2.
//
// 파싱 규칙은 _probe-extract-annex4-groups.mjs와 동일해야 한다(프로브가 판정, 생성기는 산출).
//   · 헤더 접두를 믿지 않는다 — group_code는 "헤더 다음 첫 항목코드의 접두"(988행 이상치 자동 해소)
//   · 코드 정규식 \d{1,4} — 3557행 29-B-0010 오타를 놓치면 29-B 블록 귀속이 어긋난다(S1-11)
//   · 소제목은 직전 코드 블록에 귀속(324블록 코드수==텍스트수 기계검증 — S1-10)
// 실행: node scripts/_gen-134.mjs   (건수 단언 실패 시 파일을 쓰지 않고 종료)
import { readFileSync, writeFileSync } from 'fs'

const SRC = 'F:\\AI\\ERP\\erp_goal\\_form\\_별지4호_현행판_추출.txt'
const HEADER = /^(\d{1,2})-([A-Z])\.\s*(\S.*)$/
const CODE_LINE = /^(\d{1,2})-([A-Z])-(\d{1,4})$/
const BRACKET = /^\[([^\]]*)\]$/
const TEXT_LINE = /^[○●]\s*\S/

const lines = readFileSync(SRC, 'utf8').split(/\r?\n/)

// ── 중분류 213건 (프로브 extractGroups와 동일) ──
const groups = []
let pending = null
for (const raw of lines) {
  const t = raw.trim()
  const h = t.match(HEADER)
  if (h) { pending = { name: h[3].trim() }; continue }
  if (!pending) continue
  const c = t.match(CODE_LINE)
  if (c) { groups.push({ ...pending, code: `${parseInt(c[1], 10)}-${c[2]}` }); pending = null }
}
const seqByFac = new Map()
for (const g of groups) {
  const fac = parseInt(g.code, 10)
  g.order = (seqByFac.get(fac) ?? 0) + 1
  seqByFac.set(fac, g.order)
}

// ── 소제목 379건 (프로브 S1-9~13과 동일한 블록 분해) ──
const toks = []
for (const raw of lines) {
  const t = raw.trim()
  let m
  if (t.match(HEADER)) { toks.push({ k: 'H' }); continue }
  if ((m = t.match(CODE_LINE))) {
    toks.push({ k: 'C', code: `${parseInt(m[1], 10)}-${m[2]}-${String(parseInt(m[3], 10)).padStart(3, '0')}`, pfx: `${parseInt(m[1], 10)}-${m[2]}` })
    continue
  }
  if ((m = t.match(BRACKET))) { if (m[1].trim()) toks.push({ k: 'B', name: m[1].trim() }); continue }
  if (TEXT_LINE.test(t)) toks.push({ k: 'T' })
}
const subRows = []
const subSeqByGroup = new Map()
for (let i = 0; i < toks.length;) {
  if (toks[i].k !== 'C') { i++; continue }
  const codes = []; while (i < toks.length && toks[i].k === 'C') codes.push(toks[i++])
  const subs = []; while (i < toks.length && toks[i].k === 'B') subs.push(toks[i++])
  while (i < toks.length && toks[i].k === 'T') i++
  if (!subs.length) continue
  const g = codes[0].pfx
  const n = (subSeqByGroup.get(g) ?? 0) + 1
  subSeqByGroup.set(g, n)
  for (const c of codes) subRows.push({ code: c.code, name: subs[0].name, order: n })
}

// 건수 단언 — 프로브(2026-08-14 실행 213·379·이상치 2)와 어긋나면 원천이 바뀐 것이므로 중단
if (groups.length !== 213) { console.error(`중분류 ${groups.length} ≠ 213 — 중단`); process.exit(1) }
if (subRows.length !== 379) { console.error(`소제목 귀속 ${subRows.length} ≠ 379 — 중단`); process.exit(1) }

const esc = s => s.replace(/'/g, "''")
const groupVals = groups.map((g, i) => `  ('${g.code}', '${esc(g.name)}', ${g.order})${i === groups.length - 1 ? '' : ','}`).join('\n')
const subVals = subRows.map((r, i) => `  ('${r.code}', '${esc(r.name)}', ${r.order})${i === subRows.length - 1 ? '' : ','}`).join('\n')

const sql = `-- 134: 점검표 3층 축 신설 — 중분류(group_*) 3컬럼 + 대괄호 소제목(subgroup_*) 2컬럼
--      (2026-08-14, 소방계획서_23 S2 — 원천 erp_goal/_form/_별지4호_현행판_추출.txt, 고시 XML 교차 diff 0)
--
-- 왜: 법정 점검번호는 3단(설비 1 / 단위구분 1-A / 항목 1-A-001)인데 DB에는 중분류가 item_code
-- 문자열 안에만 있고 이름이 없다 — 화면 그룹 헤더가 '1-A' 코드로만 떴다(P-1). 대괄호 소제목
-- ([주거용 주방 자동소화장치] 등, 반각 [ U+005B)은 축 자체가 없었다(G-1·Q-13).
--
-- 생성: scripts/_gen-134.mjs (기계 추출 — 검증은 scripts/_probe-extract-annex4-groups.mjs 실패 0).
-- 이상치 2건은 규칙으로 흡수했다: 988행 헤더 '3-C.'는 후속 코드 4-C-001의 접두를 채택,
-- 3557행 '29-B-0010'(4자리 오타)은 \\d{1,4} 정규식 + padStart 정규화로 29-B-010에 귀속.
-- 구분자는 위치별 원천 축자(P-8 — U+318D·U+2024·U+2027 혼재, 전역 치환 금지, 133 선례).
--
-- 재실행 안전: ADD COLUMN IF NOT EXISTS + UPDATE는 같은 값 재기록이라 멱등.
-- ⚠ seed 재실행 방어: seed-inspection-sheets.mjs를 함께 정정하지 않으면 재실행 한 방에
--    이 컬럼들이 NULL로 돌아간다(소방계획서_23 R-9 — S3A에서 seed도 정정한다).

-- ── 컬럼 ──────────────────────────────────────────────────────────────────────
ALTER TABLE inspection_sheet_items
  ADD COLUMN IF NOT EXISTS group_code text,
  ADD COLUMN IF NOT EXISTS group_name text,
  ADD COLUMN IF NOT EXISTS group_order int,
  ADD COLUMN IF NOT EXISTS subgroup_name text,
  ADD COLUMN IF NOT EXISTS subgroup_order int;

COMMENT ON COLUMN inspection_sheet_items.group_code IS '중분류(단위구분) — STD는 코드 접두(1-A), EXT/MU는 서식 구분란. 소방계획서_23 134';
COMMENT ON COLUMN inspection_sheet_items.group_name IS '중분류 이름 — STD는 별지4호 헤더 제목(1-A. 뒤 텍스트), EXT/MU는 group_code와 동일';
COMMENT ON COLUMN inspection_sheet_items.group_order IS 'STD: 설비 내 등장 순번(1~) / EXT·MU: MIN(order_num) — 시트 안 중분류 정렬';
COMMENT ON COLUMN inspection_sheet_items.subgroup_name IS '대괄호 소제목(3층) — 원문 반각 [ ] 안 텍스트. NULL = 소제목 없는 구간(다수)';
COMMENT ON COLUMN inspection_sheet_items.subgroup_order IS '중분류 안 소제목 블록 순번(1~) — NULL이면 소제목 없음';

-- ── ① STD: group_code = 코드 접두 (결정적 파생) ──────────────────────────────
UPDATE inspection_sheet_items
SET group_code = regexp_replace(item_code, '-[0-9]+$', '')
WHERE item_code ~ '^[0-9]{1,2}-[A-Z]-[0-9]{1,3}$';

-- ── ② EXT/MU: group_code = facility_type (G-5 실측 — EXT 54종·MU 5종, NULL 0) ─
UPDATE inspection_sheet_items
SET group_code = facility_type
WHERE (item_code LIKE 'X%' OR item_code LIKE 'MU-%') AND facility_type IS NOT NULL;

-- ── ③ STD: group_name·group_order 백필 — 원천 213건, DB 존재분(130종)만 적용 ──
UPDATE inspection_sheet_items i
SET group_name = v.group_name, group_order = v.group_order
FROM (VALUES
${groupVals}
) AS v(group_code, group_name, group_order)
WHERE i.group_code = v.group_code
  AND i.item_code ~ '^[0-9]{1,2}-[A-Z]-[0-9]{1,3}$';

-- ── ④ EXT/MU: group_name = group_code · group_order = MIN(order_num) ──────────
UPDATE inspection_sheet_items
SET group_name = group_code
WHERE (item_code LIKE 'X%' OR item_code LIKE 'MU-%') AND group_code IS NOT NULL;

UPDATE inspection_sheet_items i
SET group_order = m.mo
FROM (
  SELECT sheet_id, group_code, MIN(order_num) AS mo
  FROM inspection_sheet_items
  WHERE (item_code LIKE 'X%' OR item_code LIKE 'MU-%') AND group_code IS NOT NULL
  GROUP BY sheet_id, group_code
) AS m
WHERE i.sheet_id = m.sheet_id AND i.group_code = m.group_code
  AND (i.item_code LIKE 'X%' OR i.item_code LIKE 'MU-%');

-- ── ⑤ STD: 대괄호 소제목 백필 — 원천 379건, DB 존재분(206건 기대)만 조인 적용 ─
UPDATE inspection_sheet_items i
SET subgroup_name = v.subgroup_name, subgroup_order = v.subgroup_order
FROM (VALUES
${subVals}
) AS v(item_code, subgroup_name, subgroup_order)
WHERE i.item_code = v.item_code;

-- ── 인덱스 ────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sheet_items_group_axis
  ON inspection_sheet_items (sheet_id, group_order, subgroup_order NULLS FIRST, order_num);

-- ── 검증 (미달 시 전체 롤백) ──────────────────────────────────────────────────
DO $$
DECLARE
  n_null_code int; n_null_name int; n_std_groups int; n_sub_rows int; n_sub_groups int;
BEGIN
  SELECT COUNT(*) INTO n_null_code FROM inspection_sheet_items WHERE group_code IS NULL;
  SELECT COUNT(*) INTO n_null_name FROM inspection_sheet_items WHERE group_name IS NULL;
  SELECT COUNT(DISTINCT group_code) INTO n_std_groups FROM inspection_sheet_items
    WHERE item_code ~ '^[0-9]{1,2}-[A-Z]-[0-9]{1,3}$';
  SELECT COUNT(*) INTO n_sub_rows FROM inspection_sheet_items WHERE subgroup_name IS NOT NULL;
  SELECT COUNT(DISTINCT group_code || '#' || subgroup_order) INTO n_sub_groups
    FROM inspection_sheet_items WHERE subgroup_name IS NOT NULL;
  IF n_null_code > 0 OR n_null_name > 0 THEN
    RAISE EXCEPTION '134 검증 실패 — group_code NULL %건 / group_name NULL %건 (0이어야 함)', n_null_code, n_null_name;
  END IF;
  -- DB 시딩분 기준 기대값(2026-08-14 실측): STD 중분류 130종(원천 213 아님 — 미시딩 81 + 32-A·B 제외),
  -- 소제목 적용 206행 · 인스턴스 58개(G-2)
  IF n_std_groups <> 130 THEN
    RAISE EXCEPTION '134 검증 실패 — STD 중분류 %종 (기대 130)', n_std_groups;
  END IF;
  IF n_sub_rows <> 206 THEN
    RAISE EXCEPTION '134 검증 실패 — 소제목 적용 %행 (기대 206)', n_sub_rows;
  END IF;
  IF n_sub_groups <> 58 THEN
    RAISE EXCEPTION '134 검증 실패 — 소제목 인스턴스 %개 (기대 58)', n_sub_groups;
  END IF;
END $$;
`

writeFileSync('supabase/migrations/134_sheet_item_group_axis.sql', sql, 'utf8')
console.log(`생성: 134_sheet_item_group_axis.sql (${sql.length}바이트 · 중분류 ${groups.length}건 · 소제목 ${subRows.length}건)`)
