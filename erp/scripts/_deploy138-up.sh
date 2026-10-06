#!/usr/bin/env bash
# 138회차 운영 배포 — 9dd5cefe → 8e713b2c · 앱 재빌드 · 마이그 0 · caddy 무접촉
#   앱 이미지에 닿는 것: 8e713b2c(고객 탭 이름 「건물·시설」→「건물정보」 — 탭·진행 띠·안내 문구)
#   그 밖: 04898c8a(137 기록, 스크립트만).
#
# 착수 실측(2026-10-06): 서버 HEAD 9dd5cef·dirty 0·img 585868c6ef61·caddy ratelimit·inflight 0·availMB 2362·
#   rollback-9dd5cef = 585868c6ef61(현 서빙 이미지 — 이번 회차 복귀점).
# 마커(운영 before): 「건물·시설」15 · 「건물정보」2 · building-group 2 · new-group-building 2.
set -u
EXPECT_HEAD=9dd5cefe
EXPECT_IMG=585868c6ef61
ROLLBACK_TAG=erp-app:rollback-9dd5cef
EXPECT_TARGET=8e713b2c
EXPECT_CADDY=sjfire-caddy:2.11.4-ratelimit
export COMPOSE_PARALLEL_LIMIT=1

cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }
[ -f docker-compose.prod.yml ] || { echo FATAL_NO_COMPOSE; exit 10; }
echo "=== GUARD ==="
H=$(git -C /home/ubuntu/woni rev-parse HEAD)
D=$(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)
R=$(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
CI=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1 2>/dev/null)
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
echo "HEAD=$H (기대 $EXPECT_HEAD*) · dirty=$D · img=$R (기대 $EXPECT_IMG) · caddy=$CI · inflight=$INFLIGHT"
case "$H" in $EXPECT_HEAD*) ;; *) echo GUARD_FAIL_HEAD; exit 21;; esac
[ "$D" = "0" ]              || { echo GUARD_FAIL_DIRTY; exit 22; }
[ "$R" = "$EXPECT_IMG" ]    || { echo GUARD_FAIL_IMG; exit 23; }
[ "$CI" = "$EXPECT_CADDY" ] || { echo GUARD_FAIL_CADDY; exit 25; }
[ "$INFLIGHT" = "0" ]       || { echo GUARD_FAIL_INFLIGHT; exit 24; }
AVAIL=$(free -m | awk '/^Mem:/{print $7}')
echo "availMB=$AVAIL"
[ "$AVAIL" -ge 1500 ] || { echo GUARD_FAIL_LOWMEM; exit 26; }
echo "=== 복귀점 확인 ==="
RB=$(docker inspect --format '{{.Id}}' "$ROLLBACK_TAG" 2>/dev/null | cut -c8-19)
[ "$RB" = "$EXPECT_IMG" ] || { echo "GUARD_FAIL_ROLLBACK:$RB"; exit 27; }
echo "복귀점 $ROLLBACK_TAG = $RB"
echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
TARGET=$(git -C /home/ubuntu/woni rev-parse "$EXPECT_TARGET") || { echo GUARD_FAIL_TARGET_UNKNOWN; exit 35; }
git -C /home/ubuntu/woni merge-base --is-ancestor "$TARGET" origin/main || { echo GUARD_FAIL_TARGET_NOT_IN_ORIGIN; exit 35; }
for C in 8e713b2c; do
  git -C /home/ubuntu/woni merge-base --is-ancestor "$C" "$TARGET" || { echo "MINE_NOT_IN_TARGET:$C"; exit 32; }
done
MIG=$(git -C /home/ubuntu/woni diff --name-only HEAD.."$TARGET" -- erp/supabase/migrations)
[ -z "$MIG" ] || { echo "GUARD_FAIL_MIGRATION:[$MIG]"; exit 34; }
CADDYCH=$(git -C /home/ubuntu/woni diff --name-only HEAD.."$TARGET" -- erp/deploy erp/docker-compose.prod.yml erp/Dockerfile)
[ -z "$CADDYCH" ] || { echo "GUARD_FAIL_INFRA:[$CADDYCH]"; exit 36; }
git -C /home/ubuntu/woni merge --ff-only "$TARGET" || { echo FF_FAIL; exit 31; }
NEW=$(git -C /home/ubuntu/woni rev-parse HEAD); echo "HEAD_NOW=$NEW"
[ "$NEW" = "$TARGET" ] || { echo FF_MISMATCH; exit 33; }
echo "=== BUILD & UP (수 분 걸린다) ==="
docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -25
UP_RC=${PIPESTATUS[0]}; echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }
sleep 8
echo "caddy status=$(docker inspect --format '{{.State.Status}}' erp-caddy-1) image=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1)"
echo "=== 다음 회차 복귀점 ==="
SHORT=$(git -C /home/ubuntu/woni rev-parse --short HEAD)
docker tag erp-app:latest "erp-app:rollback-$SHORT" && echo "tagged erp-app:rollback-$SHORT"
docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19
echo UP_SCRIPT_DONE
