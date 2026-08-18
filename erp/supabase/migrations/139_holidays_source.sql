-- 139: holidays.source — 자동 동기화가 수동 등록분을 덮어쓰지 않게 (2026-08-18, 소방계획서_25 S-1)
--
-- 왜 필요한가: 크론(sync-holidays/route.ts)과 관리 화면 액션(admin/holidays/actions.ts)이
--   둘 다 `is_national: true`를 **강제**하고 `onConflict: 'date'`로 행 전체를 덮어썼다.
--   그래서 관리자가 손으로 넣은 임시공휴일·선거일이 다음 동기화 때 이름·구분이 되돌아갔다.
--   임시공휴일(제2조 제11호)·임기만료 선거일(제10의2호)은 date-holidays가 **원리상 못 잡는**
--   범주라, 수동 등록이 보존되지 않으면 이 날들은 영영 시스템에 들어올 수 없다.
--
--   예: 2025-01-27 임시공휴일 · 2025-06-03 대통령선거 · 2026-06-03 지방선거 · 2028-04-12 총선
--
-- source 축:
--   'api'     한국천문연구원 특일 정보(공공데이터포털) — 대체공휴일까지 확정된 값
--   'library' date-holidays + 「관공서의 공휴일에 관한 규정」제3조 산출 — API 장애 시 폴백
--   'manual'  관리자 수동 등록 — **자동 동기화가 절대 건드리지 않는다**
--
-- DEFAULT를 'manual'로 둔 이유: 앞으로 어떤 경로가 source를 빠뜨려도 '보호됨'으로 떨어진다.
--   자동 동기화는 항상 source를 명시하므로 영향이 없다.
--
-- 재실행 안전: ADD COLUMN IF NOT EXISTS · DROP CONSTRAINT IF EXISTS → ADD · CREATE OR REPLACE.

ALTER TABLE holidays ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

-- 백필: DEFAULT 때문에 기존 행이 전부 'manual'이 됐다 → 자동 동기화분만 'library'로 되돌린다.
-- 종전 스키마에서 자동 동기화분은 예외 없이 is_national = TRUE였다(위 두 경로가 하드코딩).
UPDATE holidays SET source = 'library' WHERE is_national = TRUE AND source = 'manual';

ALTER TABLE holidays DROP CONSTRAINT IF EXISTS holidays_source_check;
ALTER TABLE holidays ADD CONSTRAINT holidays_source_check
  CHECK (source IN ('api', 'library', 'manual'));

CREATE INDEX IF NOT EXISTS idx_holidays_source ON holidays(source);

COMMENT ON COLUMN holidays.source IS
  'api=특일정보 API(확정) | library=date-holidays+제3조 산출(폴백) | manual=관리자 수동. manual은 자동 동기화가 건드리지 않는다 (소방계획서_25)';

-- 안전망 — 앱이 실수로 manual 행을 자동분으로 덮으려 하면 조용히 무시한다.
-- 주 방어선은 앱의 선조회 제외(lib/holiday-sync.ts)이고 이 트리거는 그 그물이다.
-- 관리 화면의 명시적 수정은 source를 바꾸지 않으므로 그대로 통과한다.
--
-- ⚠ 탈출구(실측 확인, 2026-08-18): 이 트리거는 manual → api/library **되돌리기도 막는다**.
--   관리자가 수동 등록을 자동본으로 되돌리려면 **그 행을 삭제한 뒤 다시 동기화**해야 한다
--   (DELETE는 BEFORE UPDATE 트리거의 대상이 아니다). UPDATE로 시도하면 조용히 무시되므로
--   "고쳤는데 안 바뀐다"로 보인다 — 관리 화면에 이 안내를 띄워 둔다.
CREATE OR REPLACE FUNCTION protect_manual_holidays() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.source = 'manual' AND NEW.source <> 'manual' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_manual_holidays ON holidays;
CREATE TRIGGER trg_protect_manual_holidays BEFORE UPDATE ON holidays
  FOR EACH ROW EXECUTE FUNCTION protect_manual_holidays();

DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM information_schema.columns
   WHERE table_name = 'holidays' AND column_name = 'source';
  IF n = 0 THEN RAISE EXCEPTION '139 검증 실패 — holidays.source 컬럼 없음'; END IF;

  SELECT COUNT(*) INTO n FROM information_schema.check_constraints
   WHERE constraint_name = 'holidays_source_check'
     AND check_clause LIKE '%api%' AND check_clause LIKE '%library%' AND check_clause LIKE '%manual%';
  IF n = 0 THEN RAISE EXCEPTION '139 검증 실패 — source CHECK에 3값이 모두 있지 않음'; END IF;

  SELECT COUNT(*) INTO n FROM holidays WHERE source NOT IN ('api', 'library', 'manual');
  IF n > 0 THEN RAISE EXCEPTION '139 검증 실패 — source 값 범위 밖 % 건', n; END IF;

  SELECT COUNT(*) INTO n FROM pg_trigger WHERE tgname = 'trg_protect_manual_holidays';
  IF n = 0 THEN RAISE EXCEPTION '139 검증 실패 — manual 보호 트리거 없음'; END IF;

  RAISE NOTICE '139 적용 완료 — holidays.source (api/library/manual) + manual 보호 트리거';
END $$;
