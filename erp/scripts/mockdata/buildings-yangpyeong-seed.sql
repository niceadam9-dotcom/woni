-- ============================================================
-- 승진소방 ERP: 건물 테이블 생성 + 양평군 건물 Mock 데이터 50건
-- Supabase SQL Editor에 전체 붙여넣기 후 Run
-- 전제조건: 020_buildings 마이그레이션 & 양평군 고객(YP001~YP050) 삽입 완료
-- ============================================================

-- ============================================================
-- buildings (건물 관리)
-- ============================================================
CREATE TABLE IF NOT EXISTS buildings (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID        NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  building_name TEXT        NOT NULL,
  address       TEXT,
  total_area    NUMERIC(12, 2),
  floors_above  SMALLINT,
  floors_below  SMALLINT,
  purpose       TEXT,
  year_built    SMALLINT,
  notes         TEXT,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by    UUID        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_buildings_customer  ON buildings(customer_id);
CREATE INDEX IF NOT EXISTS idx_buildings_active    ON buildings(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_buildings_purpose   ON buildings(purpose);

CREATE OR REPLACE TRIGGER trg_buildings_updated_at
  BEFORE UPDATE ON buildings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE buildings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All employees can view buildings"
  ON buildings FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Managers and admins manage buildings"
  ON buildings FOR ALL
  USING (current_user_role() IN ('manager', 'admin'));


-- ============================================================
-- SEED: buildings 50건 (양평군 고객 연결)
-- ============================================================
INSERT INTO buildings
  (customer_id, building_name, address,
   total_area, floors_above, floors_below,
   purpose, year_built, notes,
   is_active, created_by, created_at, updated_at)
VALUES
  ((SELECT id FROM customers WHERE customer_code = 'YP001' LIMIT 1), '양평한양아파트 102동', '경기도 양평군 양평읍 양평리 500', 12500, 15, 2, '공동주택', 1998, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP002' LIMIT 1), '양평한솔마트 본점', '경기도 양평군 양평읍 창대리 125', 1850, 2, 1, '판매시설', 2018, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP003' LIMIT 1), '양평중앙병원 본관', '경기도 양평군 양평읍 양평리 320', 3200, 6, 1, '의료시설', 2010, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP004' LIMIT 1), '양평초등학교 교사동', '경기도 양평군 양평읍 공흥리 200', 4500, 4, 0, '교육시설', 2005, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP005' LIMIT 1), '양평종합사회복지관 본관', '경기도 양평군 양평읍 회현리 85', 1200, 3, 0, '기타', 2015, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP006' LIMIT 1), '한강변펜션단지 본채', '경기도 양평군 양평읍 오빈리 33', 850, 3, 0, '숙박시설', 2019, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP007' LIMIT 1), '양평공단물류창고A동', '경기도 양평군 양평읍 덕평리 700', 3600, 1, 0, '창고시설', 2023, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP008' LIMIT 1), '양평삼성수퍼마켓 본점', '경기도 양평군 양평읍 백안리 45', 450, 1, 0, '판매시설', 2008, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP009' LIMIT 1), '양평빌라1단지 가동', '경기도 양평군 양평읍 신복리 280', 4200, 5, 1, '공동주택', 2002, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP010' LIMIT 1), '양평농협하나로마트', '경기도 양평군 양평읍 양평리 150', 2400, 2, 1, '판매시설', 2012, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP011' LIMIT 1), '용문산관광호텔 본관', '경기도 양평군 용문면 용문리 800', 5600, 8, 1, '숙박시설', 2008, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP012' LIMIT 1), '용문나눔요양원 A동', '경기도 양평군 용문면 화전리 120', 2100, 4, 0, '의료시설', 2016, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP013' LIMIT 1), '용문시장 상가동', '경기도 양평군 용문면 연수리 55', 3500, 5, 1, '근린생활시설', 2000, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP014' LIMIT 1), '용문공장B동', '경기도 양평군 용문면 광탄리 400', 6200, 3, 0, '공장', 2014, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP015' LIMIT 1), '용문현대아파트 1단지', '경기도 양평군 용문면 용문리 350', 18500, 12, 1, '공동주택', 1995, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP016' LIMIT 1), '용문한방의원 본관', '경기도 양평군 용문면 화전리 78', 680, 3, 0, '의료시설', 2022, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP017' LIMIT 1), '용문면복지센터', '경기도 양평군 용문면 연수리 100', 750, 2, 0, '기타', 2018, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP018' LIMIT 1), '용문주유소 사무동', '경기도 양평군 용문면 광탄리 200', 280, 1, 0, '위험물저장시설', 2005, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP019' LIMIT 1), '강상한아름아파트 가동', '경기도 양평군 강상면 교평리 300', 9800, 10, 1, '공동주택', 2007, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP020' LIMIT 1), '강상물류창고A동', '경기도 양평군 강상면 화양리 600', 4800, 1, 0, '창고시설', 2023, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP021' LIMIT 1), '강상면소망교회 예배당', '경기도 양평군 강상면 세월리 40', 1100, 3, 0, '기타', 2009, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP022' LIMIT 1), '강상가구단지 1동', '경기도 양평군 강상면 대석리 500', 2800, 4, 1, '판매시설', 2011, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP023' LIMIT 1), '강상항금농산물창고', '경기도 양평군 강상면 항금리 150', 1500, 1, 0, '창고시설', 2017, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP024' LIMIT 1), '강상로뎀병원 본관', '경기도 양평군 강상면 병산리 90', 3800, 5, 1, '의료시설', 2013, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP025' LIMIT 1), '양서한강뷰펜션 본채', '경기도 양평군 양서면 복포리 25', 620, 2, 0, '숙박시설', 2021, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP026' LIMIT 1), '신원초등학교 교사동', '경기도 양평군 양서면 신원리 110', 3200, 3, 0, '교육시설', 2008, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP027' LIMIT 1), '양서면복지관 본관', '경기도 양평군 양서면 목왕리 60', 980, 2, 0, '기타', 2019, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP028' LIMIT 1), '양서용담농산물창고', '경기도 양평군 양서면 용담리 320', 2200, 1, 0, '창고시설', 2024, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP029' LIMIT 1), '양서센트럴아파트 101동', '경기도 양평군 양서면 복포리 180', 16200, 14, 2, '공동주택', 2006, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP030' LIMIT 1), '양서한가람마트', '경기도 양평군 양서면 대심리 75', 1650, 2, 1, '판매시설', 2020, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP031' LIMIT 1), '옥천협성아파트 A동', '경기도 양평군 옥천면 옥천리 400', 11400, 11, 1, '공동주택', 2004, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP032' LIMIT 1), '아신요양병원 본관', '경기도 양평군 옥천면 아신리 88', 2650, 4, 0, '의료시설', 2017, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP033' LIMIT 1), '옥천용천창고단지 1동', '경기도 양평군 옥천면 용천리 250', 3400, 2, 0, '창고시설', 2024, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP034' LIMIT 1), '옥천수입리농산물창고', '경기도 양평군 옥천면 수입리 175', 1800, 1, 0, '창고시설', 2021, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP035' LIMIT 1), '옥천한방의원 건물', '경기도 양평군 옥천면 인덕리 50', 520, 2, 0, '의료시설', 2015, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP036' LIMIT 1), '서종한강뷰글램핑 관리동', '경기도 양평군 서종면 정배리 120', 380, 1, 0, '숙박시설', 2022, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP037' LIMIT 1), '문호리펜션마을 본채', '경기도 양평군 서종면 문호리 60', 750, 2, 0, '숙박시설', 2024, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP038' LIMIT 1), '서종문화센터 본관', '경기도 양평군 서종면 노문리 80', 1450, 3, 0, '기타', 2016, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP039' LIMIT 1), '서종수입리공장 본동', '경기도 양평군 서종면 수입리 350', 4500, 2, 0, '공장', 2010, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP040' LIMIT 1), '서종달마을전원주택단지 관리동', '경기도 양평군 서종면 명달리 95', 580, 2, 0, '기타', 2018, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP041' LIMIT 1), '강하전수리농산물창고', '경기도 양평군 강하면 전수리 420', 2800, 1, 0, '창고시설', 2023, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP042' LIMIT 1), '강하운심아파트 가동', '경기도 양평군 강하면 운심리 300', 7200, 8, 1, '공동주택', 2009, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP043' LIMIT 1), '강하왕창리공장 A동', '경기도 양평군 강하면 왕창리 550', 5800, 3, 0, '공장', 2008, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP044' LIMIT 1), '강하부용리펜션 본채', '경기도 양평군 강하면 부용리 35', 480, 2, 0, '숙박시설', 2024, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP045' LIMIT 1), '지평양조장 본관', '경기도 양평군 지평면 지평리 150', 1800, 2, 0, '위험물저장시설', 2015, '위험물 제조시설 포함', TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP046' LIMIT 1), '지평무왕리공장 A동', '경기도 양평군 지평면 무왕리 680', 6800, 2, 0, '공장', 2022, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP047' LIMIT 1), '지평대평리물류창고 1동', '경기도 양평군 지평면 대평리 400', 4200, 1, 0, '창고시설', 2019, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP048' LIMIT 1), '단월봉상농협창고', '경기도 양평군 단월면 봉상리 200', 1200, 1, 0, '창고시설', 2023, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP049' LIMIT 1), '단월복지회관 건물', '경기도 양평군 단월면 명금리 30', 650, 2, 0, '기타', 2014, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW()),
  ((SELECT id FROM customers WHERE customer_code = 'YP050' LIMIT 1), '청운삼성리마을회관', '경기도 양평군 청운면 삼성리 15', 420, 2, 0, '기타', 2012, NULL, TRUE, 'd14acfb3-23a1-4ac7-b700-233b64eda2c6'::UUID, NOW(), NOW())
ON CONFLICT DO NOTHING;

SELECT COUNT(*) AS total_buildings FROM buildings;
