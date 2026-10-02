#!/usr/bin/env bash
# 107회차 운영 배포 — 82695720 → origin/main(c455a0e7) · 5커밋(코드 1·문서 4) · 마이그 0
#   b920d58e chore(배포): 106회차 기록                                                  (문서 전용)
#   698b2fa5 / 98b0090b docs(erp_goal): 비교진단 「범위 밖 세 영역」·「다중이용업소 해결방안」 (문서 전용)
#   97aad892 fix(공통): history.replaceState 첫 인자를 null로 통일 — 달력 4곳·점검표 입력·fields + 고객 탭 back 복원은 주소 ?tab= 우선
#   c455a0e7 docs(erp_goal): SaaS 전환 로드맵·준비 목록 + 비교진단 실측·결정 문단           (문서 전용)
#
# 🚨 회차: 착수 실측(2026-10-02) — 서버 HEAD 8269572·img 8ed8320751bf·rollback-8269572 존재·inflight 0·dirty 0 → **107**.
# 마커(운영 before 실측 2026-10-02): 역방향 `replaceState(window.history.state` 25(server 12·static 13) ·
#   증가 `replaceState(null` 8 · 존속 form13-station-select 2 · report-gaps-strip- 4 · tab-gap- 4 · cal-toolbar 2 ·
#   cal-range-loading 2 · history-progress 2 · xlsx sha 5dc767d1a9101aa9.
set -u
EXPECT_HEAD=82695720
EXPECT_IMG=8ed8320751bf
ROLLBACK_TAG=erp-app:rollback-8269572
EXPECT_TARGET=c455a0e733abb95803ee5f6ae830f04131e5a743

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
for C in b920d58e 698b2fa5 98b0090b 97aad892 c455a0e7; do
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
