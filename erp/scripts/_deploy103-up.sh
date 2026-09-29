#!/usr/bin/env bash
# 103회차 운영 배포 — af1cccce → origin/main(a64bd0ef) · 4커밋 · 마이그 0
#   a9e9a674 chore(배포): 102회차 기록                                                   (문서 전용)
#   a5f7a670 feat(문자): 문자 보내기를 점검 달력으로 — 자동 준비(승인)·골라 보내기, 기존 화면은 발송 이력으로
#   a43be665 feat(발송 문구): 사전 안내 시점 「사용 안 함」 체크박스
#   a64bd0ef feat(점검달력): 날짜를 누르면 보낼지 말지부터 보인다 — 「이 날 문자」 카드
#
# 🚨 회차: 착수 실측(2026-09-29) — 서버 HEAD af1cccce·img 81efcb4247ae·rollback-af1cccc 존재·inflight 0·dirty 0 → **103**.
# 마커(운영 before 실측): 신규 cal-sms-panel·day-sms-card·lead-rule-off·history-status-all 전부 0 ·
#   역방향 sms-filter-toggle 2·sms-approve-range 2(옛 문자 발송 화면) ·
#   존속 calendar-sms-toolbar 2·sms-result-link 3·cal-nav 2·data-recent-strip 6.
set -u
EXPECT_HEAD=af1cccce
EXPECT_IMG=81efcb4247ae
ROLLBACK_TAG=erp-app:rollback-af1cccc
EXPECT_TARGET=a64bd0efb231fbf2c734cebd2f9477238f942b43

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
for C in a9e9a674 a5f7a670 a43be665 a64bd0ef; do
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
