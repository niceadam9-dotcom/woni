#!/usr/bin/env bash
# 야간 백업 — Supabase DB 덤프 + Storage 미러 → S3 호환 오브젝트 스토리지
#
# 정본은 이 파일이다. VPS에서는 /etc/cron.d/sjfire-erp(deploy/cron/sjfire-erp.cron 사본)가
# 매일 02:00(서버 TZ=KST)에 root로 실행한다. 설치·복구 절차는 같은 폴더의 BACKUP.md.
#
# 산출물 (오브젝트 스토리지, 버킷 $BACKUP_BUCKET)
#   db/<YYYY-MM-DD>/schema-public.sql.gz   public 스키마 정의 (참조용 — 정본은 git의 supabase/migrations)
#   db/<YYYY-MM-DD>/data.sql.gz            public·auth·storage 스키마 데이터 (COPY 형식, 복원 입력)
#   db/<YYYY-MM-DD>/MANIFEST.json          크기·행수·소요 시간
#   storage/<bucket>/...                   Supabase Storage 전 버킷 미러 (최신 상태)
#   storage-deleted/<YYYY-MM-DD>/...       미러에서 지워지거나 바뀐 파일의 이전 판 (삭제 사고 복구용)
#   heartbeat/last-success.txt             마지막 성공 시각 (신선도 감시용)
#
# 보존: db/·storage-deleted/는 $RETENTION_DAYS(기본 35)일 뒤 삭제. storage/는 미러라 삭제 없음.
#
# 비밀은 전부 /etc/sjfire/backup.env(600, root)와 rclone.conf에만 둔다. 이 파일에는 적지 않는다.
#   (2026-07-09 service_role 키 공개 저장소 노출 → 전량 로테이션 전례.)
#
# 필요 패키지: postgresql-client(pg_dump ≥ 15 — Ubuntu 24.04의 16이면 된다), rclone, gzip, curl, jq
# 종료 코드: 0 성공 / 그 외 실패(로그 + $BACKUP_ALERT_URL/fail 핑)

set -euo pipefail

ENV_FILE="${BACKUP_ENV_FILE:-/etc/sjfire/backup.env}"
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL 없음 (Session pooler 접속 문자열, 포트 5432)}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET 없음 (오브젝트 스토리지 버킷명)}"
OBJ_REMOTE="${OBJ_REMOTE:-obj}"            # rclone 원격 이름 — 오브젝트 스토리지(S3 호환)
SUPA_REMOTE="${SUPA_REMOTE:-supa}"         # rclone 원격 이름 — Supabase Storage S3 엔드포인트
RCLONE_CONFIG="${RCLONE_CONFIG:-/etc/sjfire/rclone.conf}"
RETENTION_DAYS="${RETENTION_DAYS:-35}"
MIN_DATA_BYTES="${MIN_DATA_BYTES:-20000}"  # 압축 데이터 덤프가 이보다 작으면 실패로 본다(빈 덤프 방지)
BACKUP_ALERT_URL="${BACKUP_ALERT_URL:-}"   # healthchecks.io 류 핑 URL (선택). 실패 시 ${URL}/fail
export RCLONE_CONFIG

DATE="$(date +%F)"
STAMP="$(date +%FT%T%z)"
WORK="$(mktemp -d /tmp/sjfire-backup.XXXXXX)"
START=$(date +%s)
DEST="${OBJ_REMOTE}:${BACKUP_BUCKET}"

log() { printf '%s [backup] %s\n' "$(date +%FT%T)" "$*"; }
fail() {
  log "실패: $*"
  [ -n "$BACKUP_ALERT_URL" ] && curl -fsS -m 10 --retry 2 -d "$*" "${BACKUP_ALERT_URL}/fail" >/dev/null 2>&1 || true
  rm -rf "$WORK"
  exit 1
}
trap 'fail "줄 $LINENO에서 중단"' ERR

log "시작 — 대상 $(sed -E 's#//[^@]*@#//***@#' <<<"$SUPABASE_DB_URL") → ${DEST}/db/${DATE}"

# ── 1. DB 덤프 ───────────────────────────────────────────────────────────────
# schema-public: 정의만. 정본은 git 마이그레이션이고 이것은 드리프트 대조·비상용이다.
pg_dump "$SUPABASE_DB_URL" \
  --schema-only --schema=public \
  --no-owner --no-privileges --quote-all-identifiers \
  | gzip -6 > "$WORK/schema-public.sql.gz"

# data: public 전부 + auth(사용자·비밀번호 해시·identities) + storage(버킷·객체 메타).
#   auth.audit_log_entries는 크고 복원에 불필요, *.migrations는 Supabase가 관리하므로 제외.
#   COPY 형식 평문 → 복원은 psql + session_replication_role=replica (BACKUP.md §복구).
pg_dump "$SUPABASE_DB_URL" \
  --data-only --schema=public --schema=auth --schema=storage \
  --exclude-table-data='auth.audit_log_entries' \
  --exclude-table='auth.schema_migrations' --exclude-table='storage.migrations' \
  --exclude-table-data='storage.s3_multipart_uploads*' \
  --no-owner --no-privileges --quote-all-identifiers \
  | gzip -6 > "$WORK/data.sql.gz"

