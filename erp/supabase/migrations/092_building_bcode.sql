-- 092: 건물 법정동코드·지번주소 저장 (2026-07-16, 고객관리 탭개편 설계 §5-A)
-- 주소 검색(Daum) 시마다 bcode·지번을 저장 → 건축물대장 재조회를 주소창 재확인 없이 원클릭화.
-- 기존 건물은 값이 비어 있으며, 다음 주소 검색/대장 조회 때 자연 백필된다.

ALTER TABLE buildings
  ADD COLUMN IF NOT EXISTS bcode         TEXT,  -- 법정동코드 10자리 (Daum 우편번호 bcode)
  ADD COLUMN IF NOT EXISTS address_jibun TEXT;  -- 지번주소 (건축물대장 번지 파싱용)

COMMENT ON COLUMN buildings.bcode         IS '법정동코드 10자리 — 건축물대장 API 조회용 (Daum bcode)';
COMMENT ON COLUMN buildings.address_jibun IS '지번주소 — 건축물대장 API 번지 파싱용';
