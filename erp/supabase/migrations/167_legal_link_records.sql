-- 167: 법정 외부 연계 1단계 — 제출 기록 3열·배치신고 조회 열·외부 대상물 번호 (비교진단 「법정 외부 연계 해결방안」 절, 2026-10-02)
--
-- 배경(코드 실측): 소방민원센터·협회 배치신고는 관리업체용 API가 없다(2026-10-02 재조사). 그래서 ERP가
--   먼저 할 일은 **기록을 열로 세우는 것**이다. 지금은 제출이 `report9_submitted_at` 날짜 1열뿐이고,
--   배치신고 완료는 `activity_logs`의 `cert_reported` 마커(마지막 것이 이김)라 능력평가 실적·제출현황이
--   신고일·결과·접수번호를 읽을 자리가 없다.
--
-- 🚨 불변: ②④ 완료 판정은 손대지 않는다.
--   · ② 완료 = 마커(`findArchivedCertInspections`)·배치확인서 파일. 아래 placement_* 열은 **조회용**이고,
--     `markCertReportedAction`이 마커를 넣을 때 같은 값을 이중 기록한다(해제하면 셋 다 NULL).
--   · ④ 완료 = `report9_submitted_at` 유무. 수단·접수번호·기록자는 그 옆에 붙는 부가 열이다.
--   · ② 기산점(종료일+5영업일, 121 트리거)도 변경 없음(2026-10-02 사용자 결정).

-- ── ① inspections — ④⑥ 제출 기록 부가 열 ─────────────────────────────────────
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS report9_submitted_via TEXT;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS report9_receipt_no TEXT;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS report9_submitted_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS report11_submitted_via TEXT;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS report11_receipt_no TEXT;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS report11_submitted_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN inspections.report9_submitted_via IS
  '④ 별지 9호 제출 수단: somin(소방민원센터)/visit(방문)/mail(우편)/fax(팩스)/NULL(미기록). '
  '완료 판정은 report9_submitted_at만 본다. somin이면서 접수번호가 비면 화면은 「관계인 승인 대기」로 표시한다.';
COMMENT ON COLUMN inspections.report9_receipt_no IS '④ 소방민원센터 접수번호(관계인 승인 뒤 받는 값). 수기 기록.';
COMMENT ON COLUMN inspections.report9_submitted_by IS '④ 제출일을 기록한 직원.';
COMMENT ON COLUMN inspections.report11_submitted_via IS '⑥ 별지 11호 제출 수단 — report9_submitted_via와 같은 값 집합.';
COMMENT ON COLUMN inspections.report11_receipt_no IS '⑥ 접수번호.';
COMMENT ON COLUMN inspections.report11_submitted_by IS '⑥ 제출일을 기록한 직원.';

-- ── ② inspections — 협회 배치신고 조회 열(마커의 사본 + 결과·신고번호) ────────────
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS placement_reported_at DATE;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS placement_result TEXT;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS placement_no TEXT;

COMMENT ON COLUMN inspections.placement_reported_at IS
  '② 협회 배치신고 신고일 — activity_logs cert_reported 마커의 **사본**(조회·능력평가 실적용). '
  '정본은 마커(findArchivedCertInspections)이고, 해제(cert_reported_undo)되면 NULL로 돌아간다.';
COMMENT ON COLUMN inspections.placement_result IS '② 협회 적합 판정: fit(적합)/unfit(부적합)/NULL(미판정).';
COMMENT ON COLUMN inspections.placement_no IS '② 협회 배치신고 번호(선택).';

-- ── ③ customers — 두 외부 시스템의 대상물 키 ──────────────────────────────────
-- 소민터는 협회 배치신고 자료를 「배치확인서 불러오기」로 가져오는데, 조건이 **대상물 일련번호 일치**다
-- (소민터 공지 2022-08·2022-09·2025-08). 두 번호를 ERP가 알아야 불일치를 미리 잡는다.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS somin_object_no TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS kfma_object_no TEXT;

COMMENT ON COLUMN customers.somin_object_no IS '소방민원센터(소민터) 대상물 일련번호 — 선택. 배치확인서 불러오기 일치 조건.';
COMMENT ON COLUMN customers.kfma_object_no IS '한국소방시설관리협회 관리업종합정보시스템 대상물번호 — 선택. 배치신고 입력 복사 카드가 보여 준다.';

-- ── ④ 백필 — 마커 → placement_reported_at (1회) ─────────────────────────────────
-- 폴드 규칙은 findArchivedCertInspections와 **같다**: 회차별로 created_at, id 순 **마지막** 마커가
-- cert_reported면 그 metadata.date, cert_reported_undo면 NULL. 결과·신고번호는 마커에 없어 NULL 그대로.
-- 재실행 안전: 마지막 마커 기준으로 다시 계산해 덮는다(이중 기록 뒤에도 같은 값).
WITH last_marker AS (
  SELECT DISTINCT ON (entity_id)
         entity_id::uuid AS inspection_id,
         action,
         metadata->>'date' AS reported_date
    FROM activity_logs
   WHERE entity_type = 'inspection'
     AND action IN ('cert_reported', 'cert_reported_undo')
   ORDER BY entity_id, created_at DESC, id DESC
)
UPDATE inspections i
   SET placement_reported_at = CASE
         WHEN lm.action = 'cert_reported' AND lm.reported_date ~ '^\d{4}-\d{2}-\d{2}$'
           THEN lm.reported_date::date
         ELSE NULL
       END
  FROM last_marker lm
 WHERE lm.inspection_id = i.id;
