-- 122: Realtime 활성화 (소방계획서_16 S5-1 · K-3)
-- postgres_changes는 supabase_realtime publication에 등록된 테이블만 이벤트를 낸다.
-- 지금까지 등록 테이블이 0개여서 알림 벨(notification-bell.tsx)의 실시간 수신도
-- 한 번도 동작한 적이 없다 — 점검표 응답과 함께 notifications도 등록한다.
-- (계획 당시 번호 119는 plan_text_library가 선점 — 122로 이월)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'inspection_sheet_responses'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.inspection_sheet_responses;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- REPLICA IDENTITY FULL — UPDATE의 old 레코드 보존용.
-- ⚠ 실측(2026-08-10 스테이징): DELETE는 FULL이어도 Realtime이 old를 PK(id)로 잘라 전달하고
--   filter도 적용하지 않는다 — 클라이언트(use-sheet-responses-realtime)는 DELETE를 무필터로
--   받아 구독 건 전체 갱신으로 처리한다.
ALTER TABLE public.inspection_sheet_responses REPLICA IDENTITY FULL;
