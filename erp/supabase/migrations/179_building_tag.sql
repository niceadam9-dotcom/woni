-- 179: 건물 QR — buildings.tag_code (통합 실행계획 C4 — 설비 QR 절 4단계, 2026-10-03)
--
-- 배경: 관계인은 결과 보고 후 10일 안에 「소방시설등 자체점검기록표」(시행규칙 25조·별표 5)를 출입구에
--   30일 이상 게시해야 한다. 그 기록표 PDF(lib/record-card)의 여백에 이 건물 QR을 찍는다 — 찍으면
--   /t/{code}가 건물 카드(회차 목록·단계 상태)를 연다. 공개 카드는 두지 않는다(사용자 결정 2026-10-03
--   — 직원만, 관계인 열람은 고객 포털 때 재결정). 코드는 개체·지점과 같은 공간(8자)·재발급 없음.

ALTER TABLE buildings ADD COLUMN IF NOT EXISTS tag_code TEXT UNIQUE;

COMMENT ON COLUMN buildings.tag_code IS
  '건물 QR 코드(8자, 자체점검기록표 PDF가 찍는다) — /t/{code} 건물 카드. 기록표 생성 때 자동 발급·재발급 없음 (179, C4)';
