-- 181: 주된 점검인력 = 회사 대표자(김흥준) — 배정과 무관 (2026-10-06 사용자 지시)
--
-- 사용자: 「배정인원과 관계없이 보고서 엑셀 > 점검인력 > 주된 점검인력 김흥준」 ·
--         「위임장 > 소방시설관리업체(대리인) 김흥준」 — 자격증이 있는 사람이 대표뿐이다.
--         「코드수정 필요없어」 → 앱은 그대로, 데이터 축으로 푼다.
--
-- 왜 데이터로 되는가: 위임장(annex-cover-official)·보고서(report9-assemble)는 이미
--   참여자 '주된' 행 → 없으면 점검 담당자 순으로 고른다. 운영 실측 '주된' 행 0/6이라
--   전부 담당자로 떨어지고 있었다(김흥준 3·이주성 2·「일반관리」 계정 1).
--   그래서 모든 점검에 대표자를 '주된' 참여자로 둔다.
--
-- 대상 = company_profile.representative 와 **이름이 같은 활성 직원이 정확히 1명**일 때만.
--   0명·2명 이상이면 아무것도 넣지 않는다(종전 동작 = 담당자 폴백) — 엉뚱한 사람을 박지 않는다.
-- ⚠ (inspection_id, employee_id) 유니크 — 대표자가 이미 보조로 들어 있는 점검은 건너뛴다(on conflict).
-- ⚠ 점검 상세 화면은 '보조'만 읽으므로 이 행은 화면 목록에 보이지 않는다(삭제 버튼도 없다).

CREATE OR REPLACE FUNCTION representative_profile_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH rep AS (
    SELECT btrim(representative) AS name FROM company_profile
    WHERE coalesce(btrim(representative), '') <> '' ORDER BY id LIMIT 1
  ), cand AS (
    SELECT p.id FROM profiles p, rep
    WHERE btrim(p.name) = rep.name AND p.is_active IS TRUE AND coalesce(p.is_system, false) = false
  )
  SELECT CASE WHEN (SELECT count(*) FROM cand) = 1 THEN (SELECT id FROM cand) END
$$;

CREATE OR REPLACE FUNCTION trg_inspection_main_inspector()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid := representative_profile_id();
BEGIN
  IF pid IS NOT NULL THEN
    INSERT INTO inspection_participants (inspection_id, employee_id, role, sort_order)
    VALUES (NEW.id, pid, '주된', -1)
    ON CONFLICT (inspection_id, employee_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS inspection_main_inspector ON inspections;
CREATE TRIGGER inspection_main_inspector
  AFTER INSERT ON inspections
  FOR EACH ROW EXECUTE FUNCTION trg_inspection_main_inspector();

-- 기존 점검 백필 — '주된' 행이 없는 점검에만
INSERT INTO inspection_participants (inspection_id, employee_id, role, sort_order)
SELECT i.id, representative_profile_id(), '주된', -1
FROM inspections i
WHERE representative_profile_id() IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM inspection_participants ip WHERE ip.inspection_id = i.id AND ip.role = '주된')
ON CONFLICT (inspection_id, employee_id) DO NOTHING;
