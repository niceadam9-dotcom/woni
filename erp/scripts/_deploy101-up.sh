#!/usr/bin/env bash
# 101회차 운영 배포 — 70de37d2 → origin/main(978e6225) · 2커밋 · 마이그 0
#   7f1084b0 chore(배포): 100회차 기록                                    (문서 전용)
#   978e6225 feat(메뉴): 점검 달력 → 고객 관리 → 점검 업무 순서 + 달력에서 「점검 업무」가 함께 켜지던 결함 (타 세션)
#
# 🚨 회차: 착수 실측 — 서버 HEAD 70de37d·img 7e0a61e3ec5d·롤백 최신 rollback-70de37d·inflight 0 → **101**.
# 🚨 새 문자열이 없다(순서 이동 + 판정 로직) → 개수 마커 불가. **같은 청크 안 오프셋 맞교대**로 판정(95회차 방식):
#   before 2청크 모두 「고객 < 업무 < 달력」 → after 「달력 < 고객 < 업무」 (_deploy101-order.sh).
set -u
EXPECT_HEAD=70de37d2
EXPECT_IMG=7e0a61e3ec5d
ROLLBACK_TAG=erp-app:rollback-70de37d

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
for C in 7f1084b0 978e6225; do
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
