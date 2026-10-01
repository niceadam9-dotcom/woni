#!/usr/bin/env bash
# 106회차 운영 배포 — 1e7a60ab → origin/main(82695720) · 2커밋 · 마이그 0
#   99390d52 chore(배포): 105회차 기록                                                   (문서 전용)
#   82695720 perf(고객관리): 세 화면 속도 개선 3단계 — 목록 서버 페이징·탭 전환 서버 왕복 0·상세 조회 한 물결·중복 refresh 30곳 제거
#
# 🚨 회차: 착수 실측(2026-10-01) — 서버 HEAD 1e7a60a·img ce9358a78cd8·rollback-1e7a60a 존재·inflight 0·dirty 0 → **106**.
# 마커(운영 before 실측 2026-10-01): 신규 history-progress 0 · 「미완료·문서 판정이 보수적으로 기웁니다」 0 ·
#   「진행 단계를 불러오지 못했습니다」 0 · buildings!inner(customer_id) 1(customers/actions 1곳) ·
#   존속 form13-station-select 2 · report-gaps-strip- 4 · tab-gap- 4 · cal-toolbar 2 · cal-range-loading 2 · xlsx sha 5dc767d1a9101aa9.
set -u
EXPECT_HEAD=1e7a60ab
EXPECT_IMG=ce9358a78cd8
ROLLBACK_TAG=erp-app:rollback-1e7a60a
EXPECT_TARGET=82695720bc508f7c9943e48b90d8c35446a74510

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
for C in 99390d52 82695720; do
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
