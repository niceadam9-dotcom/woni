-- 118: 119안전센터 좌표 (소방계획서_13 A-4-4 — 117 fire_station_centers 후속)
--
-- 배경: 117로 드롭다운에 "본서 (센터)" 후보가 생겼지만 센터는 좌표를 갖지 않아,
--   센터를 골라도 경로·거리·도착예상은 **본서 기준**으로 계산됐다(화면에 그 사실을 표기).
--   실제 출동은 안전센터에서 나가므로 인쇄되는 최단거리·예상도착시간이 실제보다 멀게 나온다.
--
-- 114(본서)와 같은 구조·같은 규약이다:
--   · 주소는 정적 데이터로 두고 지오코딩 1회로 좌표를 확정한다(런타임 매번 지오코딩 금지).
--   · ⚠ NCP Geocode는 **주소 전용**이다 — '용문119안전센터' 같은 POI명으로 지오코딩하면 안 된다.
--   · 좌표가 없는 센터는 코드가 본서로 폴백하고 화면에 '본서 기준'임을 표기한다(기능 정지 아님).
--
-- 주소 적재는 scripts/seed-fire-station-center-coords.mjs 가 담당한다
-- (출처: 소방청 119안전센터 현황 공개 데이터 CSV — 065·116의 '확신 없는 값은 심지 않는다' 원칙 유지).

ALTER TABLE fire_station_centers
  ADD COLUMN IF NOT EXISTS center_address TEXT,   -- 119안전센터·지역대 도로명주소
  ADD COLUMN IF NOT EXISTS center_lat NUMERIC,    -- 위도
  ADD COLUMN IF NOT EXISTS center_lng NUMERIC;    -- 경도

COMMENT ON COLUMN fire_station_centers.center_address IS
  '119안전센터 도로명주소 — 경로 조회 출발지(좌표 없으면 소속 본서로 폴백, 소방계획서_13 A-4-4)';
