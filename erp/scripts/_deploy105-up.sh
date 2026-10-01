#!/usr/bin/env bash
# 105회차 운영 배포 — bb56b4ee → origin/main(1e7a60ab) · 2커밋 · 마이그 0
#   3a0c7c4e chore(배포): 104회차 기록                                                   (문서 전용)
#   1e7a60ab perf(점검달력·작업대·공통): 세 화면 속도 개선 1·2단계 — 로컬 인증·뱃지 캐시·달력 창 ±1개월·작업대 조회 통합
#
# 🚨 회차: 착수 실측(2026-10-01) — 서버 HEAD bb56b4e·img 7faafae23176·rollback-bb56b4e 존재·inflight 0·dirty 0 → **105**.
# 마커(운영 before 실측 2026-10-01): 신규 cal-range-loading·cal-range-error·route-loading·sms-unsent-count·step-badge 전부 0 ·
#   역방향 server/app/(dashboard)/inspection-plans/monitor/page.js 1·inspection-ledger/page.js 1·by-customer/[customerId]/page.js 1(→route.js) ·
#   존속 cal-toolbar 2·cal-nav 2·workbench-stepbar 2·daypanel-period 2·cal-orphan-chip 2 · xlsx sha 5dc767d1a9101aa9.
set -u
EXPECT_HEAD=bb56b4ee
EXPECT_IMG=7faafae23176
ROLLBACK_TAG=erp-app:rollback-bb56b4e
EXPECT_TARGET=1e7a60ab05cb3c7c77f608d0b81ae566133bbc20

cd /home/ubuntu/woni/erp || { echo FATAL_NO_ERP_DIR; exit 9; }
[ -f docker-compose.prod.yml ] || { echo FATAL_NO_COMPOSE; exit 10; }
echo "=== GUARD ==="
H=$(git -C /home/ubuntu/woni rev-parse HEAD)
D=$(git -C /home/ubuntu/woni status --porcelain | grep -v -F 'erp/up.log' | wc -l)
R=$(docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19)
INFLIGHT=$(ps -eo cmd | grep -F 'docker compose' | grep -v grep | wc -l)
echo "HEAD=$H (기대 $EXPECT_HEAD*) · dirty=$D · img=$R (기대 $EXPECT_IMG) · inflight=$INFLIGHT"
case "$H" in $EXPECT_HEAD*) ;; *) echo GUARD_FAIL_HEAD; exit 21;; esac
[ "$D" = "0" ]            || { echo GUARD_FAIL_DIRTY; exit 22; }
[ "$R" = "$EXPECT_IMG" ]  || { echo GUARD_FAIL_IMG; exit 23; }
[ "$INFLIGHT" = "0" ]     || { echo GUARD_FAIL_INFLIGHT; exit 24; }
echo "=== 복귀점 확보 ==="
docker images --format '{{.Repository}}:{{.Tag}}' | grep -qxF "$ROLLBACK_TAG" \
  && echo "이미 있음: $ROLLBACK_TAG" || { docker tag erp-app:latest "$ROLLBACK_TAG" && echo "tagged $ROLLBACK_TAG"; }
echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
TARGET=$(git -C /home/ubuntu/woni rev-parse origin/main)
echo "target = $TARGET"
# 게이트를 건 sha만 싣는다 — 그 사이 origin이 움직였으면 선다(남의 미검증 커밋을 업어 가지 않는다)
[ "$TARGET" = "$EXPECT_TARGET" ] || { echo "GUARD_FAIL_TARGET_MOVED:$TARGET"; exit 35; }
for C in 3a0c7c4e 1e7a60ab; do
  git -C /home/ubuntu/woni merge-base --is-ancestor "$C" origin/main || { echo "MINE_NOT_IN_TARGET:$C"; exit 32; }
done
MIG=$(git -C /home/ubuntu/woni diff --name-only HEAD..origin/main -- erp/supabase/migrations | wc -l)
[ "$MIG" = "0" ] || { echo "GUARD_FAIL_MIGRATION:$MIG"; exit 34; }
git -C /home/ubuntu/woni merge --ff-only origin/main || { echo FF_FAIL; exit 31; }
NEW=$(git -C /home/ubuntu/woni rev-parse HEAD); echo "HEAD_NOW=$NEW"
[ "$NEW" = "$TARGET" ] || { echo FF_MISMATCH; exit 33; }
echo "=== BUILD & UP (수 분 걸린다) ==="
docker compose -f docker-compose.prod.yml up -d --build 2>&1 | tail -25
UP_RC=${PIPESTATUS[0]}; echo "UP_RC=$UP_RC"
[ "$UP_RC" = "0" ] || { echo BUILD_FAIL; exit 40; }
echo "=== 다음 회차 복귀점 ==="
SHORT=$(git -C /home/ubuntu/woni rev-parse --short HEAD)
docker tag erp-app:latest "erp-app:rollback-$SHORT" && echo "tagged erp-app:rollback-$SHORT"
docker inspect --format '{{.Image}}' erp-app-1 2>/dev/null | cut -c8-19
echo UP_SCRIPT_DONE
