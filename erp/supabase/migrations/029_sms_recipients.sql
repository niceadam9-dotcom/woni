-- SMS 발신번호 / 수신자 기록 컬럼 추가
ALTER TABLE inspection_status_log
  ADD COLUMN IF NOT EXISTS sms_sender_phone TEXT,
  ADD COLUMN IF NOT EXISTS sms_recipients   JSONB;  -- [{role, name, phone}]
