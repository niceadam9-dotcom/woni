#!/usr/bin/env bash
# 118회차 운영 배포 — 23796100 → eec404d0(EXPECT_TARGET까지만 ff) · 1커밋 · 마이그 0
#   eec404d0 B4 1단계 — 소민터용 별지 9호 한글파일(2·3·8쪽 채움) + 4단계 칸 버튼 · 라우트 /inspections/[id]/hwpx · templates/report9-placeholder.hwpx
#
# 🚨 회차: 117=타 세션 C3(23796100까지, 마이그 172·173 동반). 착수는 117 완료 뒤 — 서버 HEAD 2379610·img(117 after)·inflight 0.
# 마커: 신규 somin-hwpx(클라이언트)·hwpx 라우트·템플릿 sha e4c7873fd16f290b — 117 이미지에서 before 0 확인
#   존속 축은 116 verify와 같다.
set -u
EXPECT_HEAD=23796100
EXPECT_IMG=1310ca2dfcc1   # 117회차(erp-08 C3) after 이미지
ROLLBACK_TAG=erp-app:rollback-2379610
EXPECT_TARGET=eec404d0994cdcaeed6a0ef5a00fe74109466f3f
EXPECT_MIG=   # 23796100..eec404d0 마이그 0 — 빈 값이어야 한다
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
echo "=== 복귀점 확보 ==="
docker images --format '{{.Repository}}:{{.Tag}}' | grep -qxF "$ROLLBACK_TAG" \
  && echo "이미 있음: $ROLLBACK_TAG" || { docker tag erp-app:latest "$ROLLBACK_TAG" && echo "tagged $ROLLBACK_TAG"; }
echo "=== FETCH & FF ==="
git -C /home/ubuntu/woni fetch origin --quiet || { echo FETCH_FAIL; exit 30; }
# origin은 그 위로 움직일 수 있다(2026-10-02 A3 4b7d2b84·마이그 168이 먼저 올라옴) — 승인 범위는 624e016c까지라
# origin/main이 아니라 **EXPECT_TARGET까지만** ff한다(109회차 erp-7a와 같은 방식). 조상이 아니면 선다.
TARGET=$EXPECT_TARGET
echo "target = $TARGET (origin/main=$(git -C /home/ubuntu/woni rev-parse --short origin/main))"
git -C /home/ubuntu/woni merge-base --is-ancestor "$TARGET" origin/main || { echo GUARD_FAIL_TARGET_NOT_IN_ORIGIN; exit 35; }
for C in eec404d0; do
  git -C /home/ubuntu/woni merge-base --is-ancestor "$C" "$TARGET" || { echo "MINE_NOT_IN_TARGET:$C"; exit 32; }
done
# 마이그 0건 — 섞이면 선다.
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
