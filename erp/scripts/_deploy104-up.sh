#!/usr/bin/env bash
# 104회차 운영 배포 — a64bd0ef → origin/main(bb56b4ee) · 2커밋 · 마이그 0
#   9b616a7b chore(배포): 103회차 기록                                                   (문서 전용)
#   bb56b4ee feat(점검 작업대): 단계마다 「무엇을 하면 끝나는지」가 보인다 — 칩 색=상태·완료 조건 띠·즉시 반영
#
# 🚨 회차: 착수 실측(2026-10-01) — 서버 HEAD a64bd0e·img 6c8c21fff9fe·rollback-a64bd0e 존재·inflight 0·dirty 0 → **104**.
# 마커(운영 before 실측 2026-10-01): 신규 step-goal·step-done-toast·step-done-next·owner-report-ways·submit9-ready·
#   submit11-ready·goal-unregistered-x·data-done 전부 0 · 역방향 accent-[#5b46d9] 2(옛 ② 체크박스 클래스, src 0곳) ·
#   존속 workbench-stepbar 2·cert-reported-toggle 2·submit9-record 2·submit11-record 2·annex-doc-chips 2·goto-defect-register 2 ·
#   xlsx sha 5dc767d1a9101aa9.
set -u
EXPECT_HEAD=a64bd0ef
EXPECT_IMG=6c8c21fff9fe
ROLLBACK_TAG=erp-app:rollback-a64bd0e
EXPECT_TARGET=bb56b4eea0e7d54cdf7f598567b2d82a2cbfb787

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
for C in 9b616a7b bb56b4ee; do
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
