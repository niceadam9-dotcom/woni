-- ============================================================
-- messages — 사내 쪽지
-- ============================================================
CREATE TABLE messages (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id                UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_id             UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject                  TEXT        NOT NULL,
  body                     TEXT        NOT NULL,
  is_read                  BOOLEAN     NOT NULL DEFAULT FALSE,
  read_at                  TIMESTAMPTZ,
  is_deleted_by_sender     BOOLEAN     NOT NULL DEFAULT FALSE,
  is_deleted_by_recipient  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_recipient ON messages(recipient_id, is_read);
CREATE INDEX idx_messages_sender    ON messages(sender_id);
CREATE INDEX idx_messages_created   ON messages(created_at DESC);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_sender_read" ON messages
  FOR SELECT USING (sender_id = auth.uid() AND is_deleted_by_sender = FALSE);

CREATE POLICY "messages_recipient_read" ON messages
  FOR SELECT USING (recipient_id = auth.uid() AND is_deleted_by_recipient = FALSE);

CREATE POLICY "messages_insert" ON messages
  FOR INSERT WITH CHECK (sender_id = auth.uid());

CREATE POLICY "messages_update_recipient" ON messages
  FOR UPDATE USING (recipient_id = auth.uid());

CREATE POLICY "messages_update_sender" ON messages
  FOR UPDATE USING (sender_id = auth.uid());
