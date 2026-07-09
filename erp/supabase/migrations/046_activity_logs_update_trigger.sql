-- 046: activity_logs UPDATE 차단을 RULE → 트리거로 교체 (2026-07-09)
--
-- 문제: 001의 no_update_logs RULE(DO INSTEAD NOTHING)이 profiles 삭제 시
--   FK(actor_id ON DELETE SET NULL)의 내부 UPDATE까지 조용히 무효화
--   → actor_id가 삭제된 프로필을 계속 참조 → FK 위반으로 auth 사용자 삭제가
--   "Database error deleting user"(500)로 실패. (테스트 계정 삭제 불가 원인 — 실증 2026-07-09)
-- 조치: RULE 제거. BEFORE UPDATE 트리거로 대체하되, 참조 무결성 SET NULL 경로
--   (actor_id만 NULL로 바뀌고 나머지 컬럼 불변)만 허용하고 그 외 수정은 차단.
--   append-only 감사 무결성은 유지된다 (040의 DELETE 차단 트리거와 짝).

DROP RULE IF EXISTS no_update_logs ON activity_logs;

CREATE OR REPLACE FUNCTION block_activity_log_update()
RETURNS trigger AS $$
BEGIN
  -- FK ON DELETE SET NULL 경로: actor_id만 NULL로 변경되는 경우 허용
  IF NEW.actor_id IS NULL AND OLD.actor_id IS NOT NULL
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.action IS NOT DISTINCT FROM OLD.action
     AND NEW.entity_type IS NOT DISTINCT FROM OLD.entity_type
     AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
     AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata
     AND NEW.ip_address IS NOT DISTINCT FROM OLD.ip_address
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'activity_logs is append-only — only FK SET NULL on actor_id is allowed';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_activity_log_update ON activity_logs;
CREATE TRIGGER trg_block_activity_log_update
  BEFORE UPDATE ON activity_logs
  FOR EACH ROW EXECUTE FUNCTION block_activity_log_update();

-- 검증:
-- (a) UPDATE activity_logs SET action='x' → 예외 발생해야 함
-- (b) 테스트 계정 auth 삭제 → 성공, 해당 로그의 actor_id는 NULL로 남고 행은 보존
