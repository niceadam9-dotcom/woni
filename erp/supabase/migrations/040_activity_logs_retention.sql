-- 040_activity_logs_retention.sql
-- 활동로그 보존 정책 지원 (2026-07-08)
--
-- 배경: activity_logs는 001에서 RULE(no_update/no_delete ... DO INSTEAD NOTHING)로
--       완전 불변 — service role도 삭제 불가라 보존기간(2년) 경과분 파기가 불가능했다.
-- 조치: UPDATE 차단은 유지. DELETE 차단은 RULE → 트리거로 교체하되,
--       purge_activity_logs() SECURITY DEFINER 함수를 통한 경로만 허용한다.
--       (함수가 트랜잭션 한정 플래그를 세팅 → 트리거가 그 플래그 있을 때만 통과)
-- 호출: 크론 /api/cron/purge-activity-logs 가 아카이브(Storage 업로드) 성공분의
--       id 배열로 RPC 호출 — 아카이브 안 된 행은 절대 삭제되지 않음.

-- DELETE 차단 RULE 제거 (UPDATE RULE은 유지)
DROP RULE IF EXISTS no_delete_logs ON activity_logs;

-- 보존 파기 플래그 없이는 DELETE 차단
CREATE OR REPLACE FUNCTION block_activity_log_delete()
RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_log_purge', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'activity_logs is append-only — use purge_activity_logs() for retention purge';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_activity_log_delete ON activity_logs;
CREATE TRIGGER trg_block_activity_log_delete
  BEFORE DELETE ON activity_logs
  FOR EACH ROW EXECUTE FUNCTION block_activity_log_delete();

-- 보존 파기 함수 — 아카이브 완료된 id 목록만 정확히 삭제
CREATE OR REPLACE FUNCTION purge_activity_logs(purge_ids uuid[])
RETURNS integer
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  PERFORM set_config('app.allow_log_purge', 'on', true);  -- 트랜잭션 한정
  DELETE FROM activity_logs WHERE id = ANY(purge_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

-- service role 전용 — 클라이언트 키로 호출 불가
REVOKE ALL ON FUNCTION purge_activity_logs(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION purge_activity_logs(uuid[]) FROM anon;
REVOKE ALL ON FUNCTION purge_activity_logs(uuid[]) FROM authenticated;
