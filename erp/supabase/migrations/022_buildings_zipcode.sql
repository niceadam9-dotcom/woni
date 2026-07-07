-- buildings 테이블에 우편번호 컬럼 추가
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS zipcode TEXT;
