-- 140: 사전 안내 SMS 발송 이력 + 관계인별 수신 지정 (2026-08-18, 소방계획서_24 S1)
--
-- 왜 새 테이블인가 —
-- 현행 발송 기록은 inspection_status_log.sms_sent_at 한 칸이다. 그 테이블은 plan_item_id가
-- UNIQUE라 회차당 1행뿐이어서 ①재발송 이력을 못 담고 ②수신자가 여럿이면 누구에게 갔는지
-- 남지 않으며 ③실패를 기록할 자리가 없다. 실제로 saveSmsAction은 Solapi 결과와 무관하게
-- sms_sent_at을 찍어, 문자를 못 받은 고객까지 '발송됨'으로 보였다(P-1·P-2·P-3).
-- 그래서 이력은 **append-only 별도 테이블**로 옮기고 1행 = 1수신자로 둔다.
-- inspection_status_log는 Q-8로 은퇴하므로 그쪽에 컬럼을 붙이지 않는다(G-2 철회).

CREATE TABLE IF NOT EXISTS sms_send_log (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 'pre_visit' 방문 전 사전 안내 / 'manual' 임의 문구로 계획 건에 발송
  -- 'adhoc'    계획에 없는 방문(재방문·불량 보수·AS·견적) — 계획 항목을 만들지 않는다(Q-17).
  --            계획 항목으로 만들면 점검 실적·진행률·별지 대상에 잡혀 법정 회차가 늘어난다.
  kind                 TEXT NOT NULL DEFAULT 'pre_visit'
                         CHECK (kind IN ('pre_visit', 'manual', 'adhoc')),

  customer_id          UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  -- 같은 고객이 같은 날 정기+자체점검을 동시에 가질 수 있어 1통에 여러 계획이 접힌다(P-12).
  -- adhoc은 빈 배열 — 그래서 UUID[]이고 NOT NULL이 아니다.
  plan_item_ids        UUID[] NOT NULL DEFAULT '{}',
  -- 발송 시점의 방문일. **'미발송' 판정 키가 (customer_id, visit_date)** 쌍이라 이 컬럼이 중심이다.
  -- 점검일을 옮기면 visit_date가 달라져 자동으로 다시 미발송이 되어 배너에 뜬다(S5-10).
  -- plan_item 기준으로 판정하면 옛 날짜로 보낸 문자가 새 날짜를 가려 재안내를 통째로 놓친다.
  visit_date           DATE NOT NULL,
  -- 며칠 전에 보냈나 = visit_date - 실제 발송일(KST). **배너 규칙값이 아니다** —
  -- 승인 방식이라 3일 전 배너를 2일 전에 눌러도 되므로, 규칙값을 적으면 실측이 아니라 설정값이 된다.
  -- 실측이 쌓이면 나중에 자동 발송 시점을 정하는 근거가 된다.
  lead_days            INT,

  to_phone             TEXT,               -- 번호 없음(no_phone)이면 NULL
  from_phone           TEXT,
  contact_role         TEXT,               -- 지정관계인·대표·직원1·직원2 — 누구에게 갔는지(P-3 해소)
  contact_name         TEXT,

  content              TEXT NOT NULL,      -- 렌더된 본문 전문(문구가 나중에 바뀌어도 복원 가능, 130 패턴)
  byte_len             INT,
  msg_type             TEXT CHECK (msg_type IN ('SMS', 'LMS')),

  -- 'sending'    발송 직전 claim (여기서 죽으면 이 상태로 남아 '보냈는지 모름'이 드러난다)
  -- 'sent'       성공 / 'failed' 실패 / 'no_phone' 번호가 없어 못 보냄(조용한 소멸 금지, P-2)
  -- 'unverified' 응답은 왔는데 스키마를 못 읽음 — failed로 두면 **실제로 나간 문자를 재발송**한다
  status               TEXT NOT NULL DEFAULT 'sending'
                         CHECK (status IN ('sending', 'sent', 'unverified', 'failed', 'no_phone')),

  provider_message_id  TEXT,
  provider_status_code TEXT,
  provider_raw         JSONB,              -- 원문 보존 — 응답 스키마 가정이 틀려도 사후 재판정이 된다
  error                TEXT,

  trigger              TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('cron', 'manual')),
  sent_by              UUID REFERENCES profiles(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE sms_send_log IS
  '사전 안내 SMS 발송 이력 — 1행 = 1수신자(append-only). 발송 결과의 단일 원천 (소방계획서_24 S1)';
COMMENT ON COLUMN sms_send_log.visit_date IS
  '발송 시점의 방문일 — 미발송 판정 키는 (customer_id, visit_date). 점검일을 옮기면 자동으로 재안내 대상이 된다';
COMMENT ON COLUMN sms_send_log.lead_days IS
  'visit_date - 실제 발송일(KST). 배너 규칙값이 아니라 실측값';
COMMENT ON COLUMN sms_send_log.status IS
  'sending/sent/unverified/failed/no_phone — unverified는 응답 스키마 인식 실패. failed로 두면 실제 나간 문자를 재발송한다';

-- 조회 축: ①미발송 판정·재안내(고객+방문일) ②화면 기간 필터 ③재발송용 실패 필터
CREATE INDEX IF NOT EXISTS idx_sms_send_log_cust_visit ON sms_send_log(customer_id, visit_date);
CREATE INDEX IF NOT EXISTS idx_sms_send_log_visit      ON sms_send_log(visit_date);
CREATE INDEX IF NOT EXISTS idx_sms_send_log_status     ON sms_send_log(status);

-- 멱등 유니크 인덱스는 **걸지 않는다**(G-11).
-- 승인 방식에서는 재발송이 정당한 경우가 있다 — 실패 재시도, 일정 변경 후 재안내.
-- 중복은 화면의 '이미 발송됨' 배지 + 발송 확인 1회로 사람이 판단한다.
-- 자동 크론(S10)을 켤 때 그때 부분 유니크 인덱스를 별도 마이그레이션으로 추가한다.

ALTER TABLE sms_send_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sms_send_log_select_all" ON sms_send_log
  FOR SELECT USING (auth.uid() IS NOT NULL);
-- 쓰기는 서버 액션(service role)만 — 권한은 permissions.ts의 inspection_sms_send로 판정한다 (130 패턴)
CREATE POLICY "sms_send_log_admin_write" ON sms_send_log
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('manager', 'admin'))
  );

CREATE TRIGGER trg_sms_send_log_updated_at
  BEFORE UPDATE ON sms_send_log
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 관계인별 '문자 받음' 지정 (Q-10) ──────────────────────────
-- NULL = 미지정. 고객의 관계인 중 **하나도 지정하지 않았으면** 기존 우선순위
-- (지정관계인 → 대표 → 직원1 → 직원2)로 1명에게만 보낸다.
-- 폴백을 두는 이유: 기존 고객 수백 곳을 일괄 설정하지 않아도 되고,
-- 도입만으로 문자량이 갑자기 몇 배가 되는 사고도 없다.
ALTER TABLE customer_contacts ADD COLUMN IF NOT EXISTS sms_recipient BOOLEAN;
COMMENT ON COLUMN customer_contacts.sms_recipient IS
  '사전 안내 SMS 수신 지정 — NULL(미지정)이면 고객 단위로 우선순위 1명 폴백 (소방계획서_24 Q-10)';

-- 후속 과제(이번 범위 밖): 수신거부 customer_contacts.sms_opt_out — 발송 필터에 반영해야 한다.
