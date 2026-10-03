#!/usr/bin/env bash
# 128회차 운영 배포 — df1fdc75 → 1f29a61f(EXPECT_TARGET까지만 ff) · 마이그 178(두 DB 선적용 완료 2026-10-03)
#   1f29a61f C4 — QR 3단계 지점 책갈피(equipment_points·패널·/t 지점 카드·점검표 딥링크·라벨 route)
#
# ⚠ 회차 순서 합의(2026-10-03): 126=erp-a3 → 127=erp-08(→df1fdc75) → 128=이것. EXPECT 두 값은
#   **127 완료 통지의 실측값**으로 채운다(df1fdc75·09ed63e9a798) — 불통 사건으로 서버가 재부팅됐으므로
#   127 완료 통지(2026-10-03 22:1x, erp-08): HEAD df1fdc75 · img 09ed63e9a798 · rollback-df1fdc7 태그 생성됨 · VERIFY_FAIL=0.
set -u
EXPECT_HEAD=df1fdc75
EXPECT_IMG=09ed63e9a798   # 127회차(erp-08 펌프 177) after 이미지 — 통지값
ROLLBACK_TAG=erp-app:rollback-df1fdc7
EXPECT_TARGET=1f29a61fb2a8775eb81a3aa8734371cde0ffa68a
# 178 정확히 한 건 — 두 DB 적용 완료(2026-10-03, _apply-178-both.mjs). 다른 것이 섞이면 선다.
EXPECT_MIG=erp/supabase/migrations/178_equipment_points.sql
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
for C in 1f29a61f; do
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
