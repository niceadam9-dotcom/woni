-- 180: 불량 등록 멱등 키 (통합 실행계획 C1 Phase E — 모바일 불량·사진 오프라인, 2026-10-04)
--
-- 오프라인 큐는 at-least-once다 — 전송 중 연결이 끊기면 서버는 저장했는데 앱은 실패로 알고
-- 다시 보낸다. 점검표 응답은 (inspection_id,item_code,month) 유니크 upsert라 재전송이 무해하지만,
-- 불량은 insert라 같은 불량이 두 번 들어간다(별지 9·10·11호에 중복 인쇄).
-- 앱이 불량마다 만든 키를 같이 보내고, 서버는 같은 키가 이미 있으면 그 행을 돌려준다.
--
-- 비파괴: NULL 허용 열 하나 + 부분 유니크 인덱스. 웹 등록·기존 행은 NULL이라 제약 밖이다.
ALTER TABLE inspection_defects ADD COLUMN IF NOT EXISTS client_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inspection_defects_client_key
  ON inspection_defects (inspection_id, client_key)
  WHERE client_key IS NOT NULL;

COMMENT ON COLUMN inspection_defects.client_key IS
  '모바일 오프라인 큐 멱등 키 — 같은 (inspection_id, client_key) 재전송은 기존 행을 돌려준다. 웹 등록은 NULL';
