#!/usr/bin/env bash
# 100회차 운영 배포 — 0cd7a69a → origin/main(70de37d2) · 2커밋 · 마이그 0
#   dccb1b64 chore(배포): 99회차 기록                                   (문서 전용)
#   70de37d2 feat(점검달력·고객): 도구줄 두 줄(달 이동·고객 검색이 주인공) + 보고서 빈칸 안내(타 세션 작업 이어받기)
#
# 🚨 회차: 착수 실측(`_deploy100-baseline.sh`) — 서버 HEAD 0cd7a69a·img 52f3ce720d59·롤백 최신 rollback-0cd7a69·inflight 0 → **100**.
# 🚨 마이그 0 · 템플릿 xlsx 불변(5dc767d1a9101aa9).
# 마커 3분법(before 실측):
#   신규    cal-nav · cal-toolbar-secondary · cal-nav-move · cal-nav-label · inspanel-close · cal-orphan-chip ·
#           report-gaps-next · report-gaps-return          전부 0 → N
#   역방향  없음 — 원리적으로 없다(옛 퇴사 띠 문구가 칩 title로 남는다 · 지어내지 않는다)
#   존속    cal-customer-search 2 · calendar-sms-toolbar 2 · calendar-new-customer 2 · daypanel-new-customer 2 ·
#           daypanel-close 2 · info-save-bar 2 · data-save-bar 6 · fsm-keyrow 2    (≥)
#   음성    zzzNoSuchMarker100 0
set -u
EXPECT_HEAD=0cd7a69a
EXPECT_IMG=52f3ce720d59
ROLLBACK_TAG=erp-app:rollback-0cd7a69

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
for C in dccb1b64 70de37d2; do
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
