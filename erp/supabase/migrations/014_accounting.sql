-- ============================================================
-- account_codes — 계정과목
-- ============================================================
CREATE TABLE account_codes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code         VARCHAR(10) NOT NULL UNIQUE,
  name         VARCHAR(50) NOT NULL,
  account_type VARCHAR(10) NOT NULL
               CHECK (account_type IN ('자산','부채','자본','수익','비용')),
  parent_code  VARCHAR(10),
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE account_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "account_codes_read" ON account_codes FOR SELECT USING (TRUE);
CREATE POLICY "account_codes_write" ON account_codes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager','admin'))
  );

-- 기본 계정과목 (소방점검업 기준)
INSERT INTO account_codes (code, name, account_type) VALUES
  -- 자산
  ('101', '현금',           '자산'),
  ('102', '보통예금',       '자산'),
  ('103', '당좌예금',       '자산'),
  ('110', '외상매출금',     '자산'),
  ('115', '미수금',         '자산'),
  ('120', '선급금',         '자산'),
  ('130', '재고자산',       '자산'),
  ('201', '건물',           '자산'),
  ('202', '차량운반구',     '자산'),
  ('203', '공구와기구',     '자산'),
  ('210', '감가상각누계액', '자산'),
  -- 부채
  ('301', '외상매입금',     '부채'),
  ('302', '미지급금',       '부채'),
  ('303', '선수금',         '부채'),
  ('310', '예수금',         '부채'),
  ('315', '부가세예수금',   '부채'),
  ('320', '단기차입금',     '부채'),
  ('330', '장기차입금',     '부채'),
  -- 자본
  ('401', '자본금',         '자본'),
  ('402', '이익잉여금',     '자본'),
  -- 수익
  ('501', '매출액',         '수익'),
  ('502', '용역수입',       '수익'),
  ('503', '기타수입',       '수익'),
  -- 비용
  ('601', '급여',           '비용'),
  ('602', '복리후생비',     '비용'),
  ('603', '여비교통비',     '비용'),
  ('604', '차량유지비',     '비용'),
  ('605', '소모품비',       '비용'),
  ('606', '통신비',         '비용'),
  ('607', '임차료',         '비용'),
  ('608', '수도광열비',     '비용'),
  ('609', '보험료',         '비용'),
  ('610', '외주용역비',     '비용'),
  ('611', '광고선전비',     '비용'),
  ('612', '접대비',         '비용'),
  ('613', '수수료비용',     '비용'),
  ('614', '감가상각비',     '비용'),
  ('615', '세금과공과',     '비용'),
  ('616', '잡비',           '비용');

-- ============================================================
-- vouchers — 전표
-- ============================================================
CREATE TABLE vouchers (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_number VARCHAR(30) NOT NULL UNIQUE,
  voucher_date   DATE        NOT NULL,
  voucher_type   VARCHAR(10) NOT NULL DEFAULT '대체'
                 CHECK (voucher_type IN ('입금','출금','대체')),
  description    TEXT        NOT NULL,
  total_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  status         VARCHAR(10) NOT NULL DEFAULT '작성중'
                 CHECK (status IN ('작성중','승인','취소')),
  created_by     UUID        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vouchers_date   ON vouchers(voucher_date);
CREATE INDEX idx_vouchers_status ON vouchers(status);

ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vouchers_auth" ON vouchers
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_active = TRUE)
  );

CREATE TRIGGER trg_vouchers_updated_at
  BEFORE UPDATE ON vouchers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- voucher_lines — 전표 명세 (차변/대변)
-- ============================================================
CREATE TABLE voucher_lines (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id      UUID          NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  account_code_id UUID          NOT NULL REFERENCES account_codes(id),
  debit_amount    NUMERIC(15,2) NOT NULL DEFAULT 0,
  credit_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  description     TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_voucher_lines_voucher ON voucher_lines(voucher_id);
CREATE INDEX idx_voucher_lines_account ON voucher_lines(account_code_id);

ALTER TABLE voucher_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "voucher_lines_auth" ON voucher_lines
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_active = TRUE)
  );
