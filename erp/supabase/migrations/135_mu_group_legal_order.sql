-- 135: MU(다중이용업소 안전시설등) 법정 순서·구분 정정 — 16행 UPDATE
--      (2026-08-14, 소방계획서_23 S3 — 원천 erp_goal/_form/_별지4호_현행판_추출.txt:93-123)
--
-- 왜: 법정 서식(별지 4호 2쪽 2열 표)에서
--   · MU-007 피난안내도ㆍ피난안내영상물은 '기타' 구분의 5번째(창 문 다음·방염 앞)인데
--     seed가 '피난구조설비'에 넣었다 — 화면·문서 양쪽 오답, 서로 위치도 달랐다(P-4)
--   · MU-010 창 문도 '기타'인데 seed만 '피난구조설비'였다 — 화면↔인쇄 불일치(P-5)
-- 응답(inspection_sheet_responses)은 item_code 축이라 데이터 손실이 없다(Q-3).
--
-- 경로: seed 재실행이 아니라 UPDATE 마이그레이션(Q-11) — seed-mu-sheet.mjs는 시트를
-- DELETE→INSERT라 sheet_id가 바뀌어 진행률 키·E2E 고정점이 흔들린다. seed 소스는
-- S3A에서 별도 정정한다(재실행 시 재발 방지 — R-9).
--
-- 표기 축자(P-8 · §3-3): MU-007 라벨의 ㆍ는 U+318D(현행 seed는 쉼표), MU-010은 '창 문'(공백 포함).
-- group_*는 134가 옛 facility_type으로 이미 채웠으므로 여기서 법정 값으로 덮는다(134 → 135 순서 전제).
-- 재실행 안전: 같은 값 재기록이라 멱등.

-- ── 16행 — 법정 구분(facility_type=group_code=group_name)·구분 순번(group_order)·행 순서(order_num) ──
UPDATE inspection_sheet_items i
SET facility_type = v.cat, group_code = v.cat, group_name = v.cat,
    group_order = v.gord, order_num = v.ord
FROM (VALUES
  ('MU-001', '소화설비',     1,  1),
  ('MU-002', '소화설비',     1,  2),
  ('MU-003', '경보설비',     2,  3),
  ('MU-004', '경보설비',     2,  4),
  ('MU-005', '피난구조설비', 3,  5),
  ('MU-006', '피난구조설비', 3,  6),
  ('MU-008', '피난구조설비', 3,  7),
  ('MU-009', '피난구조설비', 3,  8),
  ('MU-011', '비상구',       4,  9),
  ('MU-012', '비상구',       4, 10),
  ('MU-013', '기타',         5, 11),
  ('MU-014', '기타',         5, 12),
  ('MU-015', '기타',         5, 13),
  ('MU-010', '기타',         5, 14),
  ('MU-007', '기타',         5, 15),
  ('MU-016', '기타',         5, 16)
) AS v(item_code, cat, gord, ord)
WHERE i.item_code = v.item_code;

-- ── 라벨 축자 정정 2건 (§3-3 — 나머지 14건은 현행 유지) ──────────────────────
UPDATE inspection_sheet_items SET item_name = '피난안내도ㆍ피난안내영상물' WHERE item_code = 'MU-007';
UPDATE inspection_sheet_items SET item_name = '창 문' WHERE item_code = 'MU-010';

-- ── 검증 (미달 시 전체 롤백) — INV-D9와 같은 규칙 ────────────────────────────
DO $$
DECLARE
  n_etc int; n_mu int; bad_order int;
BEGIN
  SELECT COUNT(*) INTO n_mu FROM inspection_sheet_items WHERE item_code LIKE 'MU-%';
  SELECT COUNT(*) INTO n_etc FROM inspection_sheet_items
    WHERE item_code IN ('MU-007', 'MU-010') AND facility_type = '기타';
  -- 법정 행 순서 — 창 문(14) < 피난안내도(15) < 방염(16)
  SELECT COUNT(*) INTO bad_order FROM (
    SELECT (SELECT order_num FROM inspection_sheet_items WHERE item_code = 'MU-010' LIMIT 1) a,
           (SELECT order_num FROM inspection_sheet_items WHERE item_code = 'MU-007' LIMIT 1) b,
           (SELECT order_num FROM inspection_sheet_items WHERE item_code = 'MU-016' LIMIT 1) c
  ) t WHERE NOT (t.a < t.b AND t.b < t.c);
  IF n_mu <> 16 THEN
    RAISE EXCEPTION '135 검증 실패 — MU 항목 %건 (기대 16)', n_mu;
  END IF;
  IF n_etc <> 2 THEN
    RAISE EXCEPTION '135 검증 실패 — MU-007·MU-010 기타 구분 %건 (기대 2)', n_etc;
  END IF;
  IF bad_order > 0 THEN
    RAISE EXCEPTION '135 검증 실패 — 기타 구분 행 순서(창 문 < 피난안내도 < 방염) 위반';
  END IF;
END $$;
