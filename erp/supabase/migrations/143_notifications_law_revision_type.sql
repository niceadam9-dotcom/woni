-- 143: notifications.type에 'law_revision' 추가 (2026-08-19)
--
-- 결함: api/cron/law-revision-check가 법제처 서식 개정을 감지하면 관리자에게
--   type='law_revision' 알림을 넣는데, 그 값이 CHECK 제약에 없어 **insert가 항상 실패**했다.
--   라우트는 insert 오류를 확인하지 않고(선행 코드) 바로 기준일(announce_date)을 갱신했으므로
--   다음 실행에서는 entry.date > base.announce_date가 거짓이 되어 **다시는 감지되지 않는다**.
--   즉 개정이 감지된 사실이 통째로 사라지고, 재심기(seed-*.py)가 영영 돌지 않는다 —
--   법정 서식이 바뀌었는데 옛 서식으로 계속 문서를 만들게 된다.
--   실측(2026-08-19, 스테이징): 관리자 14명인데 law_revision 알림 0건.
--
-- 라우트 쪽도 함께 고친다: insert 오류를 확인하고, 알림이 실패하면 **기준일을 올리지 않는다**
--   (다음 실행이 다시 시도하도록 — 신호를 잃는 것이 최악이다).
--
-- reference_type='document'는 기존 CHECK에 이미 있어 손대지 않는다.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[
  'approval_request'::text,
  'approved'::text,
  'rejected'::text,
  'recalled'::text,
  'leave_request'::text,
  'leave_approved'::text,
  'leave_rejected'::text,
  'inspection_assigned'::text,
  'inspection_step_due'::text,
  'inspection_step_overdue'::text,
  'inspection_completed'::text,
  'insurance_expiry_due'::text,
  'insurance_expiry_overdue'::text,
  'defect_action_due'::text,
  'defect_action_overdue'::text,
  'report_submit_due'::text,
  'report_submit_overdue'::text,
  'weekly_doc_briefing'::text,
  'law_revision'::text
]));

COMMENT ON COLUMN notifications.type IS
  '알림 종류. 발신부(크론·서버 액션)와 이 CHECK가 어긋나면 insert가 조용히 실패한다 — 늘리는 순서: 이 CHECK → 발신부 → src/lib/inspection-notify-dismiss.ts 목록';
