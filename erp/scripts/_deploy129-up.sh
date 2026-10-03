#!/usr/bin/env bash
# 129회차 운영 배포 — 1f29a61f → d546fb16(EXPECT_TARGET까지만 ff) · 2커밋 · 마이그 179(두 DB 선적용 완료 2026-10-03)
#   d546fb16 C4 — QR 4단계 건물 QR + 자체점검기록표(별표 5) PDF · f3efaa16 128 기록(문서뿐)
#
# 착수 실측(2026-10-03 밤): 서버 HEAD 1f29a61·img 24c711ba8dfd·healthy·inflight 0·availMB 2976·rollback-1f29a61 존재.
# 마커(운영 before 실측): 신규 record-card-link·tag-building-card·「소방시설등 자체점검기록표」 0 ·
#   존속 tag-point-card 1·point-panel 4·tag-register-form 2·somin-hwpx 2·seal-preview 2.
set -u
EXPECT_HEAD=1f29a61f
EXPECT_IMG=24c711ba8dfd   # 128회차(QR 3단계) after 이미지
ROLLBACK_TAG=erp-app:rollback-1f29a61
EXPECT_TARGET=d546fb16bd7000b043efb608f45c2b5dd6ec1833
# 179 정확히 한 건 — 두 DB 적용 완료(2026-10-03, _apply-179-both.mjs). 다른 것이 섞이면 선다.
EXPECT_MIG=erp/supabase/migrations/179_building_tag.sql
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
# 불통 사건(2026-10-03, 126 build 중 호스트 wedge) 재발 가드 — 가용 메모리가 적으면 빌드를 아예 안 시작한다(erp-a3 권고)
AVAIL=$(free -m | awk '/^Mem:/{print $7}')
echo "availMB=$AVAIL"
[ "$AVAIL" -ge 1500 ] || { echo GUARD_FAIL_LOWMEM; exit 26; }
echo "=== 복귀점 확보 ==="
docker images --format '{{.Repository}}:{{.Tag}}' | grep -qxF "$ROLLBACK_TAG" \
  && echo "이미 있음: $ROLLBACK_TAG" || { docker tag erp-app:latest "$ROLLBACK_TAG" && echo "tagged $ROLLBACK_TAG"; }
echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
TARGET=$EXPECT_TARGET
echo "target = $TARGET (origin/main=$(git -C /home/ubuntu/woni rev-parse --short origin/main))"
git -C /home/ubuntu/woni merge-base --is-ancestor "$TARGET" origin/main || { echo GUARD_FAIL_TARGET_NOT_IN_ORIGIN; exit 35; }
for C in d546fb16; do
  git -C /home/ubuntu/woni merge-base --is-ancestor "$C" "$TARGET" || { echo "MINE_NOT_IN_TARGET:$C"; exit 32; }
done
MIG=$(git -C /home/ubuntu/woni diff --name-only HEAD.."$TARGET" -- erp/supabase/migrations)
[ "$MIG" = "$EXPECT_MIG" ] || { echo "GUARD_FAIL_MIGRATION:[$MIG]"; exit 34; }
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
