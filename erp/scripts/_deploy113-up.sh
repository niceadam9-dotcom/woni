#!/usr/bin/env bash
# 113회차 운영 배포 — fad207e1 → 0ca796a4(EXPECT_TARGET까지만 ff) · 7커밋 · 마이그 1(171, 스테이징·운영 적용 완료 2026-10-02)
#   9b92bb65·bf0b1459·096bc070 배포 기록 · e4e9f753·1aca5b6c 문서 · 4f9b609b B3 소방계획서 1.10.3 10~27행(erp-7a, 마이그 없음)
#   0ca796a4 불량→매출 3단계 — 회차 문서 묶음·청구 이력 링크·손글씨 서명·고객 청구 탭 이력
#
# 🚨 회차: 착수 실측(2026-10-02) — 서버 HEAD fad207e·img 81888046a0eb·rollback-fad207e 존재·inflight 0 → **113**(스크립트 112까지 확인).
# 마커(운영 before 실측): 신규 customer-bills-panel·billing-link-create·share-round-list·share-billing-table·share-sign-canvas 0 ·
#   존속 share-links-section 2·share-page 1·repair-sales-page 5·replaceState(null 28·form13-station-select 2.
#
set -u
EXPECT_HEAD=fad207e1
EXPECT_IMG=81888046a0eb   # 112회차 after 이미지
ROLLBACK_TAG=erp-app:rollback-fad207e
EXPECT_TARGET=0ca796a4a5a818aabd2525975d9f4daf3d15a22b
EXPECT_MIG=erp/supabase/migrations/171_share_round_billing_signature.sql
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
for C in 4f9b609b 0ca796a4; do
  git -C /home/ubuntu/woni merge-base --is-ancestor "$C" "$TARGET" || { echo "MINE_NOT_IN_TARGET:$C"; exit 32; }
done
# 마이그 1건(171) — 스테이징·운영 적용 완료. 다른 게 섞이면 선다.
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
