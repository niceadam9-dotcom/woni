#!/usr/bin/env bash
# 126회차 재개(up B) — ff는 어제 완료(HEAD=f183ab37), wedge로 빌드 전 중단 → build & up부터.
#   가드가 원판(_deploy126-up.sh)과 다른 이유: EXPECT_HEAD가 **타깃**(f183ab37)이고 ff 단계가 없다.
set -u
EXPECT_HEAD=f183ab37
EXPECT_IMG=d7c0f0d6d8ae   # 125회차 after — 아직 이 이미지가 서빙 중이어야 한다
EXPECT_CADDY=sjfire-caddy:2.11.4-ratelimit
export COMPOSE_PARALLEL_LIMIT=1
cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }
echo "=== GUARD ==="
H=$(git -C /home/ubuntu/woni rev-parse HEAD)
D=$(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)
R=$(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
CI=$(docker inspect --format '{{.Config.Image}}' erp-caddy-1 2>/dev/null)
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
FREE=$(free -m | awk 'NR==2{print $7}')
echo "HEAD=$H dirty=$D img=$R caddy=$CI inflight=$INFLIGHT availMB=$FREE"
case "$H" in $EXPECT_HEAD*) ;; *) echo GUARD_FAIL_HEAD; exit 21;; esac
[ "$D" = "0" ] || { echo GUARD_FAIL_DIRTY; exit 22; }
[ "$R" = "$EXPECT_IMG" ] || { echo GUARD_FAIL_IMG; exit 23; }
[ "$CI" = "$EXPECT_CADDY" ] || { echo GUARD_FAIL_CADDY; exit 25; }
[ "$INFLIGHT" = "0" ] || { echo GUARD_FAIL_INFLIGHT; exit 24; }
# 어제 wedge 교훈 — 가용 메모리가 적으면 빌드를 시작하지 않는다(스왑만 믿고 돌리다 멈췄다)
[ "$FREE" -ge 1500 ] || { echo GUARD_FAIL_LOWMEM; exit 26; }
echo "=== 복귀점(125) 확인 ==="
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep -qF "erp-app:rollback-789eff5 $EXPECT_IMG" \
  && echo "rollback-789eff5 = 125 이미지 일치" || { echo ROLLBACK_MISMATCH; exit 27; }
echo "=== BUILD & UP ==="
docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -20
UP_RC=${PIPESTATUS[0]}; echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }
sleep 8
echo "=== 다음 회차 복귀점 ==="
docker tag erp-app:latest "erp-app:rollback-f183ab3" && echo "tagged erp-app:rollback-f183ab3"
docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19
echo UP_SCRIPT_DONE
