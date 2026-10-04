#!/usr/bin/env bash
# 스테이징 재가동 2단계 — 빌드가 끝난 뒤: 번들이 운영 DB를 가리키지 않는지 확인 → up -d → 검증
set -u
STG_REF=nwflnzugwylhpdyodyog
PROD_REF=ryuozdhnilfjlahorizh
cd /home/ubuntu/woni-staging/erp || { echo FATAL_NO_DIR; exit 9; }
tail -3 staging-build.log
grep -qiE 'error|failed' <(tail -20 staging-build.log) && { echo BUILD_LOG_HAS_ERROR; exit 50; }
IMG=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^erp-staging' | head -1)
echo "image=$IMG"
[ -n "$IMG" ] || { echo NO_STAGING_IMAGE; exit 51; }

echo "=== 번들 축 확인(운영 ref 0 · 스테이징 ref ≥1) ==="
P=$(docker run --rm --entrypoint sh "$IMG" -c "grep -rl $PROD_REF /app/.next 2>/dev/null | wc -l")
S=$(docker run --rm --entrypoint sh "$IMG" -c "grep -rl $STG_REF /app/.next 2>/dev/null | wc -l")
echo "bundle files with prod ref=$P · staging ref=$S"
[ "$P" = "0" ] || { echo "GUARD_FAIL_BUNDLE_HAS_PROD — 올리지 않는다"; exit 52; }
[ "$S" -ge 1 ] || { echo GUARD_FAIL_BUNDLE_NO_STAGING; exit 53; }

AVAIL=$(free -m | awk '/^Mem:/{print $7}'); echo "availMB=$AVAIL"
[ "$AVAIL" -ge 1200 ] || { echo GUARD_FAIL_LOWMEM; exit 26; }
echo "=== UP ==="
docker compose -f docker-compose.staging.yml up -d 2>&1 | tail -6
for i in $(seq 1 24); do
  H=$(docker inspect --format '{{.State.Health.Status}}' erp-staging-app 2>/dev/null); [ "$H" = "healthy" ] && break; sleep 5
done
echo "erp-staging-app=$(docker inspect --format '{{.State.Health.Status}}' erp-staging-app) · gotenberg-staging=$(docker inspect --format '{{.State.Health.Status}}' gotenberg-staging)"
echo "nets=$(docker inspect --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' erp-staging-app)"

echo "=== VERIFY ==="
FAIL=0
chk() { if [ "$2" = "$3" ]; then echo "  ✅ $1 = $2"; else echo "  ❌ $1 = $2 (기대 $3)"; FAIL=$((FAIL+1)); fi; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1"; }
chk "staging /login" "$(code https://staging.sjfire.co.kr/login)" 200
chk "staging noindex" "$(curl -sI --max-time 20 https://staging.sjfire.co.kr/login | grep -ci '^x-robots-tag:')" 1
chk "staging 컨테이너 SMS_DRY_RUN" "$(docker exec erp-staging-app printenv SMS_DRY_RUN)" ON
chk "staging 런타임 DB=스테이징" "$(docker exec erp-staging-app printenv NEXT_PUBLIC_SUPABASE_URL | grep -c $STG_REF)" 1
chk "staging이 운영망(erp_default)에 없음" "$(docker inspect --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' erp-staging-app | grep -c 'erp_default ')" 0
chk "운영 /login" "$(code https://sjfire.co.kr/login)" 200
chk "운영 /api/health" "$(code https://sjfire.co.kr/api/health)" 200
chk "www /" "$(code https://www.sjfire.co.kr/)" 200
chk "운영 app healthy" "$(docker inspect --format '{{.State.Health.Status}}' erp-app-1)" healthy
free -m | head -2
echo "VERIFY_FAIL=$FAIL"
