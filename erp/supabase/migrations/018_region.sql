-- customers 테이블에 시/읍면/리 3단계 지역 컬럼 추가
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS region_si    TEXT,
  ADD COLUMN IF NOT EXISTS region_myeon TEXT,
  ADD COLUMN IF NOT EXISTS region_ri    TEXT;

COMMENT ON COLUMN customers.region_si    IS '지역 — 시/군/구  예) 광주시';
COMMENT ON COLUMN customers.region_myeon IS '지역 — 읍/면/동  예) 오포읍';
COMMENT ON COLUMN customers.region_ri    IS '지역 — 리/동     예) 신현리';
