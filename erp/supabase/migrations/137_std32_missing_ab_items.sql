-- 137: STD-32(다중이용업소 점검표) 32-A·32-B 그룹 18항목 편입 (2026-08-15, 소방계획서_22 S9-3 — Q-10 선행)
--
-- 왜: 법정 32번 점검표는 32-A 소화설비(13) + 32-B 경보설비(4) + 32-C-001(1) 포함 44항목인데
-- DB는 32-C-002부터 26항목만 있다(2026-08-15 스테이징 실측 — order_num 1~26). 원인은 132와 동일한
-- 엑셀 병합 셀 미추출. Q-10(STD-32 입력 단일화 + MU 16칸 롤업)은 점검자가 이 한 벌만 입력하는
-- 설계라, 18항목이 없으면 법정 44항목 중 18개를 입력할 수 없다 — S14의 선행 조건.
--
-- 문구는 erp_goal/_form/_별지4호_현행판_추출.txt:3649-3725 축자(●/○ 불릿 제외 — 불릿은
-- comprehensive_only가 원천, 기존 830건과 동일 규약). ● = 종합점검 전용(true).
-- facility_type은 기존 STD-32 행 규약('다중이용업소') 유지. 대괄호 소제목 축(subgroup_*)은
-- 원문이 32번 블록에서 대괄호를 쓰지 않으므로 기존 32-C 행과 동일하게 두지 않는다(소방계획서_23 소관).
--
-- 재실행 안전: 32-A-001 존재 여부로 전체를 게이트 — order_num 시프트(+18)가 두 번 돌면
-- 순서가 깨지므로 행 단위 NOT EXISTS가 아니라 블록 단위 가드를 쓴다(132와 다른 이유).

DO $$
DECLARE
  v_sheet uuid;
  n INT;
BEGIN
  SELECT id INTO v_sheet FROM inspection_sheets WHERE sheet_code = 'STD-32' AND version = 'v2025';
  IF v_sheet IS NULL THEN
    RAISE EXCEPTION '137 중단 — STD-32(v2025) 시트가 없음';
  END IF;

  IF EXISTS (SELECT 1 FROM inspection_sheet_items WHERE sheet_id = v_sheet AND item_code = '32-A-001') THEN
    RAISE NOTICE '137 스킵 — 32-A-001 이미 존재(재실행)';
    RETURN;
  END IF;

  -- ① 기존 26행(32-C-002~32-G-002, order 1~26)을 뒤로 밀어 법정 순서 자리를 만든다
  UPDATE inspection_sheet_items SET order_num = order_num + 18 WHERE sheet_id = v_sheet;

  -- ② 18항목 편입 — 법정 순서 1~18
  INSERT INTO inspection_sheet_items
    (sheet_id, item_code, item_name, facility_type, order_num, comprehensive_only)
  VALUES
    (v_sheet, '32-A-001', '설치수량(구획된 실 등) 및 설치거리(보행거리) 적정 여부', '다중이용업소', 1, false),
    (v_sheet, '32-A-002', '설치장소(손쉬운 사용) 및 설치 높이 적정 여부', '다중이용업소', 2, false),
    (v_sheet, '32-A-003', '소화기 표지 설치상태 적정 여부', '다중이용업소', 3, false),
    (v_sheet, '32-A-004', '외형의 이상 또는 사용상 장애 여부', '다중이용업소', 4, false),
    (v_sheet, '32-A-005', '수동식 분말소화기 내용연수 적정여부', '다중이용업소', 5, false),
    (v_sheet, '32-A-011', '수원의 양 적정 여부', '다중이용업소', 6, false),
    (v_sheet, '32-A-012', '가압송수장치의 정상 작동 여부', '다중이용업소', 7, false),
    (v_sheet, '32-A-013', '배관 및 밸브의 파손, 변형 및 잠김 여부', '다중이용업소', 8, false),
    (v_sheet, '32-A-014', '상용전원 및 비상전원의 이상 여부', '다중이용업소', 9, false),
    (v_sheet, '32-A-015', '유수검지장치의 정상 작동 여부', '다중이용업소', 10, true),
    (v_sheet, '32-A-016', '헤드의 적정 설치 여부(미설치, 살수장애, 도색 등)', '다중이용업소', 11, true),
    (v_sheet, '32-A-017', '송수구 결합부의 이상 여부', '다중이용업소', 12, true),
    (v_sheet, '32-A-018', '시험밸브 개방시 펌프기동 및 음향 경보 여부', '다중이용업소', 13, true),
    (v_sheet, '32-B-001', '구획된 실마다 감지기(발신기), 음향장치 설치 및 정상 작동 여부', '다중이용업소', 14, false),
    (v_sheet, '32-B-002', '전용 수신기가 설치된 경우 주수신기와 상호 연동되는지 여부', '다중이용업소', 15, false),
    (v_sheet, '32-B-003', '수신기 예비전원(축전지) 상태 적정 여부(상시 충전, 상용전원 차단 시 자동절환)', '다중이용업소', 16, false),
    (v_sheet, '32-B-011', '주방 또는 난방시설이 설치된 장소에 설치 및 정상 작동 여부', '다중이용업소', 17, true),
    (v_sheet, '32-C-001', '피난기구 종류 및 설치개수 적정 여부', '다중이용업소', 18, true);

  -- ③ 3층 축 백필 — 134가 이미 적용된 환경(fresh 환경은 번호순이라 134 → 137)에서는 여기서 채운다.
  --    134보다 먼저 도는 환경(스테이징 — 둘 다 미적용 상태에서 순차 적용)에서는 134가 뒤에서 채우므로
  --    컬럼 존재를 확인하고만 백필한다. group_name은 134 ③의 VALUES(32-A 소화설비 1 / 32-B 경보설비 2 /
  --    32-C 피난구조설비 3)와 동일 값.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'inspection_sheet_items' AND column_name = 'group_code') THEN
    UPDATE inspection_sheet_items SET group_code = regexp_replace(item_code, '-[0-9]+$', '')
     WHERE sheet_id = v_sheet AND group_code IS NULL;
    UPDATE inspection_sheet_items i
       SET group_name = v.gname, group_order = v.gord
      FROM (VALUES ('32-A', '소화설비', 1), ('32-B', '경보설비', 2), ('32-C', '피난구조설비', 3))
        AS v(gcode, gname, gord)
     WHERE i.sheet_id = v_sheet AND i.group_code = v.gcode AND i.group_name IS NULL;
  END IF;

  -- ④ 검증 — 44항목·중복 0·순서 1~44 연속이어야 정상
  SELECT COUNT(*) INTO n FROM inspection_sheet_items WHERE sheet_id = v_sheet;
  IF n <> 44 THEN RAISE EXCEPTION '137 검증 실패 — STD-32 항목 수 % (기대 44)', n; END IF;
  SELECT COUNT(*) INTO n FROM (
    SELECT item_code FROM inspection_sheet_items WHERE sheet_id = v_sheet GROUP BY item_code HAVING COUNT(*) > 1
  ) d;
  IF n <> 0 THEN RAISE EXCEPTION '137 검증 실패 — 중복 item_code %건', n; END IF;
  SELECT COUNT(DISTINCT order_num) INTO n FROM inspection_sheet_items WHERE sheet_id = v_sheet;
  IF n <> 44 THEN RAISE EXCEPTION '137 검증 실패 — order_num 중복(고유 %개)', n; END IF;
  RAISE NOTICE '137 적용 완료 — STD-32 44항목(32-A 13·32-B 4·32-C-001 편입)';
END $$;