DATA_BYTES=$(stat -c %s "$WORK/data.sql.gz")
SCHEMA_BYTES=$(stat -c %s "$WORK/schema-public.sql.gz")
gzip -t "$WORK/data.sql.gz" "$WORK/schema-public.sql.gz"
[ "$DATA_BYTES" -ge "$MIN_DATA_BYTES" ] || fail "데이터 덤프가 너무 작다 (${DATA_BYTES}B < ${MIN_DATA_BYTES}B)"

# 핵심 표 행수 — 덤프가 비어 있지 않음을 숫자로 남긴다 (customers 0이면 실패)
COUNTS_JSON=$(psql "$SUPABASE_DB_URL" -At -v ON_ERROR_STOP=1 -c "
  select json_build_object(
    'customers',   (select count(*) from public.customers),
    'inspections', (select count(*) from public.inspections),
    'profiles',    (select count(*) from public.profiles),
    'auth_users',  (select count(*) from auth.users),
    'storage_objects', (select count(*) from storage.objects)
  )")
CUSTOMERS=$(jq -r '.customers' <<<"$COUNTS_JSON")
[ "$CUSTOMERS" -gt 0 ] || fail "customers 행수 0 — 대상 DB가 비어 있거나 접속이 잘못됐다"
log "DB 덤프 완료 — data ${DATA_BYTES}B, schema ${SCHEMA_BYTES}B, 행수 ${COUNTS_JSON}"

# ── 2. Storage 미러 ─────────────────────────────────────────────────────────
# Supabase Storage의 S3 호환 엔드포인트(원격 $SUPA_REMOTE) 전 버킷 → storage/ 미러.
# 지워지거나 바뀐 파일은 storage-deleted/<날짜>/ 로 옮겨 RETENTION_DAYS 동안 남긴다.
rclone sync "${SUPA_REMOTE}:" "${DEST}/storage" \
  --backup-dir "${DEST}/storage-deleted/${DATE}" \
  --fast-list --transfers 8 --checkers 16 --retries 3 --low-level-retries 10 \
  --stats-one-line --stats 0 --log-level NOTICE
STORAGE_FILES=$(rclone size "${DEST}/storage" --json | jq -r '.count')
STORAGE_BYTES=$(rclone size "${DEST}/storage" --json | jq -r '.bytes')
log "Storage 미러 완료 — 파일 ${STORAGE_FILES}개, ${STORAGE_BYTES}B"

# ── 3. 매니페스트 + 업로드 ──────────────────────────────────────────────────
ELAPSED=$(( $(date +%s) - START ))
jq -n \
  --arg at "$STAMP" --arg date "$DATE" \
  --argjson counts "$COUNTS_JSON" \
  --argjson data_bytes "$DATA_BYTES" --argjson schema_bytes "$SCHEMA_BYTES" \
  --argjson storage_files "$STORAGE_FILES" --argjson storage_bytes "$STORAGE_BYTES" \
  --argjson elapsed_s "$ELAPSED" \
  --arg pg_dump "$(pg_dump --version)" --arg rclone "$(rclone version | head -1)" \
  '{at:$at, date:$date, counts:$counts, data_sql_gz_bytes:$data_bytes, schema_sql_gz_bytes:$schema_bytes,
    storage_files:$storage_files, storage_bytes:$storage_bytes, elapsed_s:$elapsed_s,
    tools:{pg_dump:$pg_dump, rclone:$rclone}}' > "$WORK/MANIFEST.json"

rclone copy "$WORK" "${DEST}/db/${DATE}" --stats-one-line --stats 0 --log-level NOTICE
# 업로드 대조 — 크기 불일치면 실패
rclone check "$WORK" "${DEST}/db/${DATE}" --size-only --one-way --log-level ERROR

# ── 4. 보존 정리 ────────────────────────────────────────────────────────────
rclone delete "${DEST}/db" --min-age "${RETENTION_DAYS}d" --log-level ERROR || true
rclone delete "${DEST}/storage-deleted" --min-age "${RETENTION_DAYS}d" --log-level ERROR || true
rclone rmdirs "${DEST}/db" --leave-root --log-level ERROR || true
rclone rmdirs "${DEST}/storage-deleted" --leave-root --log-level ERROR || true

# ── 5. 하트비트 ─────────────────────────────────────────────────────────────
printf '%s\n' "$STAMP" > "$WORK/last-success.txt"
rclone copyto "$WORK/last-success.txt" "${DEST}/heartbeat/last-success.txt" --log-level ERROR
[ -n "$BACKUP_ALERT_URL" ] && curl -fsS -m 10 --retry 2 "$BACKUP_ALERT_URL" >/dev/null 2>&1 || true

rm -rf "$WORK"
log "완료 — ${ELAPSED}s, ${DEST}/db/${DATE}"
