-- 116: 관할 소방서 매핑 전국 확장 준비 (소방계획서_11.md §13-C C-2)
--
-- 배경(독립검증 2026-08-07): 065는 `region TEXT PRIMARY KEY` — 지역명 하나가 전국 단일 키였다.
--   그래서 ① 동명 지역을 담을 수 없고(충북 옥천군 옥천읍 vs 경기 양평군 옥천면)
--        ② 자치구 단위 매핑(서울 25개구, 성남 분당/수정·중원)을 표현할 수 없었다.
--   실제로 resolveFireStation의 'region만으로 조회' 단계가 충북 옥천군 → '양평소방서',
--   서울 종로구 청운동 → '양평소방서' 같은 조용한 오매핑을 만들었다(그 단계는 코드에서 제거함).
--
-- 변경: PK를 (region_sido, region_si, region) 복합으로 바꾸고 시/도 컬럼과 지역 종류를 추가한다.
--   region_type = 'emd'(읍면동) | 'gu'(자치구) | 'sigun'(시·군 전역 대표행)
--   region_si   = 시·군 (특별시·광역시는 자치구를 담기 위해 시/도명을 넣는다 — 예: '서울특별시')
--   region      = 읍면동명(접미사 제거) | 자치구명 | '' (시군 전역)

ALTER TABLE region_fire_stations
  ADD COLUMN IF NOT EXISTS region_sido TEXT,
  ADD COLUMN IF NOT EXISTS region_type TEXT NOT NULL DEFAULT 'emd';

-- 기존 22행은 전부 경기도 읍·면 단위였다
UPDATE region_fire_stations SET region_sido = '경기도' WHERE region_sido IS NULL AND region_si <> '';
UPDATE region_fire_stations SET region_sido = '강원특별자치도'
  WHERE region_si IN ('홍천군', '동해시');

-- PK 컬럼은 NOT NULL이어야 한다 — 빈 문자열로 메운 뒤 제약을 건다
UPDATE region_fire_stations SET region_sido = '' WHERE region_sido IS NULL;
UPDATE region_fire_stations SET region_si = '' WHERE region_si IS NULL;
ALTER TABLE region_fire_stations ALTER COLUMN region_sido SET NOT NULL;
ALTER TABLE region_fire_stations ALTER COLUMN region_si SET NOT NULL;

-- PK 교체 — 같은 지역명이 여러 시/도·시/군에 존재할 수 있다
ALTER TABLE region_fire_stations DROP CONSTRAINT IF EXISTS region_fire_stations_pkey;
ALTER TABLE region_fire_stations
  ADD CONSTRAINT region_fire_stations_pkey PRIMARY KEY (region_sido, region_si, region);

CREATE INDEX IF NOT EXISTS idx_region_fire_stations_lookup
  ON region_fire_stations (region_si, region);

COMMENT ON COLUMN region_fire_stations.region_type IS
  'emd=읍면동 / gu=자치구 / sigun=시·군 전역 대표행 — 조회는 emd·gu 우선, 없으면 sigun 폴백';
COMMENT ON COLUMN region_fire_stations.region_si IS
  '시·군. 특별시·광역시는 자치구를 region에 담기 위해 여기에 시/도명을 넣는다(예: 서울특별시 + 영등포구)';
