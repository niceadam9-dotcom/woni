-- 107: 회사 메일 발송 이력 (2026-07-23) — 공용 계정(sjfirekorea) 발신의 작성 직원 추적(거버넌스)
CREATE TABLE IF NOT EXISTS mail_send_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id        UUID REFERENCES profiles(id) ON DELETE SET NULL,  -- 실제 작성 직원
  recipients       TEXT NOT NULL,                                    -- 쉼표 구분
  cc               TEXT,
  subject          TEXT NOT NULL,
  message_id       TEXT,                                             -- Gmail 발송 message id
  reply_to_gmail   TEXT,                                             -- 답장 원본 Gmail 메시지 id
  attachment_count INTEGER NOT NULL DEFAULT 0,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mail_send_logs_sent ON mail_send_logs(sent_at DESC);
ALTER TABLE mail_send_logs ENABLE ROW LEVEL SECURITY;
