#!/usr/bin/env bash
# 스테이징 재가동 (2026-10-04) — staging.sjfire.co.kr 502: erp-staging-app·gotenberg-staging 컨테이너·이미지·
#   /home/ubuntu/woni-staging 체크아웃이 전부 없어진 상태(132회차에서 발견, 경위 불명).
# 운영 무접촉: 운영 checkout(/home/ubuntu/woni)·운영 컨테이너·운영 compose는 건드리지 않는다.
# 기준 코드: main 5a643c4b(운영 135회차와 동일)(staging 브랜치는 08-04에서 멈춰 main보다 884커밋 뒤라 쓰지 않는다).
# 전제: 로컬에서 scp로 /home/ubuntu/.env.staging.upload 를 올려 두었다(로컬 erp/.env.staging).
#
# 🚨 함정: 체크아웃엔 운영 .env.production이 들어 있고 Next 빌드는 그 파일을 읽는다 → 덮지 않으면
#    스테이징 번들에 운영 Supabase 주소가 구워진다. 그래서 env가 스테이징 ref를 가리키는지 빌드 전후로 확인한다.
set -u
SRC_SHA=5a643c4b   # 운영과 같은 코드(서버 HEAD). 70d69d9d는 그 뒤 기록 커밋뿐이라 서버에 없다
STG_REF=nwflnzugwylhpdyodyog     # 스테이징 Supabase
PROD_REF=ryuozdhnilfjlahorizh    # 운영 Supabase — 스테이징 env·번들에 있으면 즉시 중단
DIR=/home/ubuntu/woni-staging
UP=/home/ubuntu/.env.staging.upload
export COMPOSE_PARALLEL_LIMIT=1

echo "=== GUARD ==="
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
AVAIL=$(free -m | awk '/^Mem:/{print $7}')
PH=$(docker inspect --format '{{.State.Health.Status}}' erp-app-1 2>/dev/null)
echo "inflight=$INFLIGHT · availMB=$AVAIL · prod app=$PH"
[ "$INFLIGHT" = "0" ]    || { echo GUARD_FAIL_INFLIGHT; exit 24; }
[ "$AVAIL" -ge 1500 ]    || { echo GUARD_FAIL_LOWMEM; exit 26; }
[ "$PH" = "healthy" ]    || { echo GUARD_FAIL_PROD_UNHEALTHY; exit 27; }
[ ! -e "$DIR" ]          || { echo "GUARD_FAIL_DIR_EXISTS — $DIR 가 이미 있다(누가 만들었는지 먼저 확인)"; exit 28; }
[ -f "$UP" ]             || { echo GUARD_FAIL_NO_ENV_UPLOAD; exit 29; }
docker network inspect erp_staging_edge >/dev/null 2>&1 || { echo GUARD_FAIL_NO_EDGE_NET; exit 30; }

echo "=== CHECKOUT (운영 저장소에서 로컬 클론) ==="
git clone --quiet /home/ubuntu/woni "$DIR" || { echo CLONE_FAIL; exit 31; }
git -C "$DIR" checkout --quiet --detach "$SRC_SHA" || { echo CHECKOUT_FAIL; exit 32; }
echo "staging HEAD=$(git -C "$DIR" rev-parse --short HEAD)"
cd "$DIR/erp" || exit 33

echo "=== ENV (스테이징 키 · SMS 드라이런 강제 · 서버 액션 고정키) ==="
install -m 600 "$UP" .env.staging && rm -f "$UP"
# 로컬(Windows) 파일은 CRLF — 값 끝 \r이 URL을 망가뜨리고(curl 000) 덧붙인 줄이 앞 줄에 붙는다(1차 실행 실측)
sed -i 's/\r$//' .env.staging
[ -z "$(tail -c1 .env.staging)" ] || echo >> .env.staging
grep -q "$STG_REF" .env.staging   || { echo GUARD_FAIL_ENV_NOT_STAGING; exit 40; }
grep -q "$PROD_REF" .env.staging  && { echo GUARD_FAIL_ENV_HAS_PROD; exit 41; }
# 스테이징 DB엔 실명단으로 추정되는 고객이 있다 — 실발송 키가 살아 있으므로 드라이런을 강제한다
sed -i '/^SMS_DRY_RUN=/d' .env.staging && echo 'SMS_DRY_RUN=ON' >> .env.staging
grep -q '^NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=' .env.staging || echo "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env.staging
# Next 빌드는 .env.production을 읽는다 — 운영 파일을 스테이징 값으로 덮는다(compose 주석의 규약)
install -m 600 .env.staging .env.production
grep -q "$PROD_REF" .env.production && { echo GUARD_FAIL_PRODENV_NOT_OVERWRITTEN; exit 42; }
grep -q $'\r' .env.staging && { echo GUARD_FAIL_ENV_CRLF; exit 44; }
[ "$(grep '^SMS_DRY_RUN=' .env.staging | cut -d= -f2)" = "ON" ] || { echo GUARD_FAIL_DRYRUN_NOT_ON; exit 45; }
echo "env ok — keys: $(grep -c '=' .env.staging) · SMS_DRY_RUN=$(grep '^SMS_DRY_RUN=' .env.staging | cut -d= -f2)"

echo "=== STAGING DB 접속 확인 ==="
SU=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.staging | cut -d= -f2-)
SK=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.staging | cut -d= -f2-)
DBC=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SU/rest/v1/company_profile?select=company_name&limit=1" -H "apikey: $SK" -H "Authorization: Bearer $SK")
echo "staging db http=$DBC"
[ "$DBC" = "200" ] || { echo "GUARD_FAIL_STAGING_DB — 키 만료·프로젝트 일시정지(free tier 1주 미사용) 가능"; exit 43; }

echo "=== BUILD (nohup 분리 — 로그 $DIR/erp/staging-build.log) ==="
nohup docker compose -f docker-compose.staging.yml build > staging-build.log 2>&1 &
echo "BUILD_PID=$!"
echo UP_PHASE1_DONE
