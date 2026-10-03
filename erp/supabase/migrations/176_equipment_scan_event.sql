-- 176: 설비 이력에 'scan' 이벤트 (통합 실행계획 C4 2단계 — 설비 QR 절 2단계 웹, 2026-10-03)
--
-- 배경: QR 라벨(172의 tag_code, C3 3단계 라벨·/t 리졸버)을 폰 기본 카메라로 찍으면 /t/{code} 카드가 열린다.
--   그 「현장에서 이 개체를 봤다」를 이력으로 남긴다 — 172가 이 날을 위해 CHECK에 이름을 붙여 두었다.
--   (모바일 앱 스캐너는 운영 실사용 0(120일, erp-a3 실측)이라 뒤로 미루고 웹부터 — 사용자 결정 2026-10-03)
--
-- 무한 증가 방지(설비 QR 절 「코드 결합」): **같은 개체·같은 날 1행**. 유니크 제약이 아니라 기록 쪽
--   (lib/equipment-scan)이 「오늘 이 개체 scan 행이 있으면 건너뛴다」로 지킨다 — 동시 두 건이 겹쳐도 해가 없다
--   (이력 열람용이고 완료 판정의 증거가 아니다. activity_logs EVIDENCE_MARKER_ACTIONS에도 넣지 않는다).
-- 비파괴: CHECK를 넓히기만 한다. 기존 행은 전부 7종 안이라 재검증 통과.

ALTER TABLE equipment_asset_events DROP CONSTRAINT IF EXISTS equipment_asset_events_type_check;
ALTER TABLE equipment_asset_events ADD CONSTRAINT equipment_asset_events_type_check
  CHECK (event_type IN ('install', 'inspect', 'measure', 'perf_check', 'repair', 'replace', 'dispose', 'scan'));
